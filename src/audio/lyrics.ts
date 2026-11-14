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

/**
 * One syllable as typed. `hold` carries the last syllable's vowel across this note.
 *
 * `start` and `end` say where it sits in its word, and `stress` how much it wants a strong beat —
 * what fitSyllables (pocket.ts) needs to put "night" on the beat and "the" between them.
 */
export type Syllable = {
  text: string
  hold: boolean
  whole: boolean
  start: boolean
  end: boolean
  stress: number
}

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
      for (let i = 0; i < word.length; i++)
        out.push({ text: '', hold: true, whole: false, start: false, end: true, stress: 0 })
      continue
    }
    const parts = word.includes('-') ? word.split('-').filter(Boolean) : autoSplit(word)
    parts.forEach((p, i) =>
      out.push({
        text: p,
        hold: false,
        whole: parts.length === 1,
        start: i === 0,
        end: i === parts.length - 1,
        stress: stressOf(parts, i),
      }),
    )
  }
  return out
}

/**
 * Words a line passes through rather than lands on: articles, short prepositions, conjunctions and
 * the verb "to be". Sung on a weak beat they sound natural; on the downbeat they sound like a
 * mistake ("THE dark").
 */
const LIGHT = new Set(
  'a an the and or but nor of to in on at by for from with as is am are was were be been it its if so than that'.split(
    ' ',
  ),
)

/**
 * Which syllable of a word takes the stress. English mostly stresses the first (GLIT-ter, BA-by,
 * TWIN-kle); a short unstressed prefix moves it to the second (to-NIGHT, a-WAY, be-FORE, re-TURN).
 * ⚠️ A GUESS, like autoSplit — it only decides which note a syllable prefers, never what is sung.
 */
