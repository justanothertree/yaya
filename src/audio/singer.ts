import {
  GLIDES,
  VOWELS,
  phonesOf,
  type Consonant,
  type Phones,
  type Place,
  type SungNote,
  type VowelId,
} from './lyrics'

/**
 * A synthesised singing voice: a glottal buzz through a cascade of formant resonances — the way a
 * Klatt speech synthesiser builds a vowel — singing typed syllables on notes.
 *
 * ⚠️ PHASE 0 OF docs/2026-11-10-sung-lyrics-plan.md — to be HEARD, nothing saved. Rewritten on
 * 13 Nov 2026 (docs/2026-11-13-formant-singer.md) after the first version sounded like what it was:
 * one sawtooth per syllable through three band-passes, so nothing could glide between syllables.
 *
 * ⚠️ PURE CODE, BY EVAN'S CHOICE: no samples, no models, no service. Every sound is an oscillator,
 * a noise buffer made here, and filters — so it runs offline, on a phone, the same everywhere.
 *
 * ⚠️ PLANNED, THEN PLAYED. `planLine` (syllables to events) and `planPhrases` (events to automation
 * timelines) are pure and tested: where the vowel lands, when the pitch leaves one note and arrives
 * at the next, when vibrato starts, which consonant makes which noise. `singInto` only turns a
 * timeline into nodes, into whatever context and destination it is handed — the room's part bus, a
 * preview page, or an OfflineAudioContext that a probe can measure.
 */

export type PresetId = 'clean' | 'breathy' | 'glitchy'

export type Voice = {
  name: string
  /** the buzz's harmonic rolloff: harmonic n has amplitude n^-tilt — higher is darker and softer */
  tilt: number
  /** extra weight on the fundamental, the soft open glottis of a breathy voice */
  h1: number
  /** breath under the voice, as a share of it, shaped by the same vowel */
  breath: number
  /** the airy top of the breath, above 4kHz — the cascade rolls the voice off up there, so the
   *  whisper of a breathy singer has to go round it */
  air: number
  /** formant bandwidths, as a multiple: wider is softer, narrower is ringier */
  width: number
  /** resonances scaled without moving the note — above 1 a smaller, brighter singer */
  formant: number
  /** seconds to slide from one note to the next; 0 snaps, which is hard tune */
  glide: number
  /** semitones a phrase's first note scoops up from */
  scoop: number
  /** vibrato waits `delay` into a held note, then grows over `rise` */
  vibrato: { delay: number; rise: number; rate: number; cents: number }
  /** the small unevenness of a person: per-note pitch (cents), timing (ms) and level (dB), plus a
   *  slow pitch drift (cents) */
  humanize: { cents: number; ms: number; db: number; drift: number }
  /** a broad lift around 3kHz, in dB — the "singer's formant" that makes a pop voice bright and
   *  its front vowels clear */
  bright: number
  /** the consonants' noise — bursts, hiss, breath — against the voice: 1 is the clearest */
  diction: number
  /** seconds for the voice to reach full level at a vowel */
  attack: number
  stutter: boolean
  /** grit: the voice driven into a stepped shaper with `steps` levels a side and blended in at
   *  `mix` — null for none */
  crush: { steps: number; drive: number; mix: number } | null
  chop: boolean
  /** the second voice of a doubled part: detuned, a little late, a slightly different throat */
  double: { cents: number; ms: number; pan: number; formant: number }
  /** output level, measured against Keys — see docs/2026-11-13-formant-singer.md */
  out: number
}

export const PRESETS: Record<PresetId, Voice> = {
  clean: {
    name: 'Clean',
    tilt: 1.05,
    h1: 1,
    breath: 0.06,
    air: 0.08,
    width: 0.85,
    formant: 1,
    glide: 0.07,
    scoop: 0.4,
    vibrato: { delay: 0.32, rise: 0.35, rate: 5.6, cents: 28 },
    humanize: { cents: 5, ms: 6, db: 1, drift: 4 },
    bright: 6,
    diction: 1,
    attack: 0.03,
    stutter: false,
    crush: null,
    chop: false,
    double: { cents: 8, ms: 16, pan: 0.3, formant: 1.015 },
    out: 0.095,
  },
  breathy: {
    name: 'Breathy',
    tilt: 1.45,
    h1: 1.8,
    breath: 0.45,
    air: 0.45,
    width: 1.15,
    formant: 1,
    glide: 0.11,
    scoop: 0.9,
    vibrato: { delay: 0.38, rise: 0.45, rate: 5.1, cents: 38 },
    humanize: { cents: 7, ms: 8, db: 1.5, drift: 5 },
    bright: 3,
    diction: 0.8,
    attack: 0.06,
    stutter: false,
    crush: null,
    chop: false,
    double: { cents: 10, ms: 22, pan: 0.4, formant: 1.02 },
    out: 0.105,
  },
  glitchy: {
    name: 'Glitchy',
    tilt: 0.85,
    h1: 1,
    breath: 0.12,
    air: 0.05,
    width: 0.75,
    formant: 1.12,
    glide: 0,
    scoop: 0,
    vibrato: { delay: 0, rise: 0, rate: 5.5, cents: 0 },
    humanize: { cents: 0, ms: 0, db: 0.5, drift: 0 },
    bright: 8,
    diction: 0.9,
    attack: 0.008,
    stutter: true,
    /* ⚠️ SOFTENED 14 Nov 2026 — Evan: "a bit harsh". It was 5 levels on the signal as it left the
       level stage, where the voice is only ~0.1–0.3 high, so it landed on two or three of them:
       closer to a square wave than to grit. Driven to fill the shaper and blended under the dry
       voice instead; measured in docs/2026-11-13-formant-singer.md. */
    crush: { steps: 8, drive: 3, mix: 0.5 },
    chop: false,
    double: { cents: 16, ms: 11, pan: 0.5, formant: 1.03 },
    out: 0.102,
  },
}

export type Part = 'lead' | 'harmony'

export type SingOpts = {
  preset: PresetId
  /** a second, detuned lead voice either side of the middle */
  double: boolean
  /** the harmony note for a melody note, or null for no harmony */
  harmony: ((midi: number) => number) | null
  /** seconds per beat, for the stutter and the chop */
  beat: number
  /** the humanising is random but repeatable: the same seed sings the same line the same way */
  seed?: number
  /**
   * ⚠️ THE THREE SWITCHES OF THE SECOND VIBE PROTOTYPE, 14 Nov 2026 — each off by default, and with
   * all three off the voice is exactly the #325 voice. Evan heard the first prototype and preferred
   * that voice: its dips, falls and plate had cost the line its clean character (measured in
   * docs/2026-11-14-singer-vibe.md). So each change is one switch, to be heard on its own. After
   * hearing them he made the late vibrato and the light room the Sing panel's sound, and harmony
   * (none, a third, or a third and the octave) its choice — see SOUND in instrument/singAlong.ts,
   * which sings the song's lyrics since they moved out of the Sing panel (15 Nov 2026).
   *
   * `vibrato: 'late'` — only long notes waver, later, slower and shallower: see `lateVibratoOf`.
   */
  vibrato?: 'late'
  /** `'room'`: a short, light room of the voice's own, in place of the part bus's reverb (the
   *  caller turns that off). `'echo'`: one soft echo in time with the song, on top of it. */
  space?: 'room' | 'echo'
  /** a quiet double of the lead an octave below it — the stack's second voice, with `harmony` */
  octave?: boolean
  /**
   * How long before `start` the first consonant may begin. When a line is scheduled for the next
   * time round the loop there is time in hand, and "sky" can hiss before the downbeat rather than
   * be clipped to it; 0 when the line starts now.
   */
  lead?: number
}

