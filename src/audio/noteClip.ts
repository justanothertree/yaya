import type { Note } from './noteEdit'

/**
 * Copied notes, for every part's piano roll — the clipboard that lets a phrase leave the part it
 * was played in. Evan, 15 Nov 2026: "copy notes between layers".
 *
 * ⚠️ IT WAS COMPONENT STATE, so copying only ever reached the part it came from — and only
 * because the roll happened not to remount when you switched straight from one part's notes to
 * another's. Close the editor in between and the clipboard went with it. Here it outlives the
 * editor, so copy in one part, open another, paste.
 *
 * ⚠️ NOT THE SYSTEM CLIPBOARD. Notes are not text anybody pastes into a message, and reading the
 * real clipboard asks the browser for a permission this room has no business asking for.
 *
 * The placement is pure (`placeClip`, `sameBarShift`, `atPlayhead`) so "where does it land, and
 * what is refused" is asked in noteClip.test.ts without a browser.
 */

export type Clip = {
  /** the notes, at their own times in the part they were copied from */
  notes: Note[]
  /** which part they came from, by id, so the roll can say "from part 2" */
  from: string
}

/** where a paste lands: under the playhead, in the bar it came from, or where you last clicked */
export type PasteAt = 'playhead' | 'same' | 'clicked'

let clip: Clip | null = null
let pasteAt: PasteAt = 'same'
/**
 * A paste waiting for its part's editor to open — "copy all its notes to…" (PartPanel).
 *
 * ⚠️ THE PASTE HAPPENS IN THE TARGET'S OWN EDITOR, not here, so it is one entry on THAT editor's
 * undo — the ↶ under the notes you are now looking at takes it back. Writing the notes from the
 * other part's menu would have put the only undo for them in the room's history, which stands
 * down while an editor is open.
 */
let pending: { into: string } | null = null
const listeners = new Set<() => void>()
type ClipView = { clip: Clip | null; pasteAt: PasteAt; pending: { into: string } | null }
let view: ClipView = { clip, pasteAt, pending }
const tell = () => {
  view = { clip, pasteAt, pending }
  for (const fn of listeners) fn()
}

export function copyNotes(notes: readonly Note[], from: string) {
  if (!notes.length) return
  clip = { notes: notes.map((n) => ({ ...n })), from }
  tell()
}

/** copy these notes and paste them into `into`, in the same bars, as soon as its editor opens */
export function copyInto(notes: readonly Note[], from: string, into: string) {
  if (!notes.length) return
  clip = { notes: notes.map((n) => ({ ...n })), from }
  pending = { into }
  tell()
}

/** the waiting paste is being done — see `pending` */
export function takePending() {
  if (!pending) return
  pending = null
  tell()
}

export function setPasteAt(at: PasteAt) {
  if (at === pasteAt) return
  pasteAt = at
  tell()
}

export const clipNow = () => view

export function subscribeClip(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * The shift that puts a block back in the bar it came from, in a part that may be shorter.
 *
 * ⚠️ A SHORTER PART PLAYS ITS BARS OVER AGAIN, so "the same bar" in a one-bar drum loop is the
 * point of that bar where the moment falls: notes copied from bar 3 of a four-bar melody land in
 * bar 1 of a one-bar part at the same beat, which is when the part plays them in bar 3 too. The
 * whole block moves by one shift, so its rhythm survives; whatever then runs off the end of the
 * part is refused and counted by placeClip.
 */
export function sameBarShift(notes: readonly Note[], len: number): number {
  if (!notes.length || !(len > 0)) return 0
  const t0 = Math.min(...notes.map((n) => n.t))
  return -Math.floor(t0 / len + 1e-9) * len
}

/**
 * The shift that starts a block under the playhead, on the grid.
 *
 * `at` is the playhead's moment in the TARGET part (the loop's position folded into the part's
 * own length, as the roll's own playhead is drawn), and it is rounded to the nearest cell so the
 * phrase lands on the beat it was copied on rather than a few milliseconds off it.
 */
export function atPlayhead(notes: readonly Note[], at: number, step: number, len: number): number {
  if (!notes.length) return 0
  const t0 = Math.min(...notes.map((n) => n.t))
  let to = step > 0 ? Math.round(at / step) * step : at
  if (to >= len - 1e-6) to = 0
  return to - t0
}

/**
 * The notes a paste would add, moved by `shift` (and by `pitch` semitones), into `into` — never
 * on top of a note that is already there.
 *
 * ⚠️ NOTHING THAT IS ALREADY THERE CHANGES. A pasted note whose start falls inside a note of its
 * own pitch is refused; one that would run into the next note of its pitch is shortened to meet
 * it, which is the trim the normaliser would make anyway (toEvents) and keeps every start where it
 * was copied. A note off either end of the part, or off the keyboard, is refused. Everything
 * refused is COUNTED, so the roll can say so rather than paste fewer notes in silence.
 */
export function placeClip(
  clipNotes: readonly Note[],
  into: readonly Note[],
  len: number,
  shift: number,
  pitch = 0,
): { notes: Note[]; placed: Note[]; refused: number } {
  const out = into.map((n) => ({ ...n }))
  const placed: Note[] = []
  let refused = 0
  for (const n of [...clipNotes].sort((a, b) => a.t - b.t)) {
    const t = n.t + shift
    const midi = n.midi + pitch
    if (t < -1e-6 || t >= len - 1e-6 || midi < 0 || midi > 127) {
      refused++
      continue
    }
    const at = Math.max(0, t)
    const same = out.filter((o) => o.midi === midi)
    if (same.some((o) => at >= o.t - 1e-6 && at < o.t + o.dur - 1e-6)) {
      refused++
      continue
    }
    const next = same.filter((o) => o.t > at + 1e-6).reduce((m, o) => Math.min(m, o.t), len)
    const dur = Math.min(n.dur, next - at, len - at)
    if (dur <= 0.03) {
      refused++
      continue
    }
    const put = { midi, t: at, dur }
    out.push(put)
    placed.push(put)
  }
  out.sort((a, b) => a.t - b.t || a.midi - b.midi)
  return { notes: out, placed, refused }
}
