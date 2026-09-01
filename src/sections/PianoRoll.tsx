import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gridStep, pitchRange, toEvents, toNotes, type Note } from '../audio/noteEdit'
import { setLayerEvents, type Layer } from '../audio/looper'
import { noteOff, noteOn } from '../audio/synth'

/**
 * Editing what you played, instead of playing it again.
 *
 * This is the payoff for a decision made much earlier: a take is stored as NOTES rather than as
 * recorded audio. Because of that, "move the third note back a bit" is arithmetic on a small
 * array, not surgery on a waveform — the editor is a view over data that already existed, and it
 * needed a converter (noteEdit.ts) rather than a new recording format.
 *
 *
 * WHY DIVS RATHER THAN A CANVAS
 *
 * A loop take is tens of notes, not thousands, so the usual reason to reach for canvas does not
 * apply. Elements bring hit-testing, focus, keyboard access and the site's own theming for free,
 * and every one of those would otherwise have to be rebuilt by hand against a bitmap. The
 * visualiser is on canvas because it draws a new picture sixty times a second; this draws a
 * static picture that changes when you change it.
 *
 * The playhead is the one exception — it moves every frame, so it is positioned by a rAF loop
 * writing a transform, never by React state. Same reasoning as the party cursors.
 */

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
const nameOf = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

const CELL_W = 32
const ROW_H = 18
/** Two notes never share a pitch and a start, so this identifies one exactly. */
const isSame = (n: Note, sel: { midi: number; t: number } | null) =>
  !!sel && n.midi === sel.midi && Math.abs(n.t - sel.t) < 1e-6
/** Grab within this fraction of a note's right edge and you are resizing, not moving. */
const HANDLE = 0.3

/**
 * A drag in progress.
 *
 * ⚠️ It carries a SNAPSHOT of the notes as they were when the gesture started, and the edit is
 * recomputed from that snapshot on every move rather than applied on top of the last one.
 *
 * The version without it committed each move straight to the layer, and dragging a note across
 * another one of the same pitch destroyed it: the overlap rule trims the earlier note to meet the
 * later one, that trim was committed, and moving on left the damage behind. Passing over a note
 * chopped it. Worse, committing re-sorted the array, so the index being dragged could quietly
 * start pointing at a different note halfway through the gesture.
 *
 * Recomputing from the snapshot makes a drag a preview of one edit rather than a sequence of
 * hundreds, so nothing is destroyed on the way past and only the release writes anything.
 */
type Drag =
  | { kind: 'move'; i: number; dx: number; dy: number; from: Note[]; col: number; row: number }
  | { kind: 'resize'; i: number; from: Note[]; col: number }
  | null

/** Does this note run into another of the same pitch? */
function hits(list: Note[], self: number, n: Note): boolean {
  return list.some(
    (o, i) =>
      i !== self && o.midi === n.midi && n.t < o.t + o.dur - 1e-6 && n.t + n.dur > o.t + 1e-6,
  )
}

/** How long this note may be before it would touch the next one of the same pitch. */
function roomAfter(list: Note[], self: number, n: Note): number {
  let limit = Infinity
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (i === self || o.midi !== n.midi || o.t <= n.t) continue
    limit = Math.min(limit, o.t - n.t)
  }
  return limit
}