/** one part singing one syllable — and the held notes after it */
export type Event = {
  part: Part
  phones: Phones
  /** when the consonant starts — BEFORE the beat, so the vowel lands on it */
  from: number
  /** when the vowel starts: the note's own time */
  vowelAt: number
  end: number
  /** the pitch at each note this syllable spans: the syllable's own, then each hold */
  pitches: { at: number; midi: number }[]
  /** extra starts of the syllable, for the stutter */
  stutter: number[]
}

/**
 * A line of sung notes into the events that will play it — pure, so the timing can be asked.
 *
 * ⚠️ THE VOWEL IS ON THE BEAT, THE CONSONANT BEFORE IT, which is how singers place words: "sky"
 * starts its hiss early so the "ai" lands where the note is. Clamped to `start - lead`, so the first
 * word of a line reaches back only as far as there is time for.
 *
 * ⚠️ AND THE CONSONANT BORROWS FROM THE NOTE BEFORE, NEVER MORE THAN 45% OF IT. An s is 85ms; at
 * 140 bpm a sixteenth is 107ms, so a run of "so so so" on sixteenths used to leave each vowel a
 * fifth of its note, and the line read as hiss. Shortened, the consonant still comes first and the
 * vowel still lands on the beat.
 *
 * ⚠️ A HOLD IS NOT A NEW EVENT: it extends the syllable before it to its own end and adds its pitch,
 * so the vowel carries straight across with no consonant and no gap.
 */
export function planLine(sung: readonly SungNote[], start: number, opts: SingOpts): Event[] {
  const out: Event[] = []
  const bar = opts.beat * 4
  const stutter = PRESETS[opts.preset].stutter
  const parts: { part: Part; pitch: (m: number) => number }[] = [{ part: 'lead', pitch: (m) => m }]
  if (opts.harmony) parts.push({ part: 'harmony', pitch: opts.harmony })
  for (const p of parts) {
    let cur: Event | null = null
    let lastAt = -Infinity
    for (const n of sung) {
      const at = start + n.t
      if (n.hold && cur) {
        cur.end = at + n.dur
        cur.pitches.push({ at, midi: p.pitch(n.midi) })
        lastAt = at
        continue
      }
      const phones = phonesOf(n.text, n.whole)
      const onBar = Math.abs(n.t / bar - Math.round(n.t / bar)) < 1e-3
      const early = Math.min(onsetLength(phones.onsets), 0.45 * (at - lastAt))
      lastAt = at
      cur = {
        part: p.part,
        phones,
        from: Math.max(start - (opts.lead ?? 0), at - early),
        vowelAt: at,
        end: at + n.dur,
        pitches: [{ at, midi: p.pitch(n.midi) }],
        stutter: stutter && onBar ? [0, 1, 2].map((k) => at + (k * opts.beat) / 8) : [],
      }
      out.push(cur)
    }
  }
  return out
}

/** sixteenth-note gates across [from, end): on for 60% of each, the chop */
export function chopGates(from: number, end: number, beat: number): [number, number][] {
  const step = beat / 4
  const out: [number, number][] = []
  for (let t = from; t < end - 1e-6; t += step) out.push([t, Math.min(end, t + step * 0.6)])
  return out
}

/** a wave shaper's curve with `steps` levels: the sound of too few bits */
export function crushCurve(steps: number, size = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(size * 4))
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    c[i] = Math.round(x * steps) / steps
  }
  return c
}

/* ─────────────────────────── the timeline: pure ─────────────────────────── */

/**
 * One automation event. `set` jumps, `ramp` slides in a straight line, `exp` slides evenly in
 * pitch, and `target` eases toward `v` with time constant `tc` — the way a mouth moves, fast at
 * first and settling.
 */
export type Step =
  | { t: number; v: number; how: 'set' | 'ramp' | 'exp' }
  | { t: number; v: number; how: 'target'; tc: number }

/** a consonant's noise: through its own band (s, sh, a click's burst), or through the vowel (h,
 *  the breath after p, t and k) */
export type Burst = {
  at: number
  len: number
  hz: number
  q: number
  level: number
  through: 'band' | 'vowel'
  /** seconds to full level: a click's burst is there at once and dies away, a hiss swells in */
  rise: number
}

export type Phrase = {
  part: Part
  from: number
  to: number
  /** Hz */
  pitch: Step[]
  /** vibrato depth, cents */
  vibrato: Step[]
  /** F1–F4, Hz */
  formants: [Step[], Step[], Step[], Step[]]
  /** how much voice goes into the formants, 0..1 (the breath rides on it) */
  voicing: Step[]
  /** the lowpass after the formants, Hz: open, or closed for a nasal murmur or a voice bar */
  muffle: Step[]
  bursts: Burst[]
  /** the chop's gate, 0 or 1; empty when there is no chop */
  gate: Step[]
}

/** a gap shorter than this is sung through: the vowel holds to the next consonant */
export const LEGATO = 0.12
/** a gap this long ends a phrase */
export const REST = 0.35
/**
 * How far past its note the last vowel of a phrase fades out.
 *
 * ⚠️ MEASURED, 15 Nov 2026, from the sung song rendered to a WAV: every phrase ended by losing
 * about 20dB in 15ms, the 40ms ramp landing exactly on the note's end, so the last word of each
 * line read as cut off rather than let go. 80ms more, after the note, is still well inside the
 * shortest rest that ends a phrase (REST) and inside the voice's own tail (Phrase.to).
 */
export const TAIL = 0.08

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/**
 * The lowpass after the throat, wide open. It closes for the nasal murmur of m and n and for the
 * voice bar of b, d and g, which are the voice heard through closed lips or a closed nose — low,
 * dull, and nothing like a quiet vowel, which is what both used to be.
 */
const OPEN = 16000
/** closed for a voice bar: only the buzz's lowest harmonics get through */
const BAR = 450
/** half-closed for the voice under z, v and the voiced th, which is buzz and hiss at once */
const BUZZ = 900
/** the voice bar's level, against the vowel */
const VOICE_BAR = 0.1
/** and the voice under a z or a v */
const VOICED_HISS = 0.18
/** a click's burst is at full level within half a millisecond: abruptness is what a release is */
const CLICK = 0.0005
/** the breath after p, t and k, through the coming vowel's shape */
const ASPIRATION = 0.7

/** natural lengths, in seconds, when there is time for them */
const T = {
  /** the silence before a stop's burst — half of what makes it a stop at all */
  closure: 0.05,
  burst: 0.015,
  /** the breath between a p, t or k and the voice */
  aspiration: 0.04,
  /** and the little there is after a b, d or g */
  vot: 0.008,
}

/** a noise, through a band-pass */
type Band = { hz: number; q: number; level: number }

/**
 * Each hiss by where it is made. s is a high, wide band; sh is lower and the loudest of them; f
 * and th are flat, quiet and nearly alike — told apart, as they are in speech, mostly by how the
 * vowel moves away from them.
 *
 * ⚠️ THEY USED TO BE NARROW AND QUIET. s was a band at Q 2.5 and sat 26dB under its vowel; f and
 * th averaged 39dB under, which is not a consonant, it is a pause. Measured against the vowel's
 * own level in docs/2026-11-14-singer-diction.md.
 */
