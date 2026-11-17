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
  return melodyIndex(notes).map((i) => ({ t: notes[i].t, dur: notes[i].dur, midi: notes[i].midi }))
}

/** melodyOf as indices into `notes`, in time order — for a caller that must find the note again */
export function melodyIndex(notes: readonly Note[]): number[] {
  const order = notes
    .map((_, i) => i)
    .sort((a, b) => notes[a].t - notes[b].t || notes[b].midi - notes[a].midi)
  const out: number[] = []
  let groupAt = -Infinity
  for (const i of order) {
    if (notes[i].t - groupAt < TOGETHER) continue
    groupAt = notes[i].t
    out.push(i)
  }
  return out
}

/**
 * A grid that repeats every beat: the points of one beat as fractions of it, from 0 and below 1.
 * Every grid here has a point on the beat, so a downbeat is a downbeat whatever the feel.
 */
export type Lattice = { beat: number; at: readonly number[] }

/** `perBeat` evenly spaced points: 1 is quarters, 2 eighths, 4 sixteenths, 3 and 6 triplets */
export const evenly = (beat: number, perBeat: number): Lattice => ({
  beat,
  at: Array.from({ length: perBeat }, (_, i) => i / perBeat),
})

/** the point of `l` nearest `t`; halfway rounds up, as Math.round does */
export function nearestOn(l: Lattice, t: number): number {
  const k = Math.floor(t / l.beat)
  const f = t / l.beat - k
  let best = l.at[0]
  for (const a of [...l.at, 1]) if (Math.abs(a - f) <= Math.abs(best - f) + 1e-12) best = a
  return (k + best) * l.beat
}

/** the last point of `l` before `t` */
function lastBefore(l: Lattice, t: number): number {
  const k = Math.floor(t / l.beat - 1e-9)
  for (let i = l.at.length - 1; i >= 0; i--)
    if ((k + l.at[i]) * l.beat < t - 1e-9) return (k + l.at[i]) * l.beat
  return (k - 1 + l.at[l.at.length - 1]) * l.beat
}

