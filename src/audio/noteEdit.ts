import type { LoopEvent } from './looper'

/**
 * Turning a take into something you can edit, and back again.
 *
 * A recording is a stream of note-ONS and note-OFFS, because that is what a keyboard produces and
 * what a scheduler consumes. A piano roll is made of NOTES — a pitch, a start and a length — and
 * those are two genuinely different shapes, not two names for one. Everything awkward about
 * editing a take lives in the gap between them, so it lives in this file rather than being
 * scattered through the component that draws the grid.
 */

export type Note = {
  midi: number
  /** seconds from the top of the take */
  t: number
  /** seconds; always > 0 */
  dur: number
}

/**
 * ⚠️ No note may end exactly on the take's boundary.
 *
 * The scheduler refuses events at or past the end of the loop they belong to — that guard is what
 * stops a repetition spilling into the next one. A note-off landing exactly on the boundary is
 * therefore never scheduled, and its note-on has already sounded: the note rings until Panic.
 * Every length is trimmed to keep this much room, which is under a frame and inaudible.
 */
const EDGE = 0.02
/** Shorter than this and it is a click rather than a note. */
const MIN_DUR = 0.03

/**
 * Events to notes.
 *
 * ⚠️ Handles a note-on for a pitch that is ALREADY sounding by ending the previous one there.
 * That is a retrigger, and it happens for real: hold a key, and a loop coming round starts the
 * same pitch again before the first has been released. Treating it as an error and dropping one
 * of them would silently lose a note the player definitely played.
 *
 * Anything still open when the events run out is closed at `len`. A committed take should never
 * contain one — commitTake closes held notes — but this function is also the thing an editor
 * round-trips through, and it must not be the place a malformed take becomes an infinite note.
 */
export function toNotes(events: LoopEvent[], len: number): Note[] {
  const open = new Map<number, number>()
  const out: Note[] = []
  const close = (midi: number, at: number) => {
    const start = open.get(midi)
    if (start === undefined) return
    open.delete(midi)
    const dur = at - start
    if (dur >= MIN_DUR) out.push({ midi, t: start, dur })
  }
  for (const e of [...events].sort((a, b) => a.t - b.t || (a.on ? 1 : 0) - (b.on ? 1 : 0))) {
    if (e.on) {
      close(e.midi, e.t)
      open.set(e.midi, e.t)
    } else {
      close(e.midi, e.t)
    }
  }
  for (const [midi] of open) close(midi, len)
  return out.sort((a, b) => a.t - b.t || a.midi - b.midi)
}

/**
 * Notes back to events.
 *
 * ⚠️ Overlaps on the SAME PITCH are resolved by shortening the earlier note, not by allowing
 * both. One oscillator answers to one pitch in the scheduler's bookkeeping, so an overlap turns
 * into on-on-off-off — the second note-on retriggers the voice, the first note-off stops it, and
 * the second note-off finds nothing. What you drew as two overlapping notes plays as one short
 * one and then silence. Trimming the earlier note to meet the later one is what the picture
 * already looks like it means.
 */
export function toEvents(notes: Note[], len: number): LoopEvent[] {
  const limit = Math.max(MIN_DUR, len - EDGE)
  const byPitch = new Map<number, Note[]>()
  for (const n of notes) {
    if (!Number.isFinite(n.midi) || n.midi < 0 || n.midi > 127) continue
    const t = Math.max(0, Math.min(limit - MIN_DUR, n.t))
    const dur = Math.max(MIN_DUR, Math.min(limit - t, n.dur))
    const list = byPitch.get(n.midi)
    if (list) list.push({ midi: n.midi, t, dur })
    else byPitch.set(n.midi, [{ midi: n.midi, t, dur }])
  }
  const out: LoopEvent[] = []
  for (const [midi, list] of byPitch) {
    list.sort((a, b) => a.t - b.t)
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      const next = list[i + 1]
      let end = n.t + n.dur
      if (next && end > next.t) end = next.t
      if (end - n.t < MIN_DUR) continue // swallowed entirely by the note after it
      out.push({ t: n.t, midi, on: true })
      out.push({ t: Math.min(limit, end), midi, on: false })
    }
  }
  return out.sort((a, b) => a.t - b.t || (a.on ? 1 : 0) - (b.on ? 1 : 0))
}

/** The grid step in seconds for a quantise setting — 4 quarters, 8 eighths, 16 sixteenths. */
export function gridStep(bpm: number, quantize: number): number {
  const q = quantize || 8
  return (60 / bpm) * (4 / q)
}

/** The pitch range a roll should show: what is there, padded, and never uselessly narrow. */
export function pitchRange(notes: Note[]): [number, number] {
  if (!notes.length) return [48, 72]
  let lo = 127
  let hi = 0
  for (const n of notes) {
    lo = Math.min(lo, n.midi)
    hi = Math.max(hi, n.midi)
  }
  lo -= 2
  hi += 2
  // a take on one note would otherwise be a single row, with nowhere to drag a new note to
  while (hi - lo < 14) {
    hi++
    if (hi - lo < 14) lo--
  }
  return [Math.max(0, lo), Math.min(127, hi)]
}