const HISS: Record<Place, Band> = {
  ridge: { hz: 6500, q: 1.1, level: 0.75 },
  palate: { hz: 3000, q: 1.4, level: 1.4 },
  lips: { hz: 4500, q: 0.35, level: 0.26 },
  teeth: { hz: 6500, q: 0.4, level: 0.24 },
  /* English has no hiss at the velum; a sh is the nearest */
  velum: { hz: 3000, q: 1.4, level: 0.8 },
  /* h never reaches this table: it is breath through the vowel */
  glottis: { hz: 1800, q: 0.7, level: 0.55 },
}

/**
 * A stop's burst by where it is made: lips give a low, spread-out puff; the ridge a high one; the
 * velum a compact peak that sits on the coming vowel's F2, which is why a k before "ee" and a k
 * before "oo" are different clicks. Voiced stops burst at half the level.
 */
function burstOf(c: Consonant & { kind: 'click' }, vowel: readonly number[]): Band {
  const b: Band =
    c.place === 'lips'
      ? { hz: 900, q: 0.5, level: 1.6 }
      : c.place === 'velum'
        ? { hz: Math.min(3200, Math.max(1400, vowel[1] * 1.1)), q: 2.5, level: 3.2 }
        : c.place === 'palate'
          ? { hz: 3200, q: 1, level: 2.2 }
          : { hz: 4200, q: 0.9, level: 2.8 }
  return c.voiced ? { ...b, level: b.level / 2 } : b
}

/**
 * A nasal murmur: one low resonance, and the rest heard through a lowpass — m duller than n,
 * because closed lips cancel more of the sound above 1kHz than a tongue on the ridge does.
 */
const MURMUR = {
  lips: { f: [260, 1100, 2300, 3300], muffle: 800 },
  ridge: { f: [260, 1500, 2600, 3500], muffle: 1300 },
  velum: { f: [260, 1900, 2700, 3600], muffle: 1700 },
} as const
const murmurAt = (p: Place): keyof typeof MURMUR =>
  p === 'lips' ? 'lips' : p === 'velum' ? 'velum' : 'ridge'

/** how much of a stop's closure is not needed when the voice was already silent before it */
const spare = (c: Consonant) => (c.kind !== 'click' ? 0 : c.voiced ? T.closure - 0.03 : T.closure)
const closureOf = (c: Consonant) => (c.kind === 'click' ? T.closure : 0)

/**
 * How long one consonant takes before a vowel when there is time, in seconds. A stop is its
 * closure, its burst and what follows the burst — breath after p, t and k (less after an s, as in
 * "st", and less before another consonant, as in "pl"), almost nothing after b, d and g, and a sh
 * after ch and j.
 */
function lengthIn(cs: readonly Consonant[], j: number): number {
  const c = cs[j]
  if (c.kind === 'click') {
    const after =
      c.place === 'palate'
        ? c.voiced
          ? 0.04
          : 0.05
        : c.voiced
          ? T.vot
          : cs[j - 1]?.kind === 'hiss'
            ? 0.012
            : j < cs.length - 1
              ? 0.02
              : T.aspiration
    return T.closure + T.burst + after
  }
  if (c.kind === 'hiss') {
    if (c.place === 'glottis') return 0.07
    const loud = c.place === 'ridge' || c.place === 'palate'
    return c.voiced ? (loud ? 0.08 : 0.07) : loud ? 0.1 : 0.085
  }
  return c.kind === 'hum' ? 0.07 : 0.075
}

/** how long all of a syllable's opening consonants take, together */
export const onsetLength = (cs: readonly Consonant[]) =>
  cs.reduce((s, _, j) => s + lengthIn(cs, j), 0)

/** how long a closing consonant takes at the end of its note */
function codaLength(c: Consonant): number {
  if (c.kind === 'click')
    return 0.045 + T.burst + (c.place === 'palate' ? 0.05 : c.voiced ? 0.012 : 0.02)
  if (c.kind === 'hiss')
    return c.voiced ? 0.075 : c.place === 'ridge' || c.place === 'palate' ? 0.1 : 0.085
  return 0.08
}

/** two consonants that are the same sound */
const same = (a: Consonant, b: Consonant) =>
  a.kind === b.kind &&
  (a.kind === 'glide'
    ? b.kind === 'glide' && a.shape === b.shape
    : 'place' in b && a.place === b.place)

/**
 * The formants a vowel starts from after a consonant made at `place`, or heads for before one —
 * the movement a listener hears the consonant by.
 *
 * ⚠️ THIS IS WHAT TELLS b FROM d FROM g, AND m FROM n. A burst lasts 10ms; the vowel's first 50ms
 * moving out of the consonant is five times as long and is louder. Without it the voice moved
 * straight from vowel to vowel and every stop sounded alike — measured, "ma" and "na" rendered
 * identically, and so did the first 80ms of "pa", "ta" and "ka".
 *
 * F2 follows the locus equations phoneticians fit to real speech (F2 at the release against F2 in
 * the vowel is close to a straight line, with a slope and intercept that depend on the place):
 * lips pull F2 down, the ridge pulls it toward ~1.8kHz, and the velum brings F2 and F3 together
 * (the "velar pinch"). F1 always starts low, because any closure lowers it.
 */
function locus(place: Place, vowel: readonly number[], scale = 1): number[] {
  const [f1, f2, f3, f4] = vowel
  if (place === 'glottis') return [...vowel]
  const c1 = Math.min(f1, Math.max(250 * scale, 0.5 * f1))
  let c2: number
  let c3: number
  if (place === 'lips') {
    c2 = 0.7 * f2 + 250 * scale
    c3 = f3 - 200 * scale
  } else if (place === 'teeth') {
    c2 = 0.5 * f2 + 900 * scale
    c3 = f3
  } else if (place === 'ridge') {
    c2 = 0.4 * f2 + 1150 * scale
    c3 = Math.max(f3, 2700 * scale)
  } else if (place === 'palate') {
    c2 = 0.3 * f2 + 1700 * scale
    c3 = Math.max(f3, c2 + 400 * scale)
  } else {
    c2 = 0.9 * f2 + 300 * scale
    c3 = f3 - 0.5 * (f3 - (c2 + 250 * scale))
  }
  c2 = Math.max(c2, c1 + 250)
  c3 = Math.max(c3, c2 + 250)
  return [c1, c2, c3, Math.max(f4, c3 + 300)]
}

/**
 * A vowel's four formants for this voice and this note.
 *
 * ⚠️ F1 RISES WITH A HIGH NOTE, as a soprano's does. A resonance below the pitch has no harmonic to
 * shape — "ee" has F1 at 310Hz and a C5 is 523Hz — so the vowel loses its body exactly where
 * a high melody sits. Singers open the jaw to keep F1 just above the pitch, and so does this, up to
 * the most open vowel's own.
 */
export function vowelFormants(vowel: VowelId, f0: number, scale: number): number[] {
  return formantsOf(VOWELS[vowel], f0, scale)
}

/** any shape of the mouth — a vowel's, a glide's — as four formants for this voice and note */
function formantsOf(shape: readonly number[], f0: number, scale: number): number[] {
  const [a, b, c] = shape
  const f1 = Math.min(Math.max(a * scale, f0 * 1.15), Math.max(a * scale, 1150))
  const f2 = Math.max(b * scale, f1 + 250)
  const f3 = Math.max(c * scale, f2 + 250)
  const f4 = Math.max(4200 * scale, f3 + 300)
  return [f1, f2, f3, f4]
}

/**
 * Formant bandwidths in Hz, near Klatt's for a voice: wider for the upper ones.
 *
 * ⚠️ NARROW ENOUGH FOR F2 TO STAND UP. The cascade's F1 falls 12dB an octave above itself, so an
 * "ee" (F1 310, F2 2790) reaches its F2 some 38dB down; measured with the first, wider bandwidths
 * (B2 = 210Hz there), F2 sat 35dB under F1 and lower than F1's own skirt at 660Hz — the vowel
 * drifted toward "oo". A real "ee" has F2 some 20–25dB down.
 */