/** the first point of `l` after `t` */
function nextOn(l: Lattice, t: number): number {
  const k = Math.floor(t / l.beat + 1e-9)
  for (const a of l.at) if ((k + a) * l.beat > t + 1e-9) return (k + a) * l.beat
  return (k + 1) * l.beat
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * How far a line sits behind the beat (or ahead of it, below zero), in seconds: the median of its
 * notes near a beat. Every grid here has the beat in it, so this is the one lean they share.
 *
 * ⚠️ A STEADY LEAN HIDES A FEEL. A player 15ms behind throughout is that far from every grid,
 * which drowned the difference between them and read a clear swing as straight; it also moved a
 * late swung off-beat nearer the next sixteenth than its own point. So the feel is read, and the
 * line snapped, with the lean taken out.
 */
function leanOf(line: readonly Note[], beat: number): number {
  const near = line
    .map((n) => n.t - Math.round(n.t / beat) * beat)
    /* a 32nd either side: wider, and a late swung sixteenth counts as an early beat */
    .filter((d) => Math.abs(d) < beat / 16)
  return near.length ? median(near) : 0
}

/** how far the notes' starts sit from the grid: the mean distance to the nearest point, in beats */
function residual(line: readonly Note[], l: Lattice): number {
  let sum = 0
  for (const n of line) sum += Math.abs(n.t - nearestOn(l, n.t))
  return sum / line.length / l.beat
}

/**
 * A line's swing, measured: how late the second of each pair of `u`-beat steps comes, as a
 * fraction of `u`. 1/3 is full swing, the arpeggio's, which lands on the triplet; 0 is straight.
 * Null when the line has too few off-beats to say. The line's lean is already out (leanOf), so
 * this is measured from the beat.
 */
function swingOf(line: readonly Note[], beat: number, u: number): number | null {
  const off: number[] = []
  for (const n of line) {
    const pair = n.t / beat / (2 * u)
    const phase = pair - Math.floor(pair)
    if (phase >= 0.375 && phase < 0.8) off.push(phase - 0.5)
  }
  if (off.length < 2) return null
  /* a pair is two steps, so twice its phase is the fraction of a step */
  return 2 * median(off)
}

/** the straight grid with every odd multiple of `u` beats moved `by` of a `u` later */
function swung(beat: number, perBeat: number, u: number, by: number): Lattice {
  const at = evenly(beat, perBeat).at.map((a) => {
    const k = Math.round(a / u)
    return Math.abs(a - k * u) < 1e-9 && k % 2 === 1 ? a + by * u : a
  })
  return { beat, at: [...new Set(at)].sort((a, b) => a - b) }
}

/**
 * A swing lighter than this (55:45 eighths) reads as a loose straight line. It also refuses an
 * EARLY swing, which is not a feel: swung eighths at 70:30 read, a pair of sixteenths down, as
 * sixteenths played early, and on Snap 1/8 that drew a grid with no swung off-beat in it at all.
 */
const SWING_FLOOR = 0.1
/** how much closer a feel's grid must fit than the straight one before the line is read in it */
const FEEL_WINS = 0.6

export type Feel = {
  kind: 'straight' | 'triplet' | 'swing'
  /** a swing's off-beats: how late they come, as a fraction of a step */
  swing: number
  /** where a note may land, coarsest first — see snapToGrid */
  levels: Lattice[]
  /** how far behind the beat the line was played, in seconds (leanOf) */
  lean: number
}

/**
 * The grid a line is sung on: the room's Snap, drawn in the line's own feel.
 *
 * - `snap` is the room's Snap, 4, 8 or 16; Off sings on sixteenths.
 * - A swung or triplet line keeps its feel. Its off-beats land where it puts them, rather than on
 *   the straight eighth that would undo the swing. Which grid the line's notes sit closest to —
 *   straight, triplets, or a swing measured from the line itself — is asked at sixteenths whatever
 *   the Snap: the feel belongs to the line, and the Snap only says how coarse a grid to draw in it.
 * - Straight wins every tie and any close call. A loose straight line is far commoner than a
 *   swing, and straightening a swing by mistake is the gentler error.
 *
 * ⚠️ A COARSE SNAP HAS FINER LEVELS UNDER IT. On quarters, a line of eighths put two notes on each
 * beat and moved the later one a step on, then the next one, so the whole line marched later and
 * later. A note that loses its point to a closer note falls to the next level down instead.
 */
export function feelOf(played: readonly Note[], beat: number, snap = 0): Feel {
  const lean = leanOf(played, beat)
  const line = played.map((n) => ({ ...n, t: n.t - lean }))
  const room = snap === 4 ? 1 : snap === 8 ? 2 : 4
  /* the Snap's level and each finer one down to sixteenths, every one drawn by `draw` */
  const down = (draw: (perBeat: number) => Lattice) => {
    const out: Lattice[] = []
    for (let r = room; r <= 4; r *= 2) out.push(draw(r))
    return out
  }
  const straight: Feel = { kind: 'straight', swing: 0, levels: down((r) => evenly(beat, r)), lean }
  if (line.length < 3) return straight
  const options: Array<{ feel: Feel; fit: number }> = []
  /* quarters have only the beat, which every feel shares */
  const triplets = (r: number) => evenly(beat, r === 1 ? 1 : (r * 3) / 2)
  options.push({
    feel: { kind: 'triplet', swing: 0, levels: down(triplets), lean },
    fit: residual(line, triplets(4)),
  })
  for (const u of [1 / 4, 1 / 2]) {
    const by = swingOf(line, beat, u)
    if (by === null || by < SWING_FLOOR) continue
    const swing = Math.min(by, 0.5)
    /* a swing of sixteenths is drawn only where sixteenths are, and eighths only where eighths are */
    const draw = (r: number) => (r * u >= 1 ? swung(beat, r, u, swing) : evenly(beat, r))
    options.push({
      feel: { kind: 'swing', swing, levels: down(draw), lean },
      fit: residual(line, draw(4)),
    })
  }
  let best = straight
  let fit = residual(line, evenly(beat, 4)) * FEEL_WINS
  for (const o of options)
    if (o.fit < fit - 1e-9) {
      best = o.feel
      fit = o.fit
    }
  return best
}

/**
 * Each note's start onto the grid, and its end onto the finest level where that leaves it a
 * sensible length. `levels` runs coarsest first (feelOf): a note takes its nearest point on the
 * first level where that point is free and no later note sits closer to it. `lean` is taken out
 * first, so a line played a steady 15ms late lands on the beat rather than 15ms after it.
 *
 * ⚠️ NOTHING LANDS ON THE LOOP'S END. `len` is the next pass's downbeat, and on a coarse Snap the
 * last off-beat of a line rounded straight onto it, so the voice sang it with the next pass.
 *
 * ⚠️ TWO NOTES NEVER SHARE A POINT: on the finest level the later one moves a point on, so nothing
 * a person played is lost to rounding. And a note never runs into the next one, which would hide
 * the next consonant.
 */
export function snapToGrid(
  notes: readonly Note[],
  levels: readonly Lattice[],
  lean = 0,
  len = Infinity,
): Note[] {
  const order = notes.map((n) => ({ ...n, t: n.t - lean })).sort((a, b) => a.t - b.t)
  const fine = levels[levels.length - 1]
  const shortest = fine.beat / fine.at.length / 2
  const out: Note[] = []
  order.forEach((n, i) => {
    const prev = out[out.length - 1]
    const next = order[i + 1]
    let t = NaN
    for (let j = 0; j < levels.length && Number.isNaN(t); j++) {
      const p = nearestOn(levels[j], n.t)
      if ((prev && p <= prev.t + 1e-9) || p >= len - 1e-9) continue
      /* the next note is closer to this point: let it have it, and take one on a finer level */
      const yields =
        j < levels.length - 1 &&
        next !== undefined &&
        Math.abs(nearestOn(levels[j], next.t) - p) < 1e-9 &&
        Math.abs(next.t - p) < Math.abs(n.t - p)
      if (!yields) t = p
    }
    if (Number.isNaN(t)) {
      /* its point is the loop's end, so the last one before it; or taken, so the next one free */
      const p = nearestOn(fine, n.t)
      t = p >= len - 1e-9 ? lastBefore(fine, len) : prev ? nextOn(fine, prev.t) : p
      /* no point is left for it before the loop comes round: one of a crowd at the very end */
      if ((prev && t <= prev.t + 1e-9) || t >= len - 1e-9) return
    }
    const end = Math.max(t + shortest, nearestOn(fine, n.t + n.dur))
    out.push({ t, dur: end - t, midi: n.midi })
  })
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
 * More syllables than notes: split the longest note, one at a time, until every syllable has a
 * note or no note is a beat long. "glit-ter" on one long note becomes two halves.
 *
 * The cut is the strongest point of the line's grid inside the note, nearer its middle on a close
 * call, so the second syllable starts on a beat where there is one. It used to be half the note's
 * length in half-beats, which only lands on the beat when the note starts on one: a long note on a
 * swung off-beat was cut a half-beat later, between the grid's points.
 */
export function makeRoom(
  notes: readonly Note[],
  want: number,
  beat: number,
  grid: Lattice = evenly(beat, 4),
  perBar = 4,
): Note[] {
  const out = notes.map((n) => ({ ...n }))
  while (out.length < want) {
    let at = -1
    out.forEach((n, i) => {
      if (n.dur >= beat - 1e-9 && (at < 0 || n.dur > out[at].dur + 1e-9)) at = i
    })
    if (at < 0) break
    const n = out[at]
    const end = n.t + n.dur
    let cut = n.t + n.dur / 2
    let score = -Infinity
    for (let p = nextOn(grid, n.t); p < end - 1e-9; p = nextOn(grid, p)) {
      const s = strength(p, beat, perBar) - Math.abs(p - (n.t + n.dur / 2)) / n.dur
      if (s > score + 1e-9) {
        score = s
        cut = p
      }
    }
    out.splice(at, 1, { ...n, dur: cut - n.t }, { t: cut, dur: end - cut, midi: n.midi })
  }
  return out
}

/**
 * Each note held until the next one starts, unless a rest of a beat or more comes between them:
 * how a voice sings a line, whatever the part's own articulation.
 *
 * ⚠️ MEASURED, 15 Nov 2026, by rendering the sung song to a WAV and reading it back: on a keys
 * part played short (a quarter held for 60% of its beat, which is how most parts here are played)
 * the voice stopped with every key, so a line came out one word at a time with 85–300ms of
 * silence between them. And a line's last word went with it: "star", on a short quarter before a
 * bar with no words, was sung for 313ms and gone. A singer joins those up. A real rest, a beat or
 * more (the same line `place` draws a breath at), is kept, so a phrase still ends where the melody
 * stops.
 *
 * ⚠️ FOR THE VOICE ONLY. The part keeps its own notes and plays them as it always did.
 */
export function legato(notes: readonly Note[], beat: number): Note[] {
  return notes.map((n, i) => {
    const next = notes[i + 1]
    const gap = next ? next.t - (n.t + n.dur) : Infinity
    return gap > 1e-9 && gap < beat - 1e-6 ? { ...n, dur: next.t - n.t } : { ...n }
  })
}

/**
 * The last word before a rest held to the end of its beat, at least — in place, on a line that is
 * already sung (after legato and the fit), because how long a word rings is not room for more
 * words: measured, ringing BEFORE the fit let four syllables share one staccato eighth.
 *
 * ⚠️ A PHRASE THAT ENDS ON A SHORT NOTE ENDS ON A SHORT WORD OTHERWISE, which is the cut-off the
 * WAV showed. A singer lets it ring. Never into the next note of the part (`melody`), never into
 * the next sung note, and never past `len`, the next pass's downbeat.
 */
export function ringOut(
  sung: SungNote[],
  melody: readonly Note[],
  beat: number,
  len = Infinity,
): SungNote[] {
  let m = 0
  sung.forEach((s, i) => {
    while (m < melody.length && melody[m].t <= s.t + 1e-9) m++
    const end = s.t + s.dur
    const next = Math.min(sung[i + 1]?.t ?? Infinity, melody[m]?.t ?? Infinity, len)
    if (next - end < beat - 1e-6) return
    const ring = Math.min(Math.ceil(end / beat - 1e-6) * beat, next)
    if (ring > end) s.dur = ring - s.t
  })
  return sung
}

/** the shortest a syllable is ever sung — shorter, and the words stop being words and rush */
export const SHORTEST = 0.12

/**
 * Where a note shorter than a beat would be shared: the strongest point of the grid inside it,
 * nearer the middle on a close call (makeRoom's own rule), leaving both halves at least `floor`.
 */
function cutIn(n: Note, grid: Lattice, beat: number, perBar: number, floor: number): number | null {
  const mid = n.t + n.dur / 2
  let cut: number | null = null
  let score = -Infinity
  for (let p = nextOn(grid, n.t); p <= n.t + n.dur - floor + 1e-9; p = nextOn(grid, p)) {
    if (p < n.t + floor - 1e-9) continue
    const s = strength(p, beat, perBar) - Math.abs(p - mid) / n.dur
    if (s > score + 1e-9) {
      score = s
      cut = p
    }
  }
  return cut
}

/**
 * Still more syllables than notes once every note a beat or longer has been shared (makeRoom):
 * share the shorter ones too, down to a sixteenth and never under SHORTEST, and let the WORDS
 * choose which. Each note takes one syllable or two, the best of every way of doing that by
 * dynamic programming, scored as `place` scores a syllable on a note — so a light syllable ("the",
 * the "-ing" of calling) takes the second half of a note and the stressed ones keep the notes that
 * start on the beat. What still does not fit is left for the caller to count.
 *
 * ⚠️ MEASURED, 15 Nov 2026: "and the cit-y lights are call-ing me home" on a bar of eight eighths
 * at 96 bpm sang to "call-ing" and stopped. "me home" was counted as spare and never heard,
 * though a sixteenth there is 156ms, longer than many a sung syllable. makeRoom never cuts a note
 * shorter than a beat, which is right as a FIRST resort and wrong as the last.
 *
 * ⚠️ AND NO FURTHER THAN THAT. A note shared three ways, or a syllable under 120ms, is a rush, and
 * the box says what did not fit rather than the voice gabbling it.
 */
export function crowd(
  notes: readonly Note[],
  syls: readonly Syllable[],
  beat: number,
  fine: Lattice,
  perBar = 4,
): Note[] {
  const N = notes.length
  if (syls.length <= N) return notes.map((n) => ({ ...n }))
  const steps = fine.at.map((a, i) => ((fine.at[i + 1] ?? 1) - a) * fine.beat)
  const floor = Math.max(Math.min(...steps), SHORTEST)
  const cuts = notes.map((n) => cutIn(n, fine, beat, perBar, floor))
  const K = Math.min(syls.length, N + cuts.filter((c) => c !== null).length)
  const best = Array.from({ length: N + 1 }, () => new Array<number>(K + 1).fill(-Infinity))
  const took = Array.from({ length: N + 1 }, () => new Array<number>(K + 1).fill(0))
  best[0][0] = 0
  for (let i = 0; i < N; i++)
    for (let k = 0; k < K; k++) {
      if (best[i][k] === -Infinity) continue
      const n = notes[i]
      const one = best[i][k] + sylGain(syls[k], n.t, n.dur, beat, perBar)
      if (one > best[i + 1][k + 1]) {
        best[i + 1][k + 1] = one
        took[i + 1][k + 1] = 1
      }
      const c = cuts[i]
      if (c === null || k + 2 > K) continue
      const end = n.t + n.dur
      /* the shorter of the two halves: a cut costs more the nearer it leaves one to the floor */
      const cost = (0.5 * floor) / Math.min(c - n.t, end - c)
      const two =
        best[i][k] +
        sylGain(syls[k], n.t, c - n.t, beat, perBar) +
        sylGain(syls[k + 1], c, end - c, beat, perBar) -
        cost
      if (two > best[i + 1][k + 2]) {
        best[i + 1][k + 2] = two
        took[i + 1][k + 2] = 2
      }
    }
  const out: Note[] = []
  for (let i = N, k = K; i > 0; i--) {
    const n = notes[i - 1]
    const c = cuts[i - 1]
    if (took[i][k] === 2 && c !== null)
      out.unshift({ ...n, dur: c - n.t }, { t: c, dur: n.t + n.dur - c, midi: n.midi })
    else out.unshift({ ...n })
    k -= took[i][k]
  }
  return out
}

/**
 * The notes a line of `syls` is sung on when it has more syllables than `held` has notes: long
 * notes shared first (makeRoom), then short ones where the words say (crowd). The one path for
 * this, so the notes the voice sings and the notes "Add notes" writes into a part are the same.
 */
export function share(
  held: readonly Note[],
  syls: readonly Syllable[],
  beat: number,
  fine: Lattice,
  perBar = 4,
): Note[] {
  return crowd(makeRoom(held, syls.length, beat, fine, perBar), syls, beat, fine, perBar)
}

export type Grid = {
  /** seconds per beat */
  beat: number
  /** the room's Snap — 4, 8 or 16 for 1/4, 1/8, 1/16; 0 or left out is Off, sung on sixteenths */
  snap?: number
  /** the loop's length in seconds: the next pass's downbeat, which no note of this one may take */
  len?: number
  perBar?: number
}

/**
 * Syllables onto a layer's notes, in the pocket. Returns the same shape as assignSyllables, so the
 * panel's preview and the singer read it the same way.
 *
 * - One voice: a chord sings its top note (melodyOf).
 * - On the grid: the room's Snap, in the line's own feel (feelOf), starts and ends (snapToGrid).
 * - Too many syllables: long notes split on the strongest beat inside them (makeRoom), then
 *   shorter ones shared between two syllables where the words say (crowd), and whatever still
 *   does not fit is counted, never dropped silently.
 * - Too many notes: the syllables are SPREAD (place), and the notes between them are holds.
 * - Joined up: each sung note held to the next unless a beat's rest comes between (legato), and
 *   the last word before a rest rung to the end of its beat (ringOut).
 */
export function fitSyllables(
  notes: readonly Note[],
  syls: readonly Syllable[],
  grid: Grid,
): { sung: SungNote[]; spare: number } {
  const melody = melodyOf(notes)
  const { levels, lean } = feelOf(melody, grid.beat, grid.snap)
  const snapped = snapToGrid(melody, levels, lean, grid.len)
  const fit = fitLine(snapped, syls, grid.beat, levels[levels.length - 1], grid.perBar ?? 4)
  ringOut(fit.sung, snapped, grid.beat, grid.len)
  return fit
}

/**
 * Syllables onto notes that are ALREADY on the grid — the half of fitSyllables after the feel and
 * the snap, so a song can be snapped once and fitted bar by bar (fitByBar).
 *
 * `carry` is the syllable sung just before this line, when there was one: a line that opens on
 * `_` holds that vowel on, as `_` does inside a line, instead of coming in on "oo".
 *
 * `held` is the same notes as the voice will hold them (legato): by default each to the next one
 * here, and in a song to the next note of the part, across the bar line (fitByBar).
 *
 * ⚠️ WHERE A SYLLABLE GOES IS ASKED OF THE NOTES AS PLAYED, AND HOW LONG IT IS SUNG OF `held`.
 * `place` gives a stressed syllable a little more for a long note, and held to the next note an
 * off-beat slap that leaves a gap after it is as long as the beat it leads to: measured, the Funk
 * starter's slap bass sang "dark" off the downbeat until placing went back to the played lengths.
 * Sharing a note is the other way round: a short quarter has a quarter's room to share.
 */
export function fitLine(
  snapped: readonly Note[],
  syls: readonly Syllable[],
  beat: number,
  fine: Lattice,
  perBar = 4,
  carry?: string,
  held: readonly Note[] = legato(snapped, beat),
): { sung: SungNote[]; spare: number } {
  if (syls.length > snapped.length)
    return assignSyllables(share(held, syls, beat, fine, perBar), syls, carry)
  if (syls.length === snapped.length || !syls.length) return assignSyllables(held, syls, carry)
  const at = place(snapped, syls, beat, perBar)
  const sung: SungNote[] = []
  let k = -1
  let last = carry ?? 'oo'
  held.forEach((n, i) => {
    if (at[k + 1] === i) {
      k++
      const s = syls[k]
      if (!s.hold) {
        last = s.text
        sung.push({ ...n, text: s.text, hold: false, whole: s.whole, start: s.start })
        return
      }
    }
    sung.push({ ...n, text: last, hold: i > 0 || carry !== undefined })
  })
  return { sung, spare: 0 }
}

/** One bar's share of a song's lyrics: what it sings, what did not fit, and how many notes it had. */
export type BarFit = { sung: SungNote[]; spare: number; notes: number }

/**
 * A song's lyrics, one line per bar, onto the notes a part plays across the whole song.
 *
 * ⚠️ THE FEEL AND THE SNAP ARE ASKED OF THE WHOLE PART, ONCE. Fitting bar by bar with
 * fitSyllables would read swing from three or four notes at a time, and a bar that happened to
 * look straight would be sung straight in the middle of a swung song.
 *
 * ⚠️ A BAR'S WORDS GO ON THE NOTES THAT START IN THAT BAR, after the snap — so a note played a
 * hair early still belongs to the downbeat it was meant for. A bar with no words sings nothing,
 * whatever notes it has: the lyric decides where the voice is, which is how a verse leaves a gap
 * for the chorus. Words in a bar with no notes are counted as spare, never dropped silently.
 *
 * `notes` is in SONG time (see notesInSong in songLyrics.ts), and `grid.len` is the song's length.
 */
export function fitByBar(
  notes: readonly Note[],
  lines: readonly (readonly Syllable[])[],
  grid: Grid & { barLen: number },
): { sung: SungNote[]; bars: BarFit[] } {
  const { snapped, held, fine } = songMelody(notes, grid)
  const perBar = grid.perBar ?? 4
  const sung: SungNote[] = []
  const bars: BarFit[] = []
  let carry: string | undefined
  lines.forEach((syls, b) => {
    const from = b * grid.barLen
    const inBar = (n: Note) => n.t >= from - 1e-6 && n.t < from + grid.barLen - 1e-6
    const mine = snapped.filter(inBar)
    if (!syls.length) {
      bars.push({ sung: [], spare: 0, notes: mine.length })
      carry = undefined
      return
    }
    const fit = fitLine(mine, syls, grid.beat, fine, perBar, carry, held.filter(inBar))
    bars.push({ ...fit, notes: mine.length })
    sung.push(...fit.sung)
    /* a hold carries on only from the bar just before; a silent bar between them is a rest */
    carry = fit.sung.length ? fit.sung[fit.sung.length - 1].text : undefined
  })
  /* the same notes as each bar's own list, so a word rung on is rung on in both */
  ringOut(sung, snapped, grid.beat, grid.len)
  return { sung, bars }
}

/**
 * A song's melody as fitByBar sings it: one voice (melodyOf), on the grid in its own feel
 * (feelOf, snapToGrid), and as held (legato) — across the bar lines too, so a line's last word
 * rings on to the next bar's first note rather than stopping with the key. `source[i]` is the
 * index in `notes` of `snapped[i]`.
 *
 * ⚠️ snapToGrid drops a note only when no point is left for it before the loop comes round, which
 * is one of a crowd at the very end — so the notes it keeps are the first ones, in order.
 */
export function songMelody(
  notes: readonly Note[],
  grid: Grid,
): { snapped: Note[]; held: Note[]; fine: Lattice; source: number[] } {
  const source = melodyIndex(notes)
  const melody = source.map((i) => ({ t: notes[i].t, dur: notes[i].dur, midi: notes[i].midi }))
  const { levels, lean } = feelOf(melody, grid.beat, grid.snap)
  const snapped = snapToGrid(melody, levels, lean, grid.len)
  return {
    snapped,
    held: legato(snapped, grid.beat),
    fine: levels[levels.length - 1],
    source: source.slice(0, snapped.length),
  }
}

/**
 * What one syllable earns on a note starting at `t`: a stressed one the strength of the beat, plus
 * a little for a long note; a light one ("the", the "-ter" of glitter) loses a little for a strong
 * beat, because it would rather be off it. A typed hold earns nothing either way.
 */
function sylGain(s: Syllable, t: number, dur: number, beat: number, perBar: number): number {
  if (s.hold) return 0
  const str = strength(t, beat, perBar)
  const lands = s.stress >= 0.75 ? s.stress * (str + 0.3 * Math.min(1, dur / beat)) : 0
  const dodges = s.stress < 0.75 ? -(0.75 - s.stress) * 2 * str : 0
  return lands + dodges
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
    return sylGain(s, line[i].t, line[i].dur, beat, perBar) + (s.start && rest[i] ? 0.4 : 0)
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
