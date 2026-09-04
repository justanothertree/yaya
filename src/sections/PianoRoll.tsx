import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { gridStep, pitchRange, toEvents, toNotes, type Note } from '../audio/noteEdit'
import {
  loopState,
  seekTo,
  setLayerEvents,
  setMetronome,
  subscribeLoop,
  type Layer,
} from '../audio/looper'
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

/** How wide a grid step is when the take fits comfortably. The ceiling, never the answer. */
const CELL_W = 32
/** Below this a note is too small to grab, so the roll scrolls rather than shrinking further. */
const CELL_MIN = 11
const ROW_H = 18
/** Two notes never share a pitch and a start, so this identifies one exactly. */
const isSame = (n: Note, sel: { midi: number; t: number } | null) =>
  !!sel && n.midi === sel.midi && Math.abs(n.t - sel.t) < 1e-6
/**
 * Grab within this fraction of a note's right edge and you are resizing, not moving.
 *
 * ⚠️ THE ZONE WAS ALWAYS HERE; WHAT WAS MISSING WAS ANY SIGN OF IT. No cursor change, no
 * grip, nothing drawn — on a one-cell note the target is about ten pixels of otherwise identical
 * note. A feature nobody can see is one that does not exist, which is why this was reported as
 * missing when it had been working all along. The grip element below is the whole fix.
 */
const HANDLE = 0.3

/**
 * Lengths you can draw in, as note values.
 *
 * ⚠️ SEPARATE FROM THE SNAP, which is the point. A new note used to be exactly one grid
 * step long, so asking for finer placement — 1/16 to nudge something into the pocket — also
 * meant every note you drew afterwards was a semiquaver. Those are two different questions:
 * where a note starts, and how long it is. `null` keeps the old behaviour of following the
 * snap, and it stays the default so nothing changes for anyone who never opens this.
 */