export function bandwidth(k: number, f: number, width: number): number {
  return [50 + 0.06 * f, 60 + 0.02 * f, 100 + 0.03 * f, 250][k] * width
}

/** a repeatable random source (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Events into phrases — runs of notes with no real rest between them — each with the automation a
 * single continuous voice needs to sing them. One voice per phrase, not one per syllable, is what
 * lets the pitch glide and the mouth move from one syllable into the next.
 */
export function planPhrases(events: readonly Event[], v: Voice, beat: number, seed = 1): Phrase[] {
  const out: Phrase[] = []
  for (const part of ['lead', 'harmony'] as const) {
    const evs = events.filter((e) => e.part === part).sort((a, b) => a.vowelAt - b.vowelAt)
    let group: Event[] = []
    const flush = () => {
      if (group.length) out.push(phrase(group, part, v, beat, seed * 7919 + out.length * 104729))
      group = []
    }
    for (const e of evs) {
      const last = group[group.length - 1]
      if (last && e.from - last.end >= REST) flush()
      group.push(e)
    }
    flush()
  }
  return out
}

function phrase(evs: Event[], part: Part, v: Voice, beat: number, seed: number): Phrase {
  const r = rng(seed)
  const spread = (w: number) => (r() * 2 - 1) * w
  /* the humanising, drawn up front so a syllable's neighbours can see it */
  const nudge = evs.map(() => spread(v.humanize.ms) / 1000)
  const lvl = evs.map(() => 10 ** (spread(v.humanize.db) / 20))
  const cents = evs.map(() => spread(v.humanize.cents))

  const from = Math.max(0, evs[0].from + nudge[0] - Math.max(0.02, v.attack))
  const pitch: Step[] = []
  const vibrato: Step[] = [{ t: from, v: 0, how: 'set' }]
  const formants: [Step[], Step[], Step[], Step[]] = [[], [], [], []]
  const voicing: Step[] = [{ t: from, v: 0, how: 'set' }]
  const muffle: Step[] = [{ t: from, v: OPEN, how: 'set' }]
  const bursts: Burst[] = []
  const gate: Step[] = v.chop ? [{ t: from, v: 0, how: 'set' }] : []
  const allTo = (fs: readonly number[], t: number, how: 'set' | 'target', tc = 0.02) =>
    fs.forEach((f, k) => formants[k].push(how === 'set' ? { t, v: f, how } : { t, v: f, how, tc }))
  const muffleTo = (hzTo: number, t: number, tc: number) =>
    muffle.push({ t, v: hzTo, how: 'target', tc })
  let level = 0
  const say = (t: number, to: number, how: 'set' | 'ramp' = 'ramp') => {
    voicing.push({ t, v: to, how })
    level = to
  }
  const noise = (b: Omit<Burst, 'level'> & { level: number }) =>
    bursts.push({ ...b, level: b.level * v.diction })
  let prevHz = 0
  let lastEnd = from

  evs.forEach((e, i) => {
    const next = evs[i + 1]
    const L = lvl[i]
    const vowelAt = e.vowelAt + nudge[i]
    const cFrom = Math.max(lastEnd, e.from + nudge[i])
    const nextFrom = next ? next.from + nudge[i + 1] : Infinity
    const legato = nextFrom - e.end < LEGATO
    const legatoIn = i > 0 && level > 0
    const hold = legato ? nextFrom : e.end
    const f0 = hz(e.pitches[0].midi)
    const shape = (vw: VowelId) => vowelFormants(vw, f0, v.formant)
    const vt = shape(e.phones.vowel)
    /* the mouth's shape at a consonant: a glide's own, a nasal's murmur, or where the tongue or
       lips close — which is the shape the vowel beside it moves from, or heads for */
    const at = (c: Consonant): number[] =>
      c.kind === 'glide'
        ? formantsOf(GLIDES[c.shape], f0, v.formant)
        : c.kind === 'hum'
          ? MURMUR[murmurAt(c.place)].f.map((f) => f * v.formant)
          : locus(c.place, vt, v.formant)

    /* ── pitch: scoop into a phrase, glide (or snap) between notes ── */
    e.pitches.forEach((p, k) => {
      const t = k === 0 ? vowelAt : p.at
      const target = hz(p.midi) * 2 ** (cents[i] / 1200)
      if (!prevHz) {
        const low = target * 2 ** (-v.scoop / 12)
        pitch.push({ t: from, v: low, how: 'set' })
        if (v.scoop > 0) {
          pitch.push({ t: Math.max(from, t - 0.01), v: low, how: 'set' })
          pitch.push({ t: t + 0.09, v: target, how: 'exp' })
        } else pitch.push({ t: from, v: target, how: 'set' })
      } else if (v.glide <= 0) {
        /* hard tune: the jump hides in the consonant when there is one, and is the sound when not */
        pitch.push({ t: k === 0 ? cFrom : t, v: target, how: 'set' })
      } else {
        const last = pitch[pitch.length - 1].t
        let arrive = t + v.glide * 0.35
        const leave = Math.max(last, arrive - v.glide)
        if (arrive <= leave) arrive = leave + 0.01
        pitch.push({ t: leave, v: prevHz, how: 'set' })
        pitch.push({ t: arrive, v: target, how: 'exp' })
      }
      prevHz = target
      /* vibrato only on what is held long enough to settle first */
      const segEnd = k + 1 < e.pitches.length ? e.pitches[k + 1].at : hold
      lateVibrato(vibrato, t, segEnd, v)
    })

    /* ── the onset: each consonant in turn, then the vowel ── */
    const ons = e.phones.onsets
    if (i === 0) allTo(ons.length ? at(ons[0]) : vt, from, 'set')
    muffleTo(OPEN, cFrom, 0.004)
    if (!legatoIn) say(cFrom, 0, 'set')
    else say(cFrom, level, 'set')
    const atk = v.attack
    const rise = (t: number, to = L) => {
      if (e.stutter.length) return
      say(t, to)
    }

    if (!ons.length) {
      allTo(vt, cFrom, 'target', 0.022)
      if (legatoIn) {
        /* a vowel straight after a vowel: a small dip so the new syllable is heard to start */
        say(Math.max(cFrom, vowelAt - 0.03), level, 'set')
        say(vowelAt - 0.008, 0.5 * L)
        rise(vowelAt + 0.03)
      } else {
        say(Math.max(cFrom, vowelAt - 0.002), 0, 'set')
        rise(vowelAt + atk)
      }
    } else {
      /* ⚠️ A STOP NEEDS ITS SILENCE. Each consonant takes its natural length when there is time
         and all of them shrink together when there is not; a stop's closure is free when the
         voice was already silent, because the silence is there anyway. */
      const lens = ons.map((c, j) => lengthIn(ons, j) - (j === 0 && !legatoIn ? spare(c) : 0))
      const natural = lens.reduce((s, x) => s + x, 0)
      const k = Math.min(1, (vowelAt - cFrom) / natural)
      let a = vowelAt - k * natural
      /* ⚠️ NOTHING A CONSONANT DOES MAY BE STAMPED BEFORE IT STARTS. With no time to spare a
         consonant is a few milliseconds long, and "move into the vowel 35ms before the end"
         lands before "take the glide's shape" — sorted, the shape wins and the whole vowel is
         sung in it: a line starting on "wa" with nothing in hand sang its "a" at the w's F2. */
      const after = (t: number) => Math.max(a, t)
      if (legatoIn) say(a, level, 'set')
      ons.forEach((c, j) => {
        const b = a + k * lens[j]
        const last = j === ons.length - 1
        const then = last ? vt : at(ons[j + 1])
        if (c.kind === 'click') {
          const voiced = !!c.voiced
          const cl = k * (closureOf(c) - (j === 0 && !legatoIn ? spare(c) : 0))
          const blen = Math.max(0.004, k * T.burst)
          const release = a + cl
          allTo(locus(c.place, vt, v.formant), a, 'target', 0.012)
          say(a, level, 'set')
          if (voiced) {
            /* the voice bar: the throat still buzzing behind closed lips, heard as a low murmur */
            say(a + 0.008, VOICE_BAR * L)
            muffleTo(BAR, a, 0.004)
            muffleTo(OPEN, release, 0.002)
          } else say(a + 0.008, 0)
          noise({ at: release, len: blen, ...burstOf(c, vt), through: 'band', rise: CLICK })
          if (c.place === 'palate') {
            /* ch and j: a stop released into a sh */
            const sh = HISS.palate
            noise({
              at: release + blen / 2,
              len: b - release + 0.01,
              hz: sh.hz * v.formant,
              q: sh.q,
              level: sh.level * (voiced ? 0.5 : 0.8),
              through: 'band',
              rise: 0.004,
            })
          } else if (!voiced)
            noise({
              at: release + blen,
              len: Math.max(0.004, b - release - blen + 0.008),
              hz: 0,
              q: 0,
              level: ASPIRATION,
              through: 'vowel',
              rise: 0.003,
            })
          allTo(then, voiced ? release : Math.max(release + blen, b - 0.01), 'target', 0.025)
          if (last) {
            say(voiced ? release + blen : b - 0.003, voiced ? VOICE_BAR * L : 0, 'set')
            rise(b + atk * 0.6)
          }
        } else if (c.kind === 'hiss' && c.place === 'glottis') {
          /* h is breath through the shape of what follows, not a hiss of its own */
          allTo(then, a, 'target', 0.015)
          say(a, level, 'set')
          say(a + 0.02, 0)
          noise({
            at: a,
            len: b - a + 0.02,
            hz: 0,
            q: 0,
            level: 0.55,
            through: 'vowel',
            rise: 0.01,
          })
          if (last) {
            say(b - 0.005, level, 'set')
            rise(b + atk)
          }
        } else if (c.kind === 'hiss') {
          const band = HISS[c.place]
          allTo(locus(c.place, vt, v.formant), a, 'target', 0.015)
          say(a, level, 'set')
          if (c.voiced) {
            say(a + 0.015, VOICED_HISS * L)
            muffleTo(BUZZ, a, 0.006)
            muffleTo(OPEN, after(b - 0.004), 0.003)
          } else say(a + 0.015, 0)
          noise({
            at: a,
            len: b - a + 0.01,
            hz: band.hz * v.formant,
            q: band.q,
            level: band.level * (c.voiced ? 0.6 : 1),
            through: 'band',
            /* a swell, never a switch — even when there is no time for the consonant at all */
            rise: Math.max(0.002, Math.min(0.015, (b - a) / 3)),
          })
          allTo(then, after(b - 0.01), 'target', 0.02)
          if (last) {
            say(b - 0.005, level, 'set')
            rise(b + atk)
          }
        } else if (c.kind === 'hum') {
          /* m, n: a murmur through the nose, then the mouth opens all at once */
          const m = MURMUR[murmurAt(c.place)]
          allTo(at(c), a, 'target', 0.01)
          muffleTo(m.muffle, a, 0.005)
          say(a, level, 'set')
          say(a + 0.02, 0.55 * L)
          muffleTo(OPEN, after(b - 0.004), 0.003)
          allTo(locus(c.place, vt, v.formant), after(b - 0.004), 'target', 0.004)
          allTo(then, b + 0.004, 'target', 0.016)
          if (last) {
            say(b - 0.002, level, 'set')
            rise(b + 0.02)
          }
        } else {
          /* w, y, l, r: the glide's own shape, then a move into the vowel — slow for w, y and r,
             quick for l, whose tongue lets go of the ridge */
          const quick = c.shape === 'l' || c.shape === 'dl'
          allTo(at(c), a, 'target', 0.012)
          say(a, level, 'set')
          say(a + 0.02, 0.45 * L)
          allTo(then, after(quick ? b - 0.015 : b - 0.035), 'target', quick ? 0.01 : 0.028)
          if (last) rise(b + 0.035)
        }
        a = b
      })
    }
    const glideAt = vowelAt + (hold - vowelAt) * 0.55
    if (e.phones.to) allTo(shape(e.phones.to), glideAt, 'target', 0.07)

    /* the stutter: the syllable's start repeated on 32nds before it holds — each sliver faded in
       and out over a few milliseconds and a little louder than the last, so it leads into the
       syllable rather than clicking at it (softened 14 Nov 2026; it used to switch hard on and off
       at full level) */
    if (e.stutter.length) {
      const shift = vowelAt - e.vowelAt
      const n = e.stutter.length
      const sliver = beat / 16
      e.stutter.forEach((s0, k) => {
        const s = s0 + shift
        const lv = L * (0.45 + (0.35 * k) / n)
        say(s, 0, 'set')
        say(s + 0.004, lv)
        say(s + sliver - 0.006, lv, 'set')
        say(s + sliver, 0)
      })
      const last = e.stutter[n - 1] + shift + beat / 8
      say(last, 0, 'set')
      say(last + 0.008, L)
    }

    /* ── the end of the vowel: the codas, then a release unless the next syllable follows on ── */
    let codas = e.phones.codas
    /* "night time": a closing t into an opening t is one t */
    const into = next?.phones.onsets[0]
    const end = codas[codas.length - 1]
    if (legato && end && into && same(end, into) && end.kind !== 'hum') codas = codas.slice(0, -1)
    /* a coda needs the end of the note to itself: never inside a stutter, never before the vowel */
    const busy = voicing[voicing.length - 1].t
    const room = hold - Math.max(busy + 0.02, vowelAt + 0.08)
    const natural = codas.reduce((s, c) => s + codaLength(c), 0)
    if (codas.length && room > 0.04) {
      const k = Math.min(1, room / natural)
      let a = hold - k * natural
      /* the vowel moves toward the first closing consonant before it closes: "ca-t" is heard in
         the last of the "a" as much as in the t */
      allTo(
        at(codas[0]),
        Math.max(busy, a - 0.04, e.phones.to ? glideAt + 0.01 : 0),
        'target',
        0.02,
      )
      codas.forEach((c) => {
        const b = a + k * codaLength(c)
        say(a, level, 'set')
        if (c.kind === 'click') {
          const voiced = !!c.voiced
          const release = a + k * 0.045
          const blen = Math.max(0.004, k * T.burst)
          if (voiced) {
            say(a + 0.008, VOICE_BAR * L)
            muffleTo(BAR, a, 0.004)
            muffleTo(OPEN, release, 0.002)
          } else say(a + 0.008, 0)
          const band = burstOf(c, vt)
          noise({
            at: release,
            len: blen,
            ...band,
            level: band.level * 0.7,
            through: 'band',
            rise: CLICK,
          })
          if (c.place === 'palate') {
            const sh = HISS.palate
            noise({
              at: release + blen / 2,
              len: Math.max(0.004, b - release),
              hz: sh.hz * v.formant,
              q: sh.q,
              level: sh.level * (voiced ? 0.5 : 0.8),
              through: 'band',
              rise: 0.004,
            })
          } else if (!voiced)
            noise({
              at: release + blen,
              len: Math.max(0.004, Math.min(0.02, b - release - blen)),
              hz: 0,
              q: 0,
              level: ASPIRATION * 0.6,
              through: 'vowel',
              rise: 0.003,
            })
          if (voiced) {
            say(release, level, 'set')
            say(release + 0.012, 0)
          }
        } else if (c.kind === 'hiss') {
          const band = HISS[c.place]
          if (c.voiced) {
            say(a + 0.02, VOICED_HISS * L)
            muffleTo(BUZZ, a, 0.006)
          } else say(a + 0.02, 0)
          noise({
            at: a,
            len: b - a,
            hz: band.hz * v.formant,
            q: band.q,
            level: band.level * (c.voiced ? 0.6 : 1) * 0.85,
            through: 'band',
            rise: 0.01,
          })
        } else if (c.kind === 'hum') {
          allTo(at(c), a, 'target', 0.012)
          muffleTo(MURMUR[murmurAt(c.place)].muffle, a, 0.006)
          say(a + 0.03, 0.55 * L)
        } else {
          allTo(at(c), a - 0.01, 'target', 0.03)
          say(a + 0.03, 0.6 * L)
        }
        a = b
      })
    }
    if (!legato) {
      const last = voicing[voicing.length - 1].t
      const fall = Math.max(last, hold - 0.04)
      say(fall, level, 'set')
      /* the last syllable of a phrase lets go a little past its note, as a voice does — inside a
         phrase the next syllable is close and the release stays short (see TAIL) */
      say(Math.max(fall + 0.01, hold + (next ? 0 : TAIL)), 0)
    }
    if (v.chop)
      for (const [a, b] of chopGates(cFrom, hold, beat)) {
        gate.push({ t: a, v: 1, how: 'set' })
        gate.push({ t: b, v: 0, how: 'set' })
      }
    lastEnd = hold
  })

  /* a line that starts on its first beat has no room before it: what would fall earlier starts at
     the phrase's own start, and a noise is cut short rather than moved */
  const clamp = (s: Step[]) => s.map((x) => (x.t < from ? { ...x, t: from } : x))
  const inside = bursts
    .map((b) => {
      if (b.at >= from) return b
      const len = b.len - (from - b.at)
      return { ...b, at: from, len, rise: Math.min(b.rise, len) }
    })
    .filter((b) => b.len > 0.002)
  const byTime = (s: Step[]) =>
    clamp(s)
      .map((x, i) => [x, i] as const)
      .sort((a, b) => a[0].t - b[0].t || a[1] - b[1])
      .map(([x]) => x)
  return {
    part,
    from,
    to: lastEnd + 0.15,
    pitch: byTime(pitch),
    vibrato: byTime(vibrato),
    formants: formants.map(byTime) as Phrase['formants'],
    voicing: byTime(voicing),
    muffle: byTime(muffle),
    bursts: part === 'harmony' ? [] : inside,
    gate: byTime(gate),
  }
}