export function PianoRoll({
  layer,
  bpm,
  quantize,
  position,
  loopLen,
  onClose,
}: {
  layer: Layer
  bpm: number
  quantize: number
  /** 0–1 through the LOOP, which may be longer than this take — see the playhead note */
  position: number
  loopLen: number
  onClose: () => void
}) {
  /**
   * The selected note, by WHAT IT IS rather than where it sits in the array.
   *
   * ⚠️ It was an index, and that could delete the wrong note. `notes` is derived fresh from
   * the layer's events and sorted on every change, so adding or moving anything reshuffles it —
   * the index you selected then points at a different note, and the delete button acts on that
   * one instead. A pitch and a start time identify a note uniquely now that two notes of one
   * pitch cannot overlap, so there is nothing to go stale.
   */
  const [sel, setSel] = useState<{ midi: number; t: number } | null>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  const step = gridStep(bpm, quantize)
  const notes = useMemo(() => toNotes(layer.events, layer.len), [layer.events, layer.len])
  /**
   * The pitch range on show — decided ONCE, when the editor opens for this layer.
   *
   * ⚠️ It must not follow the notes. Deriving it from them meant that adding a note near the top
   * widened the range, which pushed every existing row down to make space — so the note you just
   * placed appeared somewhere other than where you clicked, and so did everything else. The
   * placement was right and the picture moved underneath it, which is indistinguishable from the
   * placement being wrong.
   *
   * Fixed instead, with two octaves of room around whatever you recorded, and every edit clamped
   * inside it. Because you can only click within the grid and a drag is clamped to the same
   * bounds, no edit can ever fall outside — so the range never needs to change, and the grid
   * never moves while you work.
   */
  const [lo, hi] = useMemo(
    () => {
      const [a, b] = pitchRange(toNotes(layer.events, layer.len))
      const pad = Math.max(0, 24 - (b - a))
      return [Math.max(0, a - Math.ceil(pad / 2)), Math.min(127, b + Math.floor(pad / 2))]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.id],
  )
  const rows = useMemo(() => {
    const r: number[] = []
    for (let m = hi; m >= lo; m--) r.push(m)
    return r
  }, [lo, hi])
  const cols = Math.max(1, Math.round(layer.len / step))

  /**
   * What is on screen: the committed notes, or the preview of the drag in progress.
   *
   * One edit, recomputed from the gesture's starting point every time the pointer moves.
   */
  const shown = useMemo(() => {
    if (!drag) return notes
    const next = [...drag.from]
    const was = next[drag.i]
    if (!was) return notes
    const n = { ...was }
    if (drag.kind === 'move') {
      n.t = Math.max(0, Math.min(cols - 1, drag.col - drag.dx)) * step
      n.midi = Math.max(lo, Math.min(hi, hi - (drag.row - drag.dy)))
      /**
       * ⚠️ A move onto an occupied slot is REFUSED, not merged.
       *
       * Landing one note on another of the same pitch used to replace it — which is what most
       * sequencers do, and which is still one note fewer than you had without ever saying so. It
       * also made the overlap rule reachable from the mouse, and every overlap is a chance for
       * the pairing to come out wrong.
       *
       * Refusing means the note simply stays where it was until you find a free slot: nothing is
       * ever lost by dragging, and there is no state in which two notes of one pitch sound at
       * once. The pointer keeps moving, so it costs nothing to try again.
       */
      if (hits(next, drag.i, n)) return notes
    } else {
      const endCol = Math.max(Math.round(n.t / step) + 1, drag.col + 1)
      // stretch up to the next note of this pitch and no further, so lengthening cannot
      // swallow a neighbour either
      n.dur = Math.min(layer.len - n.t, endCol * step - n.t, roomAfter(next, drag.i, n))
    }
    next[drag.i] = n
    return next
  }, [drag, notes, cols, step, lo, hi, layer.len])

  /** Click an empty cell adds; clicking an occupied one must not stack a second note on it. */
  const occupied = (list: Note[], midi: number, t: number) =>
    list.some((o) => o.midi === midi && t < o.t + o.dur - 1e-6 && t + step > o.t + 1e-6)

  /** Write back through the looper, which is the single source of truth. */
  const commit = useCallback(
    (next: Note[]) => setLayerEvents(layer.id, toEvents(next, layer.len)),
    [layer.id, layer.len],
  )

  /**
   * Hear what you just did.
   *
   * ⚠️ Through the layer's OWN part and effects, not the live knobs — otherwise a note auditioned
   * while editing a reverbed bassline would come back dry, and you would be judging the edit
   * against a sound the take does not have.
   */
  const audition = useCallback(
    (midi: number) => {
      const id = `roll:${layer.id}`
      noteOn(id, layer.instrument, midi, undefined, { key: `L${layer.id}`, fx: layer.fx })
      window.setTimeout(() => noteOff(id), 220)
    },
    [layer.id, layer.instrument, layer.fx],
  )

  // ── the playhead, positioned outside React ────────────────────────────────
  const posRef = useRef(position)
  posRef.current = position
  const lenRef = useRef({ loopLen, own: layer.len })
  lenRef.current = { loopLen, own: layer.len }
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = headRef.current
      if (!el) return
      const { loopLen: L, own } = lenRef.current
      /**
       * ⚠️ Wrapped into the TAKE's length, not the loop's. A two-bar take inside a four-bar loop
       * plays twice (see the tiling note in looper.ts), so the loop's playhead passes through
       * this take twice per lap. Showing the loop's position directly would send the marker off
       * the right-hand edge for the whole second half.
       */
      const intoLoop = posRef.current * L
      const x = own > 0 ? ((intoLoop % own) / own) * cols * CELL_W : 0
      el.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cols])

  // ── dragging ──────────────────────────────────────────────────────────────
  const cellFrom = (e: React.PointerEvent) => {
    const box = gridRef.current?.getBoundingClientRect()
    if (!box) return null
    return {
      col: Math.floor((e.clientX - box.left) / CELL_W),
      row: Math.floor((e.clientY - box.top) / ROW_H),
    }
  }

  const onNoteDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation()
    e.preventDefault()
    const n = notes[i]
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const c = cellFrom(e)
    if (!c) return
    setSel({ midi: n.midi, t: n.t })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    if (e.clientX > box.right - Math.max(6, box.width * HANDLE)) {
      setDrag({ kind: 'resize', i, from: notes, col: c.col })
    } else {
      setDrag({
        kind: 'move',
        i,
        from: notes,
        dx: c.col - Math.round(n.t / step),
        dy: c.row - (hi - n.midi),
        col: c.col,
        row: c.row,
      })
    }
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const c = cellFrom(e)
    if (!c) return
    if (drag.kind === 'move') {
      if (c.col === drag.col && c.row === drag.row) return
      if (c.row !== drag.row) audition(Math.max(lo, Math.min(hi, hi - (c.row - drag.dy))))
      setDrag({ ...drag, col: c.col, row: c.row })
    } else {
      if (c.col === drag.col) return
      setDrag({ ...drag, col: c.col })
    }
  }

  /** ⚠️ The ONLY place a drag writes anything. See the note on Drag. */
  const endDrag = () => {
    if (drag) commit(shown)
    setDrag(null)
  }

  /** Click an empty cell to put a note there. An occupied one is left alone. */
  const onGridDown = (e: React.PointerEvent) => {
    const c = cellFrom(e)
    if (!c) return
    const midi = hi - c.row
    if (midi < lo || midi > hi || c.col < 0 || c.col >= cols) return
    const t = c.col * step
    // ⚠️ clicking where a note already is must not drop a second one on top of it — the click
    // fell through the note element's own handler only because it was a miss, and a miss on an
    // occupied cell means the pointer was in the gap, not that you wanted two notes there
    if (occupied(notes, midi, t)) return
    const n: Note = { midi, t, dur: step }
    audition(midi)
    const next = [...notes, n]
    // select the note you just made, by identity — see the note on `sel`
    setSel({ midi: n.midi, t: n.t })
    commit(next)
  }

  /** Delete one note, whichever way you asked for it to go. */
  const removeNote = useCallback(
    (n: Note) => {
      commit(notes.filter((o) => !(o.midi === n.midi && Math.abs(o.t - n.t) < 1e-6)))
      setSel(null)
    },
    [notes, commit],
  )

  const removeSelected = useCallback(() => {
    const n = notes.find((x) => isSame(x, sel))
    if (n) removeNote(n)
  }, [sel, notes, removeNote])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [removeSelected, onClose])

  return (
    <div className="roll">
      <div className="roll-bar">
        <strong>Notes</strong>
        <span className="muted">
          {shown.length} note{shown.length === 1 ? '' : 's'} · {layer.len.toFixed(1)}s
        </span>
        <span className="muted roll-hint">
          Click to add · drag to move · drag the right edge to lengthen ·{' '}
          <strong>right-click or double-click a note to delete it</strong>
        </span>
        <button
          className="btn"
          onClick={removeSelected}
          disabled={!sel}
          title="Delete the selected note (or right-click it)"
        >
          ✕ Note
        </button>
        <button className="btn" onClick={onClose} title="Close the editor (Esc)">
          Done
        </button>
      </div>

      <div className="roll-body">
        <div className="roll-keys" aria-hidden>
          {rows.map((m) => (
            <div key={m} className={'roll-key' + (isBlack(m) ? ' is-black' : '')}>
              {m % 12 === 0 ? nameOf(m) : ''}
            </div>
          ))}
        </div>

        <div className="roll-scroll">
          <div
            ref={gridRef}
            className="roll-grid"
            style={{ width: cols * CELL_W, height: rows.length * ROW_H }}
            onPointerDown={onGridDown}
            onContextMenu={(e) => e.preventDefault()}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* Rows first, so a black-key stripe sits under the bar lines rather than over them */}
            {rows.map((m, r) => (
              <div
                key={m}
                className={'roll-row' + (isBlack(m) ? ' is-black' : '')}
                style={{ top: r * ROW_H, height: ROW_H }}
              />
            ))}
            {Array.from({ length: cols + 1 }, (_, i) => (
              <div
                key={i}
                className={
                  // a heavier line every beat, heaviest every bar — the same cue the transport
                  // uses, so the grid reads as bars rather than as undifferentiated squares
                  'roll-line' +
                  (i % Math.max(1, Math.round(((60 / bpm) * 4) / step)) === 0
                    ? ' is-bar'
                    : i % Math.max(1, Math.round(60 / bpm / step)) === 0
                      ? ' is-beat'
                      : '')
                }
                style={{ left: i * CELL_W }}
              />
            ))}

            {shown.map((n, i) => (
              <div
                key={i}
                className={'roll-note' + (isSame(n, sel) ? ' is-sel' : '')}
                style={{
                  left: (n.t / step) * CELL_W,
                  top: (hi - n.midi) * ROW_H,
                  width: Math.max(6, (n.dur / step) * CELL_W - 1),
                  height: ROW_H - 1,
                }}
                onPointerDown={(e) => onNoteDown(e, i)}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                /**
                 * ⚠️ Two ways to delete a note, because the one that existed — select it, then
                 * press Delete or find a button that is disabled until you do — was invisible.
                 * Right-click is what every sequencer does, and a double-click is what people
                 * try when right-click is awkward. Neither needs a selection first, which was
                 * the part nobody discovered.
                 */
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  removeNote(n)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  removeNote(n)
                }}
                title={`${nameOf(n.midi)} · ${n.dur.toFixed(2)}s — right-click or double-click to delete`}
              />
            ))}

            <div ref={headRef} className="roll-head" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}
