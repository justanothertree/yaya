/**
 * The song's timeline: where a bar is drawn, and where a dragged recording goes.
 *
 * ⚠️ PURE, so the arithmetic can be asked a question without a browser — the same reason
 * punchIn.ts and play.ts are. The parts list (LayerList.tsx) measures the page and handles the
 * pointer; everything it does with those numbers is here.
 *
 * Evan, 21 Nov 2026: "A timeline for the main track … showing every part … on one shared
 * playhead. I should be able to drag clips and samples to a position, snapped to the beat by
 * default with a way to turn snapping off."
 */

/** The bars of a song, as drawn: pixels from one bar line to the next, and seconds in a bar. */
export type Scale = { pitch: number; barLen: number }

/** The song a recording is moved in. */
export type Song = {
  /** seconds in a beat */
  beat: number
  /** seconds in one pass of the song */
  len: number
  beatsPerBar: number
}

/** The least of a recording that must be left inside the song when it is placed without snapping. */
export const MIN_HEARD = 0.05

/** How far one arrow key moves a recording with snapping off: about the width of a consonant. */
export const NUDGE = 0.01

/**
 * How wide one bar is drawn, so a song's bars fill the strip they sit in.
 *
 * ⚠️ A BAR WAS ALWAYS 12px, which made a four-bar song a 56px strip in a window 700px wide, with
 * three pixels to a beat — nothing anybody could drag a recording along. Filling the strip gives
 * the same song 170px a bar on a desktop. A long song still scrolls, because a bar is never drawn
 * narrower than `min`, which is the size a bar's own tile already is.
 *
 * @param strip the width available, in pixels
 * @param gap the space between two bars, which the last bar does not need
 */
export function fitBar(strip: number, bars: number, gap: number, min: number, max: number): number {
  if (!(strip > 0) || !(bars >= 1)) return min
  const w = Math.floor((strip + gap) / Math.round(bars) - gap)
  return Math.max(min, Math.min(max, w))
}

/** Where a moment in the song is drawn, in pixels from the first bar line. */
export const xAt = (t: number, s: Scale): number => (t / s.barLen) * s.pitch

/** The moment in the song a distance along the strip stands for. */
export const tAt = (x: number, s: Scale): number => (x / s.pitch) * s.barLen

/** Seconds, to the millisecond — the precision every placement is kept at (punchIn.ts). */
const ms = (t: number) => Math.round(t * 1000) / 1000

/**
 * Where a recording at `from` goes when it is moved by `by` seconds.
 *
 * ⚠️ SNAPPING MOVES IT IN WHOLE BEATS; IT DOES NOT PUT ITS START ON A BEAT. A recording's start
 * is where the recorder began, not where the sound does: a take punched in at 3.12s has its
 * singing landing on the beat at 4.0, and snapping its START to 3.0 or 3.5 would move every word
 * off the beat it was sung on. Moved in whole beats, a take that was in time stays in time
 * wherever it goes. A sound that starts at the top of the song — anything recorded with the song
 * stopped, and every file opened from disk — is on the beat already, so for those whole beats and
 * the grid are the same thing.
 *
 * Kept inside the song: never before the top, and never so near the end that it plays nothing,
 * because a recording is cut where each pass ends (looper.ts). With snapping on it stays on its
 * own grid at both ends, so the nearest it gets to the top is less than a beat in.
 */
export function moveBy(from: number, by: number, o: Song & { snap: boolean }): number {
  if (!Number.isFinite(from) || !Number.isFinite(by) || !(o.len > 0)) return Math.max(0, from || 0)
  if (o.snap && o.beat > 0) {
    const last = o.len - o.beat
    /* the furthest whole beats it can go either way, with a hair of slack so 3.0 / 0.5 counts as 6 */
    const back = -Math.floor(from / o.beat + 1e-6)
    const on = Math.floor((last - from) / o.beat + 1e-6)
    const k = Math.max(back, Math.min(on, Math.round(by / o.beat)))
    return ms(Math.max(0, from + k * o.beat))
  }
  return ms(Math.max(0, Math.min(o.len - MIN_HEARD, from + by)))
}

/**
 * Where a recording being dragged goes, given how far the pointer has moved along the strip.
 *
 * ⚠️ A FEW PIXELS OF WOBBLE IS A TAP, NOT A DRAG. A finger never lands and lifts in the same
 * place, and without snapping every pixel is a place — so a tap meant to focus a recording would
 * nudge it by the width of a pixel. Nothing moves until the pointer has gone `slop` pixels.
 */
export function dragTo(
  from: number,
  dx: number,
  o: Song & { snap: boolean; scale: Scale; slop?: number },
): number {
  if (Math.abs(dx) < (o.slop ?? 3)) return from
  return moveBy(from, tAt(dx, o.scale), o)
}

/** Where one press of an arrow key moves a recording: a beat when snapping, a nudge when not, a bar with Shift. */
export function stepFor(o: Song & { snap: boolean }, bar: boolean): number {
  if (bar) return o.beat * o.beatsPerBar
  return o.snap ? o.beat : NUDGE
}

/** How much of a recording at `at` is heard in one pass, which is all of it unless the pass ends first. */
export const heardFor = (at: number, dur: number, len: number): number =>
  Math.max(0, Math.min(dur, len - at))

/**
 * Where a moment is, in the words a musician counts in: bar and beat from 1, and how far past that
 * beat it falls, in milliseconds.
 */
export function whereIs(at: number, o: Song): { bar: number; beat: number; past: number } {
  if (!(o.beat > 0) || !Number.isFinite(at) || at < 0) return { bar: 1, beat: 1, past: 0 }
  const beats = Math.floor(at / o.beat + 1e-6)
  const past = Math.max(0, Math.round((at - beats * o.beat) * 1000))
  return { bar: Math.floor(beats / o.beatsPerBar) + 1, beat: (beats % o.beatsPerBar) + 1, past }
}

/** The same, as the words a row or a screen reader says. */
export function sayWhere(at: number, o: Song): string {
  const w = whereIs(at, o)
  return `bar ${w.bar}, beat ${w.beat}${w.past ? ` + ${w.past} ms` : ''}`
}