/** vibrato across one held stretch [a, b): none for `delay`, growing over `rise`, gone by b */
function lateVibrato(list: Step[], a: number, b: number, v: Voice) {
  const { delay, rise, cents } = v.vibrato
  if (cents <= 0) return
  const on = a + delay
  if (b - on < 0.15) return
  const full = Math.min(on + rise, b - 0.05)
  const depth = cents * Math.min(1, (full - on) / rise)
  list.push({ t: on, v: 0, how: 'set' })
  list.push({ t: full, v: depth, how: 'ramp' })
  list.push({ t: Math.max(full, b - 0.06), v: depth, how: 'set' })
  list.push({ t: b, v: 0, how: 'ramp' })
}

/** the late vibrato's wait into a note, the time it takes to grow, and its speed */
const LATE = { delay: 0.5, rise: 0.55, rate: 5.1 }

/**
 * The late vibrato: today's waits about a third of a second into anything held half a second and
 * then grows quickly; this waits half a second, so only a long note wavers at all, grows over
 * another half, and is slower and about two thirds as deep. A Voice in, a Voice out, so the planner
 * sees one ordinary voice.
 *
 * ⚠️ GLITCHY GETS ONE TOO, at the floor of 12 cents. Its hard tune has none today, and a switch that
 * did nothing on one voice in three would read as broken.
 */