function stressOf(parts: readonly string[], i: number): number {
  if (parts.length === 1) return LIGHT.has(parts[0].toLowerCase().replace(/[^a-z]/g, '')) ? 0.4 : 1
  const stressed = /^(a|be|to|re|de|un|for|ex)$/i.test(parts[0]) ? 1 : 0
  return i === stressed ? 1 : 0.5
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

/**
 * A note with what it sings: a syllable, or a hold carrying the previous vowel. `whole` says the
 * syllable is a word on its own, which is when "my" sings "mai" and "we" sings "wee".
 */
export type SungNote = {
  t: number
  dur: number
  midi: number
  text: string
  hold: boolean
  whole?: boolean
}

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
      sung.push({ t: n.t, dur: n.dur, midi: n.midi, text: s.text, hold: false, whole: s.whole })
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

/**
 * Where in the mouth a consonant is made. It decides the formants the vowel next to it starts from
 * or heads for — and that movement, more than the click or hiss itself, is what tells "ba" from
 * "da" from "ga", and "ma" from "na" (`locus` in singer.ts).
 */
export type Place = 'lips' | 'teeth' | 'ridge' | 'palate' | 'velum' | 'glottis'

/**
 * The mouth's shape for w, y, l and r, as F1–F3 in Hz. A glide holds it briefly and moves into the
 * vowel. Approximate values for a female voice, in line with published measurements of English
 * approximants: w is lower and further back than any vowel, y higher and further forward, l keeps
 * F3 high, and r pulls F3 down to ~1700Hz, which is the one thing that makes an r an r.
 *
 * ⚠️ THEY USED TO BE VOWELS: l started from "ou", r from "er", w from "oo". An l that starts from
 * "ou" is a w — measured, "la" and "wa" were the closest pair of the four.
 */
export const GLIDES = {
  w: [300, 700, 2200],
  y: [270, 2800, 3300],
  l: [380, 1200, 2900],
  /* a closing l ("will", "all") is the dark one, further back */
  dl: [450, 900, 2700],
  r: [350, 1350, 1750],
} as const
export type GlideId = keyof typeof GLIDES

/**
 * A consonant: a hiss of noise (s, sh, f, th, h), a click (a stop: closure, then a burst), a hum (a
 * nasal) or a glide — where it is made, and whether the voice keeps sounding through it.
 *
 * ⚠️ WHAT IT SOUNDS LIKE IS DECIDED IN singer.ts, NOT HERE. This file says which sound a spelling
 * makes; the noise bands, burst spectra and levels belong to the voice that makes them. A click at
 * the palate is ch (or j): English has no plain palatal stop, so the release is always a "sh".
 */
export type Consonant =
  | { kind: 'hiss'; place: Place; voiced?: true }
  | { kind: 'click'; place: Place; voiced?: true }
  | { kind: 'hum'; place: Place }
  | { kind: 'glide'; shape: GlideId }

export type Phones = {
  /** the consonants before the vowel, in order: "street" is s, t, r */
  onsets: Consonant[]
  vowel: VowelId
  to: VowelId | null
  /** the consonants after it, in order and at most two: "and" is n, d */
  codas: Consonant[]
}

/** every consonant sound, by the name the spellings below use */
const PHONEMES: Record<string, Consonant> = {
  p: { kind: 'click', place: 'lips' },
  b: { kind: 'click', place: 'lips', voiced: true },
  t: { kind: 'click', place: 'ridge' },
  d: { kind: 'click', place: 'ridge', voiced: true },
  k: { kind: 'click', place: 'velum' },
  g: { kind: 'click', place: 'velum', voiced: true },
  ch: { kind: 'click', place: 'palate' },
  j: { kind: 'click', place: 'palate', voiced: true },
  f: { kind: 'hiss', place: 'lips' },
  v: { kind: 'hiss', place: 'lips', voiced: true },
  th: { kind: 'hiss', place: 'teeth' },
  dh: { kind: 'hiss', place: 'teeth', voiced: true },
  s: { kind: 'hiss', place: 'ridge' },
  z: { kind: 'hiss', place: 'ridge', voiced: true },
  sh: { kind: 'hiss', place: 'palate' },
  zh: { kind: 'hiss', place: 'palate', voiced: true },
  h: { kind: 'hiss', place: 'glottis' },
  m: { kind: 'hum', place: 'lips' },
  n: { kind: 'hum', place: 'ridge' },
  ng: { kind: 'hum', place: 'velum' },
  w: { kind: 'glide', shape: 'w' },
  y: { kind: 'glide', shape: 'y' },
  l: { kind: 'glide', shape: 'l' },
  r: { kind: 'glide', shape: 'r' },
}

/* consonant spellings of more than one letter, longest first, and the sounds each makes */
const SPELLED: [string, string[]][] = [
  ['tch', ['ch']],
  ['sch', ['s', 'k']],
  ['dg', ['j']],
  ['sh', ['sh']],
  ['ch', ['ch']],
  ['th', ['th']],
  ['ph', ['f']],
  ['wh', ['w']],
  ['ck', ['k']],
  ['nk', ['ng', 'k']],
  ['ng', ['ng']],
  ['qu', ['k', 'w']],
  ['kn', ['n']],
  ['wr', ['r']],
  ['gn', ['n']],
  ['mb', ['m']],
  ['gh', []],
  ['x', ['k', 's']],
]

/**
 * A run of consonant letters into the sounds it makes. Doubled letters are one sound; c is soft
 * before e, i and y ("nice", "city"); a closing "ge" is j ("page"); a closing "se" after a vowel is
 * z ("rose", "these"). A silent final e makes nothing, and any vowel letter left in a coda is
 * skipped — as are h, w and y there, which are the end of a vowel ("ah", "saw", "boy"), not a sound
 * of their own.
 */
function soundsOf(letters: string, coda: boolean, follow = ''): string[] {
  const out: string[] = []
  for (let i = 0; i < letters.length; ) {
    const rest = letters.slice(i)
    const hit = SPELLED.find(([sp]) => rest.startsWith(sp))
    if (hit) {
      out.push(...hit[1])
      i += hit[0].length
      continue
    }
    const ch = letters[i]
    /* the letter after the run counts too: the i of "city" makes its c an s */
    const next = letters[i + 1] ?? follow
    const last = rest.length === 2 && next === 'e'
    i++
    if (ch === next) continue
    if (ch === 'c') out.push(/[eiy]/.test(next) ? 's' : 'k')
    else if (ch === 'q') out.push('k')
    else if (ch === 'g') out.push(last ? 'j' : 'g')
    else if (ch === 's') out.push(last && !/[^aeiou]/.test(letters[i - 2] ?? 'a') ? 'z' : 's')
    else if (PHONEMES[ch] && !(coda && /[hwy]/.test(ch))) out.push(ch)
  }
  return out
}

/**
 * Whole words English spells one way and says another, as their sounds: consonant names from
 * `PHONEMES`, and a vowel (with its glide, `ah>ee`). Kept to words that come up in lyrics.
 *
 * ⚠️ THE RULES BELOW GET ALL OF THESE WRONG, and each was heard: "the" sang "theh" (and with a
 * voiceless th), "to" sang "tah", "you" sang "yow", "I" sang "ih", "love" sang "lohv" by the
 * silent-e rule, "come" sang "kohm". A hyphenated word never comes here — only a word on its own.
 */
const SAID: Record<string, string> = {
  the: 'dh uh',
  a: 'uh',
  to: 't oo',
  do: 'd oo',
  who: 'h oo',
  you: 'y oo',
  your: 'y aw r',
  i: 'ah>ee',
  of: 'uh v',
  oh: 'uh>oo',
  o: 'uh>oo',
  ah: 'ah',
  love: 'l uh v',
  come: 'k uh m',
  some: 's uh m',
  done: 'd uh n',
  none: 'n uh n',
  one: 'w uh n',
  gone: 'g aw n',
  give: 'g ih v',
  live: 'l ih v',
  have: 'h ae v',
  were: 'w er',
  there: 'dh eh r',
  where: 'w eh r',
  their: 'dh eh r',
  what: 'w uh t',
  was: 'w uh z',
  is: 'ih z',
  his: 'h ih z',
  as: 'ae z',
  has: 'h ae z',
  could: 'k ou d',
  would: 'w ou d',
  should: 'sh ou d',
  good: 'g ou d',
  look: 'l ou k',
  book: 'b ou k',
  said: 's eh d',
  does: 'd uh z',
  been: 'b ih n',
  are: 'ah r',
  eye: 'ah>ee',
  eyes: 'ah>ee z',
  heart: 'h ah t',
  through: 'th r oo',
  though: 'dh uh>oo',
  this: 'dh ih s',
  that: 'dh ae t',
  these: 'dh ee z',
  those: 'dh uh>oo z',
  they: 'dh eh>ee',
  them: 'dh eh m',
  then: 'dh eh n',
  than: 'dh ae n',
  with: 'w ih dh',
  friend: 'f r eh n d',
}

function said(text: string): Phones {
  const parts = text.split(' ')
  const at = parts.findIndex((p) => p.split('>')[0] in VOWELS)
  const [vowel, to] = parts[at].split('>') as [VowelId, VowelId | undefined]
  const cons = (ps: string[]) => ps.map((p) => PHONEMES[p])
  return {
    onsets: cons(parts.slice(0, at)),
    vowel,
    to: to ?? null,
    codas: cons(parts.slice(at + 1)),
  }
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
  ['oa', 'uh', 'oo'],
  ['oi', 'aw', 'ee'],
  ['oy', 'aw', 'ee'],
  ['ai', 'eh', 'ee'],
  ['ay', 'eh', 'ee'],
  ['ey', 'eh', 'ee'],
  ['ue', 'oo', null],
  ['ew', 'oo', null],
  ['aw', 'aw', null],
  ['au', 'aw', null],
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

/* a word ending on one vowel letter is long: we, go, hi, ma, flu */
const OPEN: Record<string, [VowelId, VowelId | null]> = {
  e: ['ee', null],
  o: ['uh', 'oo'],
  i: ['ah', 'ee'],
  a: ['ah', null],
  u: ['oo', null],
}

/**
 * A syllable's spelling into the consonants before its vowel, the vowel (gliding to a second one
 * for a diphthong) and the consonants after it.
 *
 * ⚠️ A SMALL SET OF ENGLISH RULES, AND ROBOTIC BY DESIGN — the voice this feeds is a formant synth,
 * not a person, and "close enough to be the word" is the bar. The long-vowel rule ("time",
 * "make": vowel, one consonant, final e), a word ending on its vowel ("we", "go", "my"), and the
 * short list in `SAID` are the ones that matter most for lyrics.
 *
 * ⚠️ EVERY CONSONANT COUNTS, NOT JUST THE FIRST. It used to keep the first letter of an onset and
 * the last letter of a coda, so "sky" sang "sigh", "play" sang "pay", "street" sang "seet", and a
 * closing "sh" was read as its h — "fish" sang "fih" and "each" sang "eeh". An onset keeps up to
 * three sounds ("str") and a coda its last two ("and", "six" as k-s).
 */
export function phonesOf(syllable: string, whole = false): Phones {
  const s = syllable.toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return { onsets: [], vowel: 'oo', to: null, codas: [] }
  if (whole && SAID[s]) return said(SAID[s])
  let i = 0
  while (i < s.length && !(VOWEL.test(s[i]) && !(i === 0 && s[i] === 'y' && s.length > 1))) i++
  /* the u of "qu" belongs to the consonant: queen, quick */
  if (s[i - 1] === 'q' && s[i] === 'u' && i + 1 < s.length) i++
  const onsets = soundsOf(s.slice(0, i), false, s[i])
    .slice(0, 3)
    .map((p) => PHONEMES[p])
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
  let after = rest.slice(len)
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
  /* a word that ends on its one vowel letter says it long: we, go, hi */
  if (whole && rest.length === 1 && i > 0 && OPEN[rest]) [vowel, to] = OPEN[rest]
  /* "all", "call", "salt"; and "walk", "talk", whose l is silent */
  if (rest[0] === 'a' && len === 1 && /^(ll|lt|lk)/.test(after)) {
    vowel = 'aw'
    if (after.startsWith('lk')) after = after.slice(1)
  }
  let codas = soundsOf(
    after.replace(/e$/, (e) => (/[cgs]e$/.test(after) ? e : '')),
    true,
  )
    .slice(-2)
    .map((p) => (p === 'l' ? 'dl' : p))
  /* a plural or a verb's s after a voiced consonant is a z: drums, songs, hands — a spelled s
     only, never the soft c of "dance" */
  if (
    codas.length === 2 &&
    codas[1] === 's' &&
    /[^s]s$/.test(after) &&
    /^(b|d|g|v|m|n|ng|dl|r)$/.test(codas[0])
  )
    codas = [codas[0], 'z']
  return {
    onsets,
    vowel,
    to,
    codas: codas.map((p): Consonant => (p === 'dl' ? { kind: 'glide', shape: 'dl' } : PHONEMES[p])),
  }
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
