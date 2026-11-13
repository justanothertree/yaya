import type { Note } from './noteEdit'

/**
 * Words into syllables, syllables onto notes, and spelling into the sounds a voice makes.
 *
 * ⚠️ PURE ON PURPOSE — the same reason play.ts and arrange.ts are. Whether "twinkle" splits into
 * two, whether a held note carries a vowel, and whether "night" sings an "ai" are questions with
 * right answers, and a browser is the wrong place to ask them. singer.ts turns the answers into
 * sound; everything it decides about WHAT to sing is decided here.
 *
 * See docs/2026-11-10-sung-lyrics-plan.md. This is phase 0 — nothing is saved.
 */

/** One syllable as typed. `hold` carries the last syllable's vowel across this note. */
export type Syllable = { text: string; hold: boolean; whole: boolean }

/**
 * Typed lyrics into syllables.
 *
 * - Spaces separate words; a hyphen splits a word where you put it (`glit-ter`).
 * - `_` is a hold, one per underscore: `_ _` holds across two more notes.
 * - A word with no hyphen is split by `autoSplit`, which is a guess — the result is visible on the
 *   notes, and a hyphen overrules it.
 */
export function splitLyrics(text: string): Syllable[] {
  const out: Syllable[] = []
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue
    if (/^_+$/.test(word)) {
      for (let i = 0; i < word.length; i++) out.push({ text: '', hold: true, whole: false })
      continue
    }
    const parts = word.includes('-') ? word.split('-').filter(Boolean) : autoSplit(word)
    for (const p of parts) out.push({ text: p, hold: false, whole: parts.length === 1 })
  }
  return out
}

const VOWEL = /[aeiouy]/i

/**
 * A word into syllables by its vowel groups — VC-CV between two or more consonants, V-CV before a
 * single one, a silent final "e", and a consonant + "le" ending kept as its own syllable.
 *
 * ⚠️ ENGLISH SPELLING HAS NO RULE THAT IS ALWAYS RIGHT, and this does not pretend to. It gets
 * glit-ter, to-night, twin-kle, ba-by and time right; it will get some words wrong, and a hyphen
 * typed in the lyric fixes any of them.
 */