export function lateVibratoOf(v: Voice): Voice {
  return {
    ...v,
    vibrato: { ...LATE, cents: Math.max(12, Math.round(v.vibrato.cents * 0.65)) },
  }
}

/** one voice to build for a line: which phrase, where, how loud, how detuned, and with or without
 *  its consonants' noise */
export type Spec = { ph: Phrase; pan: number; gain: number; cents: number; bursts: boolean }

/**
 * The voices a line is sung with — pure, so the stack can be asked. The lead (doubled either side
 * of the middle when asked), the harmony when there is one, and the octave double under the lead.
 *
 * ⚠️ THE OCTAVE IS QUIET AND CARRIES NO CONSONANTS. It is the lead's own timeline a little late and
 * twelve hundred cents down, so it can only thicken the vowels; its own hiss and bursts would land
 * a few milliseconds after the lead's and smear exactly what #325 sharpened. It doubles the lead
 * once, never the doubled voice or the harmony.
 */
export function voicesFor(phrases: readonly Phrase[], v: Voice, opts: SingOpts): Spec[] {
  const out: Spec[] = []
  for (const ph of phrases) {
    if (ph.part === 'harmony') {
      out.push({ ph, pan: 0, gain: HARMONY, cents: 0, bursts: false })
      continue
    }
    if (opts.double) {
      const d = v.double
      out.push({ ph, pan: -d.pan, gain: 1, cents: 0, bursts: true })
      out.push({
        ph: doublePhrase(ph, d.ms / 1000, d.formant),
        pan: d.pan,
        gain: DOUBLE,
        cents: d.cents,
        bursts: true,
      })
    } else out.push({ ph, pan: 0, gain: 1, cents: 0, bursts: true })
    if (opts.octave)
      out.push({
        ph: doublePhrase(ph, OCTAVE.ms / 1000, OCTAVE.formant),
        pan: 0,
        gain: OCTAVE.gain,
        cents: -1200 + OCTAVE.cents,
        bursts: false,
      })
  }
  return out
}

/** how quiet the octave double is against the lead, how late, how detuned, and a slightly bigger
 *  throat, as a lower voice has */
const OCTAVE = { gain: 0.32, ms: 9, cents: 4, formant: 0.97 }

/**
 * A light room: short, answering a moment late; and a soft echo, one clear repeat and a faint second.
 * Both are fed from the voice's middle only, so its consonants stay dry.
 *
 * Measured on 14 Nov 2026 as the wet signal's own energy against the dry voice, over the A/B page's
 * four lines — two renders with the same random numbers, one with the send at 0, subtracted sample
 * by sample, because two ordinary renders differ by more than a quiet reverb does. The part bus's
 * room, today: 22dB under the voice, for 2.2s. This room: 25dB under, for 0.9s. The echo: 20dB under,
 * on top of today's room. The first values tried, 0.45 and 0.16, read 18dB and 13dB: a "light" room
 * wetter than today's, which only the exact measurement showed.
 */
export const LIGHT = {
  room: { decay: 0.9, pre: 0.02, wet: 0.21 },
  echo: { beats: 0.5, feedback: 0.18, wet: 0.07 },
  send: { hp: 400, lp: 5000 },
}