const LENGTHS: Array<[number | null, string]> = [
  [null, 'Snap'],
  [16, '1/16'],
  [8, '1/8'],
  [4, '1/4'],
  [2, '1/2'],
  [1, '1'],
]

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
  held,
  onClose,
}: {
  layer: Layer
  bpm: number
  quantize: number
  /**
   * ⚠️ The notes your hands are on right now, so the editor answers "which row is that?".
   *
   * Finding a pitch in a grid of rows means counting from a labelled C, every time. The keyboard
   * below already lights what you are holding; the roll is the same information in the same room
   * and had no reason not to. It is a hint, not state — nothing here edits it.
   */
  held: number[]
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
  /**
   * ⚠️ NOTES ARE NAMED BY PITCH AND START, never by their index.
   *
   * `notes` is rebuilt from the layer's events on every edit, so an index means something
   * different the moment anything changes — and a selection that quietly starts pointing at
   * other notes is how you delete the wrong bar. Pitch and start are what actually identify a
   * note here; `isSame` above already relies on it, and two notes can never share both.
   */
  const [picks, setPicks] = useState<Array<{ midi: number; t: number }>>([])
  const [selecting, setSelecting] = useState(false)
  const [clip, setClip] = useState<Note[]>([])
  /** the rectangle being dragged out, in grid cells; a ref because it changes per pointer event */
  const band = useRef<{ c0: number; r0: number; c1: number; r1: number } | null>(null)
  const [bandBox, setBandBox] = useState<{ c0: number; r0: number; c1: number; r1: number } | null>(
    null,
  )
  /** where you last put the pointer down, so a paste knows where you want it */
  const anchor = useRef<{ col: number; row: number } | null>(null)

  const isPicked = (n: Note) => picks.some((p) => p.midi === n.midi && Math.abs(p.t - n.t) < 1e-6)
  const picked = () => notes.filter(isPicked)
  const [drag, setDrag] = useState<Drag>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  const step = gridStep(bpm, quantize)
  const [drawLen, setDrawLen] = useState<number | null>(null)
  /**
   * ⚠️ HOLDING THE RIGHT BUTTON RUBS NOTES OUT, which is what a right button held down
   * means in every editor that has one. A single right-click already deleted one note; needing
   * to aim at each of twenty separately is the part that made clearing a passage tedious, and
   * the gesture people reach for instead is exactly this.
   *
   * A ref rather than state: it is read inside pointer handlers that fire far faster than React
   * re-renders, and nothing on screen depends on knowing about it except the notes that vanish.
   */
  const erasing = useRef(false)
  const metronome = useSyncExternalStore(
    subscribeLoop,
    () => loopState().metronome,
    () => loopState().metronome,
  )
  /** how long a note you draw comes out — the snap, unless you have said otherwise */
  const newDur = drawLen == null ? step : gridStep(bpm, drawLen)
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
  const [baseLo, baseHi] = useMemo(
    () => {
      const [a, b] = pitchRange(toNotes(layer.events, layer.len))
      const pad = Math.max(0, 24 - (b - a))
      return [Math.max(0, a - Math.ceil(pad / 2)), Math.min(127, b + Math.floor(pad / 2))]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer.id],
  )
  /**
   * ⚠️ SLIDING THE WINDOW IS ALLOWED; RESIZING IT STILL IS NOT.
   *
   * The note above is about the range CHANGING ON ITS OWN, and that stays true — a grid that
   * grows because of where you put a note moves every other note out from under your finger. A
   * shift you asked for is the opposite: you know the rows moved, because you moved them. So the
   * window keeps exactly its height and slides by whole octaves, which also means a note is
   * always the same distance from the row above it.
   *
   * Whole octaves rather than free scrolling so the labelled C rows stay where the eye expects.
   */
  const [octave, setOctave] = useState(0)
  useEffect(() => setOctave(0), [layer.id])
  const span = baseHi - baseLo
  const lo = Math.max(0, Math.min(127 - span, baseLo + octave * 12))
  const hi = lo + span
  const canUp = hi < 127
  const canDown = lo > 0
  const rows = useMemo(() => {
    const r: number[] = []
    for (let m = hi; m >= lo; m--) r.push(m)
    return r
  }, [lo, hi])
  const cols = Math.max(1, Math.round(layer.len / step))

  /**
   * ⚠️ THE TAKE IS FITTED TO THE PANEL, not drawn at a fixed size and left to overflow. Eight
   * bars at 1/16 is 128 steps, which at a fixed 32px is a four-thousand-pixel grid — so the
   * editor was mostly off-screen and reading a phrase meant scrolling back and forth over it.
   *
   * Only ever DOWN, to CELL_MIN: past that a note is too small to grab and scrolling is the
   * honest answer, and stretching a short take across a wide screen would make two bars look
   * like a symphony. Measured rather than guessed at with breakpoints, because the panel's width
   * depends on the window, the key column and whether this is a canvas pane.
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width))
    ro.observe(el)
    setAvail(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const cellW = avail > 0 ? Math.max(CELL_MIN, Math.min(CELL_W, Math.floor(avail / cols))) : CELL_W
  /* how the take divides into bars, for the ruler's numbers. A take is whatever length it was
     recorded at, so this is its own bars rather than the loop's. */
  const beat = 60 / bpm
  const bars = Math.max(1, Math.round(layer.len / (beat * 4)))
  const barW = (cols * cellW) / bars

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
      /**
       * ⚠️ A PICKED GROUP MOVES TOGETHER, by the same offset, all or nothing.
       *
       * Dragging one note of a selection and leaving the rest behind would take the phrase apart
       * — the intervals and the rhythm inside it are the thing you selected. So the offset the
       * dragged note wants is applied to every picked note, and if ANY of them would leave the
       * grid or land on another pitch's neighbour the whole move is refused rather than the
       * group arriving bent. Same rule as one note, applied to the set: nothing is ever lost by
       * dragging, and the pointer is still moving so it costs nothing to try again.
       */
      if (picks.length > 1 && isPicked(was)) {
        const dt = n.t - was.t
        const dm = n.midi - was.midi
        if (!dt && !dm) return notes
        const moving = new Map<number, Note>()
        for (let i = 0; i < next.length; i++) {
          if (!isPicked(next[i])) continue
          const t = next[i].t + dt
          const midi = next[i].midi + dm
          if (t < 0 || t > (cols - 1) * step || midi < lo || midi > hi) return notes
          moving.set(i, { ...next[i], t, midi })
        }
        for (const [i, m] of moving) {
          const clash = next.some(
            (o, j) =>
              j !== i &&
              !moving.has(j) &&
              o.midi === m.midi &&
              m.t < o.t + o.dur - 1e-6 &&
              m.t + m.dur > o.t + 1e-6,
          )
          if (clash) return notes
        }
        for (const [i, m] of moving) next[i] = m
        return next
      }
      if (hits(next, drag.i, n)) return notes
    } else {
      const endCol = Math.max(Math.round(n.t / step) + 1, drag.col + 1)
      // stretch up to the next note of this pitch and no further, so lengthening cannot
      // swallow a neighbour either
      n.dur = Math.min(layer.len - n.t, endCol * step - n.t, roomAfter(next, drag.i, n))
    }
    next[drag.i] = n
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, notes, cols, step, lo, hi, layer.len, picks])

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

  /**
   * Click the ruler to move the playhead there.
   *
   * ⚠️ IT KEEPS THE LAP YOU ARE IN. A take shorter than the loop tiles inside it, so a point
   * in the picture is several points in time and picking the first one would throw you back to
   * the top of the loop whenever you clicked near the end of a repetition — which reads as the
   * click being wrong rather than as a decision you did not know had been made. Staying in the
   * current repetition is the one answer nobody has to think about.
   *
   * The mapping is deliberately the same arithmetic as the playhead above, so the marker lands
   * exactly where you pressed rather than a fraction off.
   */
  const onRulerDown = (e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // ⚠️ the rect's OWN width, not cols * cellW — the two differ the moment anything is scaled,
    // and a fraction of the element is what a click along it actually means
    if (box.width <= 0 || layer.len <= 0) return
    const into = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * layer.len
    const lap = Math.floor((posRef.current % Math.max(loopLen, 1e-6)) / layer.len)
    seekTo(lap * layer.len + into)
  }

  // ── the playhead, positioned outside React ────────────────────────────────
  const posRef = useRef(position)
  posRef.current = position
  const cellRef = useRef(cellW)
  cellRef.current = cellW
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
      const x = own > 0 ? ((intoLoop % own) / own) * cols * cellRef.current : 0
      el.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cols])

  // ── dragging ──────────────────────────────────────────────────────────────
  /**
   * ⚠️ THE GRID MAY BE SCALED. getBoundingClientRect reports SCREEN pixels, and cellW and
   * ROW_H are CSS pixels — the same number only while nothing is transformed. On the canvas a
   * window is scaled, so dividing a screen distance by an unscaled cell size put every note in
   * the wrong column, further out the further you clicked from the top left.
   *
   * offsetWidth is the untransformed width, so the ratio between the two is the scale in force,
   * whatever produced it.
   */
  const cellFrom = (e: React.PointerEvent) => {
    const el = gridRef.current
    const box = el?.getBoundingClientRect()
    if (!el || !box) return null
    const scale = el.offsetWidth > 0 ? box.width / el.offsetWidth : 1
    return {
      col: Math.floor((e.clientX - box.left) / (cellW * scale)),
      row: Math.floor((e.clientY - box.top) / (ROW_H * scale)),
    }
  }

  const onNoteDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.button === 2 || (e.buttons & 2) !== 0) {
      erasing.current = true
      removeNote(notes[i])
      return
    }
    const n = notes[i]
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const c = cellFrom(e)
    if (!c) return
    anchor.current = { col: c.col, row: c.row }
    /**
     * ⚠️ IN SELECT MODE, AN UNPICKED NOTE JOINS THE PILE AND A PICKED ONE DRAGS IT.
     *
     * Both gestures start with a press on a note, so one of them has to be decided by what the
     * note already is. Picking things up one at a time and then moving the group is the order
     * you do it in anyway, and it means the group can be dragged without leaving the mode you
     * gathered it in. Taking a note back out is the box again, or Escape and start over.
     */
    if (selecting && !isPicked(n)) {
      setPicks((p) => [...p, { midi: n.midi, t: n.t }])
      setSel({ midi: n.midi, t: n.t })
      return
    }
    setSel({ midi: n.midi, t: n.t })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    const onGrip = (e.target as HTMLElement).classList?.contains('roll-grip')
    if (onGrip || e.clientX > box.right - Math.max(6, box.width * HANDLE)) {
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

  /** Rub out whatever note is under the pointer, if there is one. */
  const eraseAt = (e: React.PointerEvent) => {
    const c = cellFrom(e)
    if (!c) return
    const midi = hi - c.row
    const t = c.col * step
    /* ⚠️ the note SPANNING this cell, not one starting in it. A long note is erased by touching
       any part of it, which is what rubbing something out means — otherwise only its first cell
       would work and the rest would look like a bug. */
    const hit = notes.find(
      (n) => n.midi === midi && t >= n.t - 1e-6 && t < n.t + Math.max(n.dur, step) - 1e-6,
    )
    if (hit) removeNote(hit)
  }

  const onMove = (e: React.PointerEvent) => {
    if (band.current) {
      const c = cellFrom(e)
      if (!c) return
      band.current = { ...band.current, c1: c.col, r1: c.row }
      setBandBox(band.current)
      return
    }
    if (erasing.current) {
      eraseAt(e)
      return
    }
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
    erasing.current = false
    if (band.current) {
      const r = band.current
      band.current = null
      setBandBox(null)
      const c0 = Math.min(r.c0, r.c1)
      const c1 = Math.max(r.c0, r.c1)
      const r0 = Math.min(r.r0, r.r1)
      const r1 = Math.max(r.r0, r.r1)
      /* ⚠️ a note is caught if any part of it is inside the box, not only its start: a long note
         crossing the box is one you meant to catch, and requiring its head to be inside makes
         held notes almost impossible to pick */
      const got = notes.filter((n) => {
        const row = hi - n.midi
        if (row < r0 || row > r1) return false
        const a = Math.round(n.t / step)
        const b = Math.round((n.t + Math.max(n.dur, step)) / step) - 1
        return b >= c0 && a <= c1
      })
      setPicks(got.map((n) => ({ midi: n.midi, t: n.t })))
      setSel(got.length ? { midi: got[0].midi, t: got[0].t } : null)
      return
    }
    if (drag) commit(shown)
    setDrag(null)
  }

  /** Click an empty cell to put a note there. An occupied one is left alone. */
  const onGridDown = (e: React.PointerEvent) => {
    /* ⚠️ button 2 is the right one; buttons is checked too, because a drag that STARTS on a note
       and continues onto the grid arrives here with no fresh button press of its own */
    if (e.button === 2 || (e.buttons & 2) !== 0) {
      erasing.current = true
      eraseAt(e)
      return
    }
    const c = cellFrom(e)
    if (!c) return
    anchor.current = { col: c.col, row: c.row }
    /* ⚠️ a box on the grid selects; it never draws. Placing and selecting cannot share a drag,
       so selecting is a mode you turn on, the same decision the paint room made. */
    if (selecting) {
      band.current = { c0: c.col, r0: c.row, c1: c.col, r1: c.row }
      setBandBox(band.current)
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      return
    }
    const midi = hi - c.row
    if (midi < lo || midi > hi || c.col < 0 || c.col >= cols) return
    const t = c.col * step
    // ⚠️ clicking where a note already is must not drop a second one on top of it — the click
    // fell through the note element's own handler only because it was a miss, and a miss on an
    // occupied cell means the pointer was in the gap, not that you wanted two notes there
    if (occupied(notes, midi, t)) return
    /* clamped to what is left of the take: a bar-long note drawn in the last beat would
       otherwise be trimmed by the scheduler anyway, and silently coming out shorter than the
       button you pressed is worse than visibly hitting the end */
    const n: Note = { midi, t, dur: Math.min(newDur, loopLen - t) }
    audition(midi)
    const next = [...notes, n]
    // select the note you just made, by identity — see the note on `sel`
    setSel({ midi: n.midi, t: n.t })
    commit(next)
  }

  const dropPicks = () => setPicks([])

  const copyPicked = () => {
    const list = picked()
    if (list.length) setClip(list.map((n) => ({ ...n })))
  }
  const cutPicked = () => {
    const list = picked()
    if (!list.length) return
    setClip(list.map((n) => ({ ...n })))
    commit(notes.filter((n) => !isPicked(n)))
    dropPicks()
    setSel(null)
  }
  const deletePicked = () => {
    if (!picks.length) return
    commit(notes.filter((n) => !isPicked(n)))
    dropPicks()
    setSel(null)
  }

  /**
   * ⚠️ PASTED WHERE YOU LAST PUT THE POINTER, keeping the block's own shape.
   *
   * The alternative is pasting back exactly where it came from, which is invisible, or always a
   * bar later, which is only right when you happen to want that. Anchoring on the last cell you
   * touched means "click there, paste" — and because the whole block is moved by one offset, the
   * intervals and rhythm inside it survive, which is the only reason to copy a phrase at all.
   *
   * Anything that would land outside the take or on top of an existing note is dropped rather
   * than clamped: a paste that silently stacks notes or piles them against the last bar is worse
   * than one that plainly puts fewer notes down.
   */
  const pastePicked = () => {
    if (!clip.length) return
    const t0 = Math.min(...clip.map((n) => n.t))
    const top = Math.max(...clip.map((n) => n.midi))
    const a = anchor.current
    const toT = a ? a.col * step : t0 + step
    const toMidi = a ? hi - a.row : top
    const out = [...notes]
    const made: Array<{ midi: number; t: number }> = []
    for (const n of clip) {
      const t = toT + (n.t - t0)
      const midi = toMidi + (n.midi - top)
      if (midi < lo || midi > hi || t < 0 || t >= loopLen) continue
      if (occupied(out, midi, t)) continue
      const put = { midi, t, dur: Math.min(n.dur, loopLen - t) }
      out.push(put)
      made.push({ midi, t })
    }
    if (!made.length) return
    commit(out)
    setPicks(made)
    setSel(made[0])
  }

  /**
   * ⚠️ CHANGE ONE, CHANGE ALL — but only the ones you picked.
   *
   * With a group selected the length buttons stop meaning "what I draw next" and start meaning
   * "make these that long", because that is plainly what you are asking for while several notes
   * are lit. With nothing selected they go back to setting the next note's length, which is what
   * they have always done.
   */
  const setPickedLength = (dur: number) => {
    if (!picks.length) return
    commit(notes.map((n) => (isPicked(n) ? { ...n, dur: Math.min(dur, loopLen - n.t) } : n)))
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
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'c' && picks.length) {
        e.preventDefault()
        copyPicked()
        return
      }
      if (mod && k === 'x' && picks.length) {
        e.preventDefault()
        cutPicked()
        return
      }
      if (mod && k === 'v' && clip.length) {
        e.preventDefault()
        pastePicked()
        return
      }
      if (mod && k === 'a' && selecting) {
        e.preventDefault()
        setPicks(notes.map((n) => ({ midi: n.midi, t: n.t })))
        return
      }
      if (e.key === 'Escape' && picks.length) {
        dropPicks()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && picks.length) {
        e.preventDefault()
        deletePicked()
        return
      }
      if (e.key === 'Escape') onClose()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    /**
     * ⚠️ NO DEPENDENCY LIST, deliberately. This handler reads the picked notes, the clipboard and
     * the notes themselves, and a list that named only some of them left the shortcuts holding a
     * selection from several edits ago — Ctrl+C copying notes you had already replaced. Swapping
     * one window listener per render is far cheaper than the class of bug that causes.
     */
  })

  return (
    <div className="roll">
      <div className="roll-bar">
        <strong>Notes</strong>
        <span className="muted">
          {shown.length} note{shown.length === 1 ? '' : 's'} · {layer.len.toFixed(1)}s
        </span>
        <span className="muted roll-hint">
          Click to add · drag to move · drag the grip to resize ·{' '}
          <strong>right-click or double-click a note to delete it</strong>
        </span>
        {/* ⚠️ Sits with the editor's own tools, not with Snap out in the room. They read as one
            setting when they are next to each other, and being one setting is the thing that was
            wrong. */}
        <span className="roll-pick" role="group" aria-label="Selecting notes">
          <button
            className={'btn' + (selecting ? ' is-on' : '')}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((v) => !v)
              dropPicks()
            }}
            title="Drag a box round some notes, then copy, move or retime them together"
          >
            ⬚
          </button>
          {selecting && (
            <>
              <button
                className="btn"
                onClick={() => setPicks(notes.map((n) => ({ midi: n.midi, t: n.t })))}
                title="Select every note in this part"
              >
                All
              </button>
              <span className="muted roll-pick-count">
                {picks.length ? `${picks.length} picked` : 'drag a box'}
              </span>
              <button className="btn" onClick={copyPicked} disabled={!picks.length} title="Copy">
                ⧉
              </button>
              <button className="btn" onClick={cutPicked} disabled={!picks.length} title="Cut">
                ✂
              </button>
              <button
                className="btn"
                onClick={pastePicked}
                disabled={!clip.length}
                title="Paste where you last clicked"
              >
                📋{clip.length ? ` ${clip.length}` : ''}
              </button>
              <button
                className="btn"
                onClick={deletePicked}
                disabled={!picks.length}
                title="Delete the picked notes"
              >
                ✕
              </button>
            </>
          )}
        </span>
        <span className="roll-oct" role="group" aria-label="Which octaves are shown">
          <button
            className="btn"
            onClick={() => setOctave((v) => v + 1)}
            disabled={!canUp}
            title="Show higher notes"
          >
            ▲
          </button>
          <span className="muted roll-oct-at" title="The octaves on screen">
            {nameOf(lo)}–{nameOf(hi)}
          </span>
          <button
            className="btn"
            onClick={() => setOctave((v) => v - 1)}
            disabled={!canDown}
            title="Show lower notes"
          >
            ▼
          </button>
        </span>
        <span className="roll-len" role="group" aria-label="Length of notes you draw">
          <span className="muted">Length</span>
          {LENGTHS.map(([v, label]) => (
            <button
              key={label}
              className={'btn' + (drawLen === v ? ' is-on' : '')}
              aria-pressed={drawLen === v}
              onClick={() => {
                setDrawLen(v)
                /* ⚠️ with notes picked these stop meaning "what I draw next" and start meaning
                   "make these that long" — see setPickedLength */
                if (picks.length) setPickedLength(v == null ? step : gridStep(bpm, v))
              }}
              title={
                picks.length
                  ? `Make the ${picks.length} picked note${picks.length === 1 ? '' : 's'} ${label} long`
                  : v == null
                    ? 'Same as the snap'
                    : `Draw ${label}-length notes`
              }
            >
              {label}
            </button>
          ))}
        </span>
        <button
          className="btn"
          onClick={removeSelected}
          disabled={!sel}
          title="Delete the selected note (or right-click it)"
        >
          ✕ Note
        </button>
        {/* ⚠️ The click is ALSO here, not only out in the room's toolbar. Editing a part means
            listening to it over and over, and the metronome is the first thing you want gone —
            but the toolbar is above the layer list and off screen on a phone by the time the roll
            is open. A control you have to go looking for during the one task that needs it is a
            control in the wrong place. Same state, same setter, second doorway. */}
        <button
          className={'btn' + (metronome ? ' is-on' : '')}
          aria-pressed={metronome}
          onClick={() => setMetronome(!metronome)}
          title={metronome ? 'Silence the click' : 'Click on every beat'}
        >
          🎯 Click
        </button>
        <button className="btn" onClick={onClose} title="Close the editor (Esc)">
          Done
        </button>
      </div>

      <div className="roll-body">
        <div className="roll-keys" aria-hidden>
          {/* ⚠️ the ruler adds height on the right only, so without this the key names sit
              one strip lower than the rows they label. Same height, same place, no cleverness. */}
          <div className="roll-ruler-pad" />
          {rows.map((m) => (
            <div
              key={m}
              className={
                'roll-key' + (isBlack(m) ? ' is-black' : '') + (held.includes(m) ? ' is-held' : '')
              }
            >
              {m % 12 === 0 ? nameOf(m) : ''}
            </div>
          ))}
        </div>

        <div className="roll-scroll" ref={scrollRef}>
          {/* ⚠️ Inside the same scroller as the grid, so it cannot drift out of alignment
              when you scroll sideways. A ruler that does not line up with the notes is worse
              than none. */}
          <div
            className="roll-ruler"
            style={{ width: cols * cellW }}
            onPointerDown={onRulerDown}
            title="Click to jump the playhead here"
          >
            {Array.from({ length: bars }, (_, b) => (
              <span key={b} className="roll-ruler-bar" style={{ left: b * barW }}>
                {b + 1}
              </span>
            ))}
          </div>
          <div
            ref={gridRef}
            className="roll-grid"
            style={{ width: cols * cellW, height: rows.length * ROW_H }}
            onPointerDown={onGridDown}
            onPointerLeave={endDrag}
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
                style={{ left: i * cellW }}
              />
            ))}

            {/* ⚠️ behind the notes, never over them: this is a hint about where a pitch lives,
                and a band painted on top would hide the very notes you are placing */}
            {held.map((m) =>
              m >= lo && m <= hi ? (
                <div
                  key={'h' + m}
                  className="roll-held-row"
                  style={{ top: (hi - m) * ROW_H, height: ROW_H - 1 }}
                  aria-hidden
                />
              ) : null,
            )}
            {bandBox && (
              /* ⚠️ drawn over the grid and never committed anywhere: it is a gesture, not content */
              <div
                className="roll-band"
                style={{
                  left: Math.min(bandBox.c0, bandBox.c1) * cellW,
                  top: Math.min(bandBox.r0, bandBox.r1) * ROW_H,
                  width: (Math.abs(bandBox.c1 - bandBox.c0) + 1) * cellW,
                  height: (Math.abs(bandBox.r1 - bandBox.r0) + 1) * ROW_H,
                }}
              />
            )}
            {shown.map((n, i) => (
              <div
                key={i}
                className={
                  'roll-note' +
                  (isSame(n, sel) ? ' is-sel' : '') +
                  (isPicked(n) ? ' is-picked' : '')
                }
                style={{
                  left: (n.t / step) * cellW,
                  top: (hi - n.midi) * ROW_H,
                  width: Math.max(6, (n.dur / step) * cellW - 1),
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
              >
                {/* ⚠️ A REAL ELEMENT, not just a coordinate range. It draws the affordance, it
                    carries its own ew-resize cursor, and it can be widened for a fingertip
                    without widening the invisible zone that decides move-versus-resize. */}
                <span className="roll-grip" aria-hidden />
              </div>
            ))}

            <div ref={headRef} className="roll-head" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}
