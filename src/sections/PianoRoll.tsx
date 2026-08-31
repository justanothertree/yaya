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

const CELL_W = 26
const ROW_H = 15
/** Grab within this fraction of a note's right edge and you are resizing, not moving. */
const HANDLE = 0.3

type Drag =
  | { kind: 'move'; i: number; dx: number; dy: number }
  | { kind: 'resize'; i: number; dur: number }
  | null

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
  const [sel, setSel] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  const step = gridStep(bpm, quantize)
  const notes = useMemo(() => toNotes(layer.events, layer.len), [layer.events, layer.len])
  /**
   * The pitch range on show.
   *
   * ⚠️ FROZEN WHILE DRAGGING. The range is derived from the notes and padded, so dragging a
   * note to the top of the grid widens it — and every other row then shifts down by one to make
   * space, mid-drag, under the hand that is moving. The note you are holding stays put (it is
   * placed from the cursor, not from the layout) while the whole grid slides beneath it, which
   * reads as the editor lurching. Recomputing only between gestures keeps the picture still while
   * you work and still lets the range grow the moment you let go.
   */
  const liveRange = useMemo(() => pitchRange(notes), [notes])
  const frozen = useRef(liveRange)
  if (!drag) frozen.current = liveRange
  const [lo, hi] = drag ? frozen.current : liveRange
  const rows = useMemo(() => {
    const r: number[] = []
    for (let m = hi; m >= lo; m--) r.push(m)
    return r
  }, [lo, hi])
  const cols = Math.max(1, Math.round(layer.len / step))

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
    setSel(i)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    if (e.clientX > box.right - Math.max(6, box.width * HANDLE)) {
      setDrag({ kind: 'resize', i, dur: n.dur })
    } else {
      const c = cellFrom(e)
      if (!c) return
      setDrag({ kind: 'move', i, dx: c.col - Math.round(n.t / step), dy: c.row - (hi - n.midi) })
    }
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const c = cellFrom(e)
    if (!c) return
    const next = [...notes]
    const n = { ...next[drag.i] }
    if (drag.kind === 'move') {
      const col = Math.max(0, Math.min(cols - 1, c.col - drag.dx))
      const midi = Math.max(lo, Math.min(hi, hi - (c.row - drag.dy)))
      if (midi !== n.midi) audition(midi)
      n.t = col * step
      n.midi = midi
    } else {
      const endCol = Math.max(Math.round(n.t / step) + 1, c.col + 1)
      n.dur = Math.min(layer.len - n.t, endCol * step - n.t)
    }
    next[drag.i] = n
    commit(next)
  }

  const endDrag = () => setDrag(null)

  /** Click an empty cell to put a note there. */
  const onGridDown = (e: React.PointerEvent) => {
    const c = cellFrom(e)
    if (!c) return
    const midi = hi - c.row
    if (midi < lo || midi > hi || c.col < 0 || c.col >= cols) return
    const n: Note = { midi, t: c.col * step, dur: step }
    audition(midi)
    const next = [...notes, n]
    setSel(next.length - 1)
    commit(next)
  }

  const removeSelected = useCallback(() => {
    if (sel == null || sel >= notes.length) return
    commit(notes.filter((_, i) => i !== sel))
    setSel(null)
  }, [sel, notes, commit])

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
          {notes.length} note{notes.length === 1 ? '' : 's'} · {layer.len.toFixed(1)}s
        </span>
        <span className="muted roll-hint">
          Click to add · drag to move · drag the right edge to lengthen · Delete to remove
        </span>
        <button className="btn" onClick={removeSelected} disabled={sel == null}>
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

            {notes.map((n, i) => (
              <div
                key={i}
                className={'roll-note' + (sel === i ? ' is-sel' : '')}
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
                title={`${nameOf(n.midi)} · ${n.dur.toFixed(2)}s`}
              />
            ))}

            <div ref={headRef} className="roll-head" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}