/** how long the echo's repeats are, and how long the room must outlast the last note — until the
 *  plate and the last repeat are both 60dB down */
export function lightTail(beat: number) {
  const delay = LIGHT.echo.beats * beat
  const repeats = Math.ceil(Math.log(0.001) / Math.log(LIGHT.echo.feedback))
  return { delay, tail: Math.max(LIGHT.room.pre + LIGHT.room.decay, delay * repeats) }
}

/**
 * A plate's impulse, made from noise like every other sound here: two decorrelated channels falling
 * 60dB over `decay` seconds, and darkening as they fall — a real plate's top end dies first, and a
 * tail that stays as bright as its start sounds like hiss. `rand` makes it repeatable for a test.
 */
export function plate(
  rate: number,
  decay: number,
  rand: () => number = Math.random,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.max(1, Math.round(rate * decay))
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(new ArrayBuffer(n * 4)),
    new Float32Array(new ArrayBuffer(n * 4)),
  ]
  for (const d of out) {
    let y = 0
    for (let i = 0; i < n; i++) {
      const x = i / n
      /* a one-pole low-pass that closes as the tail falls: wide open at the start, dull by the end */
      const a = 1 - 0.85 * x
      y += a * (rand() * 2 - 1 - y)
      d[i] = y * Math.exp(-6.91 * x)
    }
  }
  return out
}

/**
 * The second voice of a doubled part: the same phrase a few milliseconds late, with a slightly
 * different throat. Its detune is applied by the oscillator, so the pitch timeline is shared.
 */
export function doublePhrase(p: Phrase, late: number, formant: number): Phrase {
  const shift = (s: Step[]) => s.map((x) => ({ ...x, t: x.t + late }))
  return {
    ...p,
    from: p.from + late,
    to: p.to + late,
    pitch: shift(p.pitch),
    vibrato: shift(p.vibrato),
    formants: p.formants.map((f) =>
      shift(f).map((x) => ({ ...x, v: x.v * formant })),
    ) as Phrase['formants'],
    voicing: shift(p.voicing),
    muffle: shift(p.muffle),
    bursts: p.bursts.map((b) => ({ ...b, at: b.at + late })),
    gate: shift(p.gate),
  }
}

/* ─────────────────────────── the sound: Web Audio ─────────────────────────── */

/** how many voices are built and not yet let go — a probe's leak check, nothing else reads it */
let live = 0
export const liveSingers = () => live

const noises = new WeakMap<BaseAudioContext, AudioBuffer>()
function noiseFor(c: BaseAudioContext): AudioBuffer {
  let b = noises.get(c)
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noises.set(c, b)
  }
  return b
}

const waves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>()
/**
 * The buzz: harmonics falling as n^-tilt, the shape a glottis and a pair of lips give a voice
 * between them — darker than a sawtooth (which is n^-1 with every harmonic in phase) and
 * band-limited by the browser at any pitch, so a high note does not alias.
 */
function glottal(c: BaseAudioContext, v: Voice): PeriodicWave {
  let m = waves.get(c)
  if (!m) waves.set(c, (m = new Map()))
  const key = `${v.tilt}|${v.h1}`
  let w = m.get(key)
  if (!w) {
    const N = 64
    const real = new Float32Array(N + 1)
    const imag = new Float32Array(N + 1)
    for (let n = 1; n <= N; n++) imag[n] = n ** -v.tilt * (n === 1 ? v.h1 : 1)
    w = c.createPeriodicWave(real, imag)
    m.set(key, w)
  }
  return w
}

function apply(param: AudioParam, steps: readonly Step[]) {
  for (const s of steps) {
    if (s.how === 'set') param.setValueAtTime(s.v, s.t)
    else if (s.how === 'ramp') param.linearRampToValueAtTime(s.v, s.t)
    else if (s.how === 'exp') param.exponentialRampToValueAtTime(Math.max(1e-4, s.v), s.t)
    else if (s.how === 'target') param.setTargetAtTime(s.v, s.t, s.tc)
  }
}

/** a lowpass biquad's resonance is given in dB: the peak's height over the passband */
const resonance = (f: number, b: number) => Math.max(0, 20 * Math.log10(f / b))

type Build = { pan: number; gain: number; cents: number; bursts: boolean }

/**
 * One voice for one phrase: buzz and breath, through the voicing level, through F1→F2→F3→F4 as a
 * cascade of resonant low-passes (each passes the low end at unity and peaks at its formant, which
 * gives the vowels their natural relative loudness for free), then level, crush, chop and pan.
 *
 * ⚠️ EVERYTHING IT MAKES IS LET GO when its oscillator ends or when it is stopped, whichever comes
 * first, exactly once — a line is a few hundred nodes and a phone notices the ones left hanging.
 */