export function autoSplit(word: string): string[] {
  const w = word.replace(/[^a-z']/gi, '')
  if (!w) return [word]
  /* vowel groups, as [start, end) — a leading y is a consonant ("you"), anywhere else a vowel */
  const groups: [number, number][] = []
  for (let i = 0; i < w.length; i++) {
    const v = VOWEL.test(w[i]) && !(i === 0 && /y/i.test(w[i]))
    if (!v) continue
    if (groups.length && groups[groups.length - 1][1] === i) groups[groups.length - 1][1] = i + 1
    else groups.push([i, i + 1])
  }
  /* a final lone "e" after a consonant is silent — "time", "love" — unless the word ends in C+"le" */
  const last = groups[groups.length - 1]
  if (
    groups.length > 1 &&
    last[0] === w.length - 1 &&
    /e/i.test(w[last[0]]) &&
    !/[^aeiou]le$/i.test(w)
  )
    groups.pop()
  if (groups.length < 2) return [w]
  const cuts: number[] = []
  for (let g = 1; g < groups.length; g++) {
    const gap = groups[g][0] - groups[g - 1][1]
    /* a consonant + "le" ending is its own syllable, consonant included: twin-kle */
    const leEnd = g === groups.length - 1 && /[^aeiou]le$/i.test(w)
    cuts.push(leEnd ? w.length - 3 : gap <= 1 ? groups[g - 1][1] : groups[g - 1][1] + 1)
  }
  const out: string[] = []
  let from = 0
  for (const c of cuts) {
    out.push(w.slice(from, c))
    from = c
  }
  out.push(w.slice(from))
  return out.filter(Boolean)
}

/** A note with what it sings: a syllable, or a hold carrying the previous vowel. */
export type SungNote = { t: number; dur: number; midi: number; text: string; hold: boolean }

/**
 * Syllables onto notes, one each, in time order.
 *
 * ⚠️ NOTHING IS DROPPED SILENTLY. Notes left over sing a hold (the last vowel carries on), and
 * syllables left over are COUNTED so the panel can say "3 words left over" rather than losing them.
 * A hold with nothing before it sings "oo", which is what a voice does when it has no word yet.
 */
export function assignSyllables(
  notes: readonly Note[],
  syls: readonly Syllable[],
): { sung: SungNote[]; spare: number } {
  const order = [...notes].sort((a, b) => a.t - b.t || a.midi - b.midi)
  const sung: SungNote[] = []
  let lastText = 'oo'
  order.forEach((n, i) => {
    const s = syls[i]
    if (s && !s.hold) {
      lastText = s.text
      sung.push({ t: n.t, dur: n.dur, midi: n.midi, text: s.text, hold: false })
    } else {
      sung.push({ t: n.t, dur: n.dur, midi: n.midi, text: lastText, hold: i > 0 })
    }
  })
  return { sung, spare: Math.max(0, syls.length - order.length) }
}

/**
 * The vowels a voice can make, as the first three formants of an adult female voice, in Hz.
 *
 * ⚠️ MEASURED VALUES, NOT TUNED BY EAR — the averages of Peterson & Barney's 1952 vowel study,
 * which every formant synthesiser has been checked against since. A diphthong ("ai" in night) is
 * two of these with a glide between them.
 */
export const VOWELS = {
  ee: [310, 2790, 3310],
  ih: [430, 2480, 3070],
  eh: [610, 2330, 2990],
  ae: [860, 2050, 2850],
  ah: [850, 1220, 2810],
  aw: [590, 920, 2710],
  uh: [760, 1400, 2780],
  ou: [470, 1160, 2680],
  oo: [370, 950, 2670],
  er: [500, 1640, 1960],
} as const
export type VowelId = keyof typeof VOWELS

/** How a consonant sounds: a hiss of filtered noise, a short click, a hum, or a glide. */
export type Consonant =
  | { kind: 'hiss'; hz: number }
  | { kind: 'click'; hz: number }
  | { kind: 'hum' }
  | { kind: 'glide'; from: VowelId }

export type Phones = {
  onset: Consonant | null
  vowel: VowelId
  to: VowelId | null
  coda: Consonant | null
}

/* onsets and codas, longest spelling first so "sh" wins over "s" */
const CONSONANTS: [string, Consonant][] = [
  ['sh', { kind: 'hiss', hz: 3200 }],
  ['ch', { kind: 'hiss', hz: 3500 }],
  ['th', { kind: 'hiss', hz: 6000 }],
  ['s', { kind: 'hiss', hz: 6500 }],
  ['z', { kind: 'hiss', hz: 5500 }],
  ['f', { kind: 'hiss', hz: 5000 }],
  ['v', { kind: 'hiss', hz: 4000 }],
  ['h', { kind: 'hiss', hz: 1800 }],
  ['j', { kind: 'hiss', hz: 3000 }],
  ['p', { kind: 'click', hz: 800 }],
  ['b', { kind: 'click', hz: 600 }],
  ['t', { kind: 'click', hz: 4000 }],
  ['d', { kind: 'click', hz: 3000 }],
  ['k', { kind: 'click', hz: 2000 }],
  ['c', { kind: 'click', hz: 2000 }],
  ['q', { kind: 'click', hz: 2000 }],
  ['g', { kind: 'click', hz: 1800 }],
  ['x', { kind: 'click', hz: 2500 }],
  ['m', { kind: 'hum' }],
  ['n', { kind: 'hum' }],
  ['l', { kind: 'glide', from: 'ou' }],
  ['r', { kind: 'glide', from: 'er' }],
  ['w', { kind: 'glide', from: 'oo' }],
  ['y', { kind: 'glide', from: 'ee' }],
]

const consonantAt = (s: string): Consonant | null => {
  for (const [spell, c] of CONSONANTS) if (s.startsWith(spell)) return c
  return null
}

/* vowel spellings, longest first; [vowel, diphthong target or null] */
const VOWEL_SPELLINGS: [string, VowelId, VowelId | null][] = [
  ['igh', 'ah', 'ee'],
  ['ee', 'ee', null],
  ['ea', 'ee', null],
  ['ie', 'ah', 'ee'],
  ['oo', 'oo', null],
  ['ou', 'ah', 'oo'],
  ['ow', 'ah', 'oo'],
  ['oi', 'aw', 'ee'],
  ['oy', 'aw', 'ee'],
  ['ai', 'eh', 'ee'],
  ['ay', 'eh', 'ee'],
  ['ar', 'ah', null],
  ['er', 'er', null],
  ['ir', 'er', null],
  ['ur', 'er', null],
  ['or', 'aw', null],
  ['a', 'ae', null],
  ['e', 'eh', null],
  ['i', 'ih', null],
  ['o', 'ah', null],
  ['u', 'uh', null],
  ['y', 'ee', null],
]

/**
 * A syllable's spelling into an onset consonant, a vowel (gliding to a second one for a diphthong)
 * and a closing consonant.
 *
 * ⚠️ A SMALL SET OF ENGLISH RULES, AND ROBOTIC BY DESIGN — the voice this feeds is a formant synth,
 * not a person, and "close enough to be the word" is the bar. The long-vowel rule ("time",
 * "make": vowel, one consonant, final e) and "y" as a whole word ("my", "sky") are the two that
 * matter most for lyrics.
 */
export function phonesOf(syllable: string, whole = false): Phones {
  const s = syllable.toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return { onset: null, vowel: 'oo', to: null, coda: null }
  let i = 0
  let onset: Consonant | null = null
  /* the first consonant sound of the onset; the rest of a cluster is skipped (robotic) */
  while (i < s.length && !(VOWEL.test(s[i]) && !(i === 0 && s[i] === 'y' && s.length > 1))) {
    if (!onset) onset = consonantAt(s.slice(i))
    i++
  }
  const rest = s.slice(i)
  let vowel: VowelId = 'uh'
  let to: VowelId | null = null
  let len = 1
  for (const [spell, v, d] of VOWEL_SPELLINGS)
    if (rest.startsWith(spell)) {
      vowel = v
      to = d
      len = spell.length
      break
    }
  const after = rest.slice(len)
  /* a long vowel: one consonant and a silent final e — tIme, mAke, hOme, cUte */
  if (/^[^aeiou]e$/.test(after) && len === 1) {
    const long: Record<string, [VowelId, VowelId | null]> = {
      a: ['eh', 'ee'],
      i: ['ah', 'ee'],
      o: ['uh', 'oo'],
      u: ['oo', null],
      e: ['ee', null],
    }
    const l = long[rest[0]]
    if (l) [vowel, to] = l
  }
  /* "y" alone, or ending a one-syllable word after a consonant: my, sky, fly */
  if (rest === 'y' && whole) {
    vowel = 'ah'
    to = 'ee'
  }
  const tail = after.replace(/e$/, '')
  const coda = tail
    ? consonantAt(tail[tail.length - 1] === 'g' && tail.endsWith('ng') ? 'n' : tail.slice(-1))
    : null
  return { onset, vowel, to, coda }
}

/**
 * The harmony note: a third above, inside the scale, so it never clashes with the keyboard.
 *
 * ⚠️ TWO SCALE STEPS UP, NOT FOUR SEMITONES. A major third on every note would put a G♯ over an E
 * in C major; two steps up the scale gives E→G, which is the harmony anybody singing along would
 * find. On Chromatic there is no scale to step through, so it is a plain major third.
 */
export function harmonyAbove(midi: number, degrees: readonly number[], root: number): number {
  if (degrees.length >= 12) return midi + 4
  const pcs = degrees.map((d) => (d + root) % 12)
  /* the scale step at or just below this note */
  let below = midi
  while (!pcs.includes(((below % 12) + 12) % 12) && midi - below < 12) below--
  let up = below
  let steps = 0
  while (steps < 2) {
    up++
    if (pcs.includes(((up % 12) + 12) % 12)) steps++
  }
  return up + (midi - below)
}
