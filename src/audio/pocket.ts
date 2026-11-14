import { assignSyllables, type SungNote, type Syllable } from './lyrics'
import type { Note } from './noteEdit'

/**
 * Typed lyrics onto a layer's notes so they land in the pocket: on the grid, stressed syllables on
 * strong beats, and the words spread across the melody rather than bunched at its start.
 *
 * ⚠️ PURE, like lyrics.ts — which note "night" lands on is a question with a right answer, and it
 * is asked in singer.test.ts and pocket.test.ts without a browser. singer.ts places the consonant
 * before each vowel; this decides where the vowels are.
 *
 * See docs/2026-11-14-singer-pocket.md.
 */

/** notes starting closer together than this are one sung note: a chord, or a flam */
export const TOGETHER = 0.03

/**
 * A layer's notes as a line one voice can sing: where several start together (a chord), the top
 * one. A chord layer used to give each of its notes a syllable, so three syllables started at the
 * same instant.
 */
export function melodyOf(notes: readonly Note[]): Note[] {
  const order = [...notes].sort((a, b) => a.t - b.t || b.midi - a.midi)
  const out: Note[] = []
  let groupAt = -Infinity
  for (const n of order) {
    if (n.t - groupAt < TOGETHER) continue
    groupAt = n.t
    out.push({ t: n.t, dur: n.dur, midi: n.midi })
  }
  return out
}

/**
 * Each note's start onto the grid, and its end onto the grid where that leaves it a sensible length.
 *
 * ⚠️ TWO NOTES NEVER SHARE A STEP: the later one moves a step on, so nothing a person played is
 * lost to rounding. And a note never runs into the next one, which would hide the next consonant.
 */
export function snapToGrid(notes: readonly Note[], step: number): Note[] {
  const out: Note[] = []
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const prev = out[out.length - 1]
    let t = Math.round(n.t / step) * step
    if (prev && t <= prev.t + 1e-9) t = prev.t + step
    const end = Math.max(t + step / 2, Math.round((n.t + n.dur) / step) * step)
    out.push({ t, dur: end - t, midi: n.midi })
  }
  for (let i = 0; i + 1 < out.length; i++)
    out[i].dur = Math.min(out[i].dur, out[i + 1].t - out[i].t)
  return out
}

/**
 * How strong a moment in the bar is: the downbeat, the middle of a 4/4 bar, a beat, an eighth,
 * anything finer. `t` is from the top of the loop.
 */
export function strength(t: number, beat: number, perBar = 4): number {
  const b = t / beat
  const on = (x: number) => Math.abs(x - Math.round(x)) < 1e-3
  if (on(b / perBar)) return 1
  if (perBar % 2 === 0 && on(b / (perBar / 2))) return 0.8
  if (on(b)) return 0.6
  if (on(b * 2)) return 0.35
  return 0.15
}

/**
 * More syllables than notes: split the longest note on the beat grid, one at a time, until every
 * syllable has a note or no note is a beat long. "glit-ter" on one long note becomes two halves.
 */
export function makeRoom(notes: readonly Note[], want: number, beat: number): Note[] {
  const out = notes.map((n) => ({ ...n }))
  const half = beat / 2
  while (out.length < want) {
    let at = -1
    out.forEach((n, i) => {
      if (n.dur >= beat - 1e-9 && (at < 0 || n.dur > out[at].dur + 1e-9)) at = i
    })
    if (at < 0) break
    const n = out[at]
    const cut = Math.max(half, Math.round(n.dur / 2 / half) * half)
    out.splice(at, 1, { ...n, dur: cut }, { t: n.t + cut, dur: n.dur - cut, midi: n.midi })
  }
  return out
}

export type Grid = {
  /** seconds per beat */
  beat: number
  /** the snap, in seconds; a sixteenth if left out */
  step?: number
  perBar?: number
}

/**
 * Syllables onto a layer's notes, in the pocket. Returns the same shape as assignSyllables, so the
 * panel's preview and the singer read it the same way.
 *
 * - One voice: a chord sings its top note (melodyOf).
 * - On the grid: starts and ends snapped to sixteenths (snapToGrid).
 * - Too many syllables: long notes split on the beat grid (makeRoom), and whatever still does not
 *   fit is counted, never dropped silently.
 * - Too many notes: the syllables are SPREAD (place), and the notes between them are holds.
 */