function build(c: BaseAudioContext, dest: AudioNode, ph: Phrase, v: Voice, o: Build) {
  live++
  const nodes: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []
  const add = <T extends AudioNode>(n: T): T => {
    nodes.push(n)
    return n
  }
  const source = <T extends AudioScheduledSourceNode>(n: T, at: number, end: number): T => {
    add(n)
    sources.push(n)
    n.start(at)
    n.stop(end)
    return n
  }

  const voicing = add(c.createGain())
  voicing.gain.value = 0
  apply(voicing.gain, ph.voicing)
  const fs = [0, 1, 2, 3].map(() => {
    const f = add(c.createBiquadFilter())
    f.type = 'lowpass'
    return f
  })
  ph.formants.forEach((steps, k) => {
    apply(fs[k].frequency, steps)
    apply(
      fs[k].Q,
      steps.map((s) => ({ ...s, v: resonance(s.v, bandwidth(k, s.v, v.width)) })),
    )
  })
  voicing.connect(fs[0])
  for (let k = 0; k < 3; k++) fs[k].connect(fs[k + 1])
  const muffle = add(c.createBiquadFilter())
  muffle.type = 'lowpass'
  muffle.Q.value = 0
  muffle.frequency.value = OPEN
  apply(muffle.frequency, ph.muffle)
  fs[3].connect(muffle)
  const presence = add(c.createBiquadFilter())
  presence.type = 'peaking'
  presence.frequency.value = 3000
  presence.Q.value = 0.7
  presence.gain.value = v.bright
  muffle.connect(presence)
  const level = add(c.createGain())
  level.gain.value = v.out * o.gain
  presence.connect(level)
  if (v.air > 0) {
    /* after the voicing level, so the air comes and goes with the syllables */
    const hp = add(c.createBiquadFilter())
    hp.type = 'highpass'
    hp.frequency.value = 4000
    const air = add(c.createGain())
    air.gain.value = v.air
    voicing.connect(hp)
    hp.connect(air)
    air.connect(level)
  }
  let tail: AudioNode = level
  if (v.crush) {
    const { steps, drive, mix } = v.crush
    const sum = add(c.createGain())
    const dry = add(c.createGain())
    dry.gain.value = 1 - mix
    const pre = add(c.createGain())
    pre.gain.value = drive
    const sh = add(c.createWaveShaper())
    sh.curve = crushCurve(steps)
    const wet = add(c.createGain())
    wet.gain.value = mix / drive
    level.connect(dry)
    dry.connect(sum)
    level.connect(pre)
    pre.connect(sh)
    sh.connect(wet)
    wet.connect(sum)
    tail = sum
  }
  const gate = add(c.createGain())
  if (ph.gate.length) apply(gate.gain, ph.gate)
  tail.connect(gate)
  const pan = add(c.createStereoPanner())
  pan.pan.value = o.pan
  gate.connect(pan)
  pan.connect(dest)

  const osc = add(c.createOscillator())
  osc.setPeriodicWave(glottal(c, v))
  osc.detune.value = o.cents
  apply(osc.frequency, ph.pitch)
  osc.connect(voicing)
  sources.push(osc)

  const vib = c.createOscillator()
  vib.frequency.value = v.vibrato.rate
  const vibDepth = add(c.createGain())
  vibDepth.gain.value = 0
  apply(vibDepth.gain, ph.vibrato)
  vib.connect(vibDepth)
  vibDepth.connect(osc.detune)
  source(vib, ph.from, ph.to)

  if (v.humanize.drift > 0) {
    /* a slow wander under the pitch, at a different rate for every voice so doubled parts beat */
    const drift = c.createOscillator()
    drift.frequency.value = 0.45 + Math.random() * 0.6
    const dd = add(c.createGain())
    dd.gain.value = v.humanize.drift
    drift.connect(dd)
    dd.connect(osc.detune)
    source(drift, ph.from, ph.to)
  }

  if (v.breath > 0) {
    const breath = c.createBufferSource()
    breath.buffer = noiseFor(c)
    breath.loop = true
    const hp = add(c.createBiquadFilter())
    hp.type = 'highpass'
    hp.frequency.value = 500
    const amt = add(c.createGain())
    amt.gain.value = v.breath
    breath.connect(hp)
    hp.connect(amt)
    amt.connect(voicing)
    source(breath, ph.from, ph.to)
  }

  if (o.bursts)
    for (const b of ph.bursts) {
      const n = c.createBufferSource()
      n.buffer = noiseFor(c)
      const f = add(c.createBiquadFilter())
      if (b.through === 'band') {
        f.type = 'bandpass'
        f.frequency.value = b.hz
        f.Q.value = b.q
      } else {
        f.type = 'highpass'
        f.frequency.value = 400
      }
      const env = add(c.createGain())
      env.gain.setValueAtTime(0, b.at)
      env.gain.linearRampToValueAtTime(b.level, b.at + b.rise)
      if (b.rise <= CLICK) {
        /* a click: there at once, and 26dB down by the end of its few milliseconds */
        env.gain.exponentialRampToValueAtTime(b.level * 0.05, b.at + b.len)
        env.gain.setValueAtTime(0, b.at + b.len)
      } else {
        const fall = Math.min(0.012, b.len / 3)
        env.gain.setValueAtTime(b.level, Math.max(b.at + b.rise, b.at + b.len - fall))
        env.gain.linearRampToValueAtTime(0, b.at + b.len)
      }
      n.connect(f)
      f.connect(env)
      /* a hiss is its own sound and skips the vowel; breath is shaped by it */
      env.connect(b.through === 'band' ? level : fs[0])
      source(n, b.at, b.at + b.len + 0.01)
    }

  let done = false
  const release = () => {
    if (done) return
    done = true
    live--
    for (const n of nodes) n.disconnect()
  }
  osc.onended = release
  osc.start(ph.from)
  osc.stop(ph.to)
  return {
    stop() {
      if (done) return
      const now = c.currentTime
      for (const s of sources)
        try {
          s.stop(now)
        } catch {
          /* never started, or already stopped */
        }
      release()
    },
  }
}

/** how loud the harmony and the doubled voice sit against the lead */
const HARMONY = 0.5
const DOUBLE = 0.8

const plates = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>()
function plateFor(c: BaseAudioContext, decay: number): AudioBuffer {
  let m = plates.get(c)
  if (!m) plates.set(c, (m = new Map()))
  let b = m.get(decay)
  if (!b) {
    const [l, r] = plate(c.sampleRate, decay)
    b = c.createBuffer(2, l.length, c.sampleRate)
    b.copyToChannel(l, 0)
    b.copyToChannel(r, 1)
    m.set(decay, b)
  }
  return b
}

/**
 * The light room or the soft echo, for one line: the voice straight through, and a send — high-
 * and low-passed, so neither the low end nor the consonants' hiss goes in — to a short plate or to
 * an echo that alternates sides.
 *
 * ⚠️ IT OUTLIVES THE LAST NOTE BY ITS TAIL, and is let go then, by a silent source timed to stop
 * when the last of it is 60dB down: its `ended` fires in a live context and an offline one alike,
 * where a timer would not. Stopping the line lets it go at once, tail and all.
 */
function lightFor(c: BaseAudioContext, dest: AudioNode, kind: 'room' | 'echo', beat: number) {
  live++
  const { delay, tail } = lightTail(beat)
  const nodes: AudioNode[] = []
  const add = <T extends AudioNode>(n: T): T => {
    nodes.push(n)
    return n
  }
  const input = add(c.createGain())
  input.connect(dest)
  const hp = add(c.createBiquadFilter())
  hp.type = 'highpass'
  hp.frequency.value = LIGHT.send.hp
  const lp = add(c.createBiquadFilter())
  lp.type = 'lowpass'
  lp.frequency.value = LIGHT.send.lp
  input.connect(hp)
  hp.connect(lp)
  const wet = add(c.createGain())
  wet.connect(dest)
  if (kind === 'room') {
    const pre = add(c.createDelay(0.2))
    pre.delayTime.value = LIGHT.room.pre
    const verb = add(c.createConvolver())
    verb.buffer = plateFor(c, LIGHT.room.decay)
    wet.gain.value = LIGHT.room.wet
    lp.connect(pre)
    pre.connect(verb)
    verb.connect(wet)
  } else {
    wet.gain.value = LIGHT.echo.wet
    const sides = [-0.6, 0.6].map((side) => {
      const d = add(c.createDelay(2))
      d.delayTime.value = delay
      const back = add(c.createGain())
      back.gain.value = LIGHT.echo.feedback
      const pan = add(c.createStereoPanner())
      pan.pan.value = side
      d.connect(pan)
      pan.connect(wet)
      d.connect(back)
      return { d, back }
    })
    lp.connect(sides[0].d)
    sides[0].back.connect(sides[1].d)
    sides[1].back.connect(sides[0].d)
  }
  let done = false
  let clock: ConstantSourceNode | null = null
  const release = () => {
    if (done) return
    done = true
    live--
    for (const n of nodes) n.disconnect()
    clock?.disconnect()
  }
  return {
    input,
    /** keep it until `end`, the last voice's end, plus its tail */
    until(end: number) {
      clock = c.createConstantSource()
      clock.offset.value = 0
      clock.connect(input)
      clock.onended = release
      clock.start()
      clock.stop(end + tail)
    },
    stop: release,
  }
}

/**
 * Sing a line into `dest` on context `c`. Returns a stop that silences it at once.
 *
 * `sung` times are seconds from `start`, which is a time on `c`'s clock.
 */
export function singInto(
  c: BaseAudioContext,
  dest: AudioNode,
  sung: readonly SungNote[],
  start: number,
  opts: SingOpts,
): () => void {
  const v = opts.vibrato === 'late' ? lateVibratoOf(PRESETS[opts.preset]) : PRESETS[opts.preset]
  const phrases = planPhrases(planLine(sung, start, opts), v, opts.beat, opts.seed ?? 1)
  const room = opts.space ? lightFor(c, dest, opts.space, opts.beat) : null
  const into = room ? room.input : dest
  const voices = voicesFor(phrases, v, opts).map(({ ph, ...o }) => build(c, into, ph, v, o))
  if (room) {
    const late = Math.max(0, ...voicesFor(phrases, v, opts).map((x) => x.ph.to))
    room.until(Math.max(start, late))
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const x of voices) x.stop()
    room?.stop()
  }
}