export function fitSyllables(
  notes: readonly Note[],
  syls: readonly Syllable[],
  grid: Grid,
): { sung: SungNote[]; spare: number } {
  const step = grid.step ?? grid.beat / 4
  const line = makeRoom(snapToGrid(melodyOf(notes), step), syls.length, grid.beat)
  if (syls.length >= line.length || !syls.length) return assignSyllables(line, syls)
  const at = place(line, syls, grid.beat, grid.perBar ?? 4)
  const sung: SungNote[] = []
  let k = -1
  let last = 'oo'
  line.forEach((n, i) => {
    if (at[k + 1] === i) {
      k++
      const s = syls[k]
      if (!s.hold) {
        last = s.text
        sung.push({ ...n, text: s.text, hold: false })
        return
      }
    }
    sung.push({ ...n, text: last, hold: i > 0 })
  })
  return { sung, spare: 0 }
}

/**
 * Which note each syllable starts on, when there are more notes than syllables — the best-scoring
 * of every way to keep them in order, by dynamic programming over (syllable, note).
 *
 * A stressed syllable earns the strength of the beat it lands on, plus a little for a long note; a
 * light one ("the", the "-ter" of glitter) loses a little for a strong beat, so it sits between
 * them. A word that starts right after a rest earns a little, because that is where a singer
 * breathes. The notes after a syllable are holds of its vowel, and holds cost: a run of h costs h²
 * (so they spread out rather than pile up at the end of the line), more inside a word than at its
 * end, and each hold that comes after a rest costs extra, because it re-sings a vowel out of
 * nowhere. The first syllable is always on the first note: a voice that comes in on a hold sings
 * "oo".
 *
 * ⚠️ THE WEIGHTS ARE CHOICES, NOT MEASUREMENTS. The tests pin what they must produce — the stressed
 * syllable on the beat, the line spread to its end — rather than the numbers.
 */
export function place(
  line: readonly Note[],
  syls: readonly Syllable[],
  beat: number,
  perBar = 4,
): number[] {
  const N = line.length
  const S = syls.length
  /* a breath is a beat of silence; a staccato bass line's short gaps are articulation, not
     phrasing, and reading them as breaths sent its stressed words to whichever note followed one */
  const rest = line.map((n, i) => i > 0 && n.t - (line[i - 1].t + line[i - 1].dur) >= beat - 1e-6)
  const gain = (k: number, i: number) => {
    const s = syls[k]
    if (s.hold) return 0
    const str = strength(line[i].t, beat, perBar)
    const lands = s.stress >= 0.75 ? s.stress * (str + 0.3 * Math.min(1, line[i].dur / beat)) : 0
    /* a light syllable ("the", the "-ter" of glitter) would rather be off the beat */
    const dodges = s.stress < 0.75 ? -(0.75 - s.stress) * 2 * str : 0
    return lands + dodges + (s.start && rest[i] ? 0.4 : 0)
  }
  /* the holds of syllable k over the notes strictly between `from` and `to` */
  const holds = (k: number, from: number, to: number) => {
    const h = to - from - 1
    if (h <= 0) return 0
    const inWord = !syls[k].hold && !syls[k].end
    let c = (inWord ? 0.3 : 0.1) * h * h
    for (let j = from + 1; j < to; j++) if (rest[j]) c += 0.6
    return c
  }
  const best: number[][] = Array.from({ length: S }, () => new Array<number>(N).fill(-Infinity))
  const from: number[][] = Array.from({ length: S }, () => new Array<number>(N).fill(-1))
  best[0][0] = gain(0, 0)
  for (let k = 1; k < S; k++)
    for (let i = k; i <= N - (S - k); i++)
      for (let j = k - 1; j < i; j++) {
        if (best[k - 1][j] === -Infinity) continue
        const v = best[k - 1][j] - holds(k - 1, j, i) + gain(k, i)
        if (v > best[k][i]) {
          best[k][i] = v
          from[k][i] = j
        }
      }
  let end = S - 1
  let top = -Infinity
  for (let i = S - 1; i < N; i++) {
    const v = best[S - 1][i] - holds(S - 1, i, N)
    if (v > top) {
      top = v
      end = i
    }
  }
  const at = new Array<number>(S)
  for (let k = S - 1, i = end; k >= 0; i = from[k][i], k--) at[k] = i
  return at
}
