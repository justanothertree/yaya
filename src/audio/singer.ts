import {
  VOWELS,
  phonesOf,
  type Consonant,
  type Phones,
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
  /** seconds for the voice to reach full level at a vowel */
  attack: number
  stutter: boolean
  crush: boolean
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
    width: 1,
    formant: 1,
    glide: 0.07,
    scoop: 0.4,
    vibrato: { delay: 0.32, rise: 0.35, rate: 5.6, cents: 28 },
    humanize: { cents: 5, ms: 6, db: 1, drift: 4 },
    bright: 6,
    attack: 0.03,
    stutter: false,
    crush: false,
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
    width: 1.35,
    formant: 1,
    glide: 0.11,
    scoop: 0.9,
    vibrato: { delay: 0.38, rise: 0.45, rate: 5.1, cents: 38 },
    humanize: { cents: 7, ms: 8, db: 1.5, drift: 5 },
    bright: 3,
    attack: 0.06,
    stutter: false,
    crush: false,
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
    width: 0.85,
    formant: 1.12,
    glide: 0,
    scoop: 0,
    vibrato: { delay: 0, rise: 0, rate: 5.5, cents: 0 },
    humanize: { cents: 0, ms: 0, db: 0.5, drift: 0 },
    bright: 8,
    attack: 0.008,
    stutter: true,
    crush: true,
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

/** how long a consonant takes before its vowel, in seconds */
export function consonantLength(c: Consonant | null): number {
  if (!c) return 0
  if (c.kind === 'hiss') return c.breath ? 0.06 : 0.085
  return c.kind === 'click' ? 0.045 : 0.06
}

/**
 * A line of sung notes into the events that will play it — pure, so the timing can be asked.
 *
 * ⚠️ THE VOWEL IS ON THE BEAT, THE CONSONANT BEFORE IT, which is how singers place words: "sky"
 * starts its hiss early so the "ai" lands where the note is. Clamped to `start`, so the first word
 * of a line does not reach back before the line begins.
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
    for (const n of sung) {
      const at = start + n.t
      if (n.hold && cur) {
        cur.end = at + n.dur
        cur.pitches.push({ at, midi: p.pitch(n.midi) })
        continue
      }
      const phones = phonesOf(n.text)
      const onBar = Math.abs(n.t / bar - Math.round(n.t / bar)) < 1e-3
      cur = {
        part: p.part,
        phones,
        from: Math.max(start, at - consonantLength(phones.onset)),
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
  bursts: Burst[]
  /** the chop's gate, 0 or 1; empty when there is no chop */
  gate: Step[]
}

/** a gap shorter than this is sung through: the vowel holds to the next consonant */
export const LEGATO = 0.12
/** a gap this long ends a phrase */
export const REST = 0.35

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** the nasal murmur of m and n: a low resonance and the upper ones damped back */
const NASAL = [270, 1700, 2600, 4000] as const

/**
 * A vowel's four formants for this voice and this note.
 *
 * ⚠️ F1 RISES WITH A HIGH NOTE, as a soprano's does. A resonance below the pitch has no harmonic to
 * shape — "ee" has F1 at 310Hz and a C5 is 523Hz — so the vowel loses its body exactly where
 * glitchpop sings. Singers open the jaw to keep F1 just above the pitch, and so does this, up to
 * the most open vowel's own.
 */
export function vowelFormants(vowel: VowelId, f0: number, scale: number): number[] {
  const [a, b, c] = VOWELS[vowel]
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
  const bursts: Burst[] = []
  const gate: Step[] = v.chop ? [{ t: from, v: 0, how: 'set' }] : []
  const allTo = (fs: number[], t: number, how: 'set' | 'target', tc = 0.02) =>
    fs.forEach((f, k) => formants[k].push(how === 'set' ? { t, v: f, how } : { t, v: f, how, tc }))
  let level = 0
  const say = (t: number, to: number, how: 'set' | 'ramp' = 'ramp') => {
    voicing.push({ t, v: to, how })
    level = to
  }
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
    const on = e.phones.onset

    /* ── pitch: scoop into a phrase, glide (or snap) between notes ── */
    e.pitches.forEach((p, k) => {
      const at = k === 0 ? vowelAt : p.at
      const target = hz(p.midi) * 2 ** (cents[i] / 1200)
      if (!prevHz) {
        const low = target * 2 ** (-v.scoop / 12)
        pitch.push({ t: from, v: low, how: 'set' })
        if (v.scoop > 0) {
          pitch.push({ t: Math.max(from, at - 0.01), v: low, how: 'set' })
          pitch.push({ t: at + 0.09, v: target, how: 'exp' })
        } else pitch.push({ t: from, v: target, how: 'set' })
      } else if (v.glide <= 0) {
        /* hard tune: the jump hides in the consonant when there is one, and is the sound when not */
        pitch.push({ t: k === 0 ? cFrom : at, v: target, how: 'set' })
      } else {
        const last = pitch[pitch.length - 1].t
        let arrive = at + v.glide * 0.35
        const leave = Math.max(last, arrive - v.glide)
        if (arrive <= leave) arrive = leave + 0.01
        pitch.push({ t: leave, v: prevHz, how: 'set' })
        pitch.push({ t: arrive, v: target, how: 'exp' })
      }
      prevHz = target
      /* vibrato only on what is held long enough to settle first */
      const segEnd = k + 1 < e.pitches.length ? e.pitches[k + 1].at : hold
      lateVibrato(vibrato, at, segEnd, v)
    })

    /* ── the mouth: into the onset's shape, then the vowel, then a diphthong's second half ── */
    const nasal = NASAL.map((f) => f * v.formant)
    if (i === 0)
      allTo(on?.kind === 'glide' ? shape(on.from) : on?.kind === 'hum' ? nasal : vt, from, 'set')
    if (on?.kind === 'glide') {
      allTo(shape(on.from), cFrom, 'target', 0.012)
      allTo(vt, vowelAt - 0.02, 'target', 0.03)
    } else if (on?.kind === 'hum') {
      allTo(nasal, cFrom, 'target', 0.012)
      allTo(vt, vowelAt, 'target', 0.02)
    } else allTo(vt, cFrom, 'target', 0.022)
    if (e.phones.to) allTo(shape(e.phones.to), vowelAt + (hold - vowelAt) * 0.55, 'target', 0.07)

    /* ── the voice's level: what the onset does to it, then the vowel ── */
    const atk = v.attack
    if (!legatoIn) say(cFrom, 0, 'set')
    else say(cFrom, level, 'set')
    const rise = (t: number, to = L) => {
      if (e.stutter.length) return
      say(t, to)
    }
    if (!on) {
      if (legatoIn) {
        /* a vowel straight after a vowel: a small dip so the new syllable is heard to start */
        say(Math.max(cFrom, vowelAt - 0.03), level, 'set')
        say(vowelAt - 0.008, 0.5 * L)
        rise(vowelAt + 0.03)
      } else {
        say(Math.max(cFrom, vowelAt - 0.002), 0, 'set')
        rise(vowelAt + atk)
      }
    } else if (on.kind === 'hiss') {
      say(cFrom + 0.02, on.voiced ? 0.3 * L : 0)
      say(vowelAt - 0.005, level, 'set')
      rise(vowelAt + atk)
      bursts.push(
        on.breath
          ? { at: cFrom, len: vowelAt + 0.02 - cFrom, hz: 0, q: 0, level: 0.55, through: 'vowel' }
          : {
              at: cFrom,
              len: vowelAt + 0.01 - cFrom,
              hz: on.hz * v.formant,
              q: on.hz > 4500 ? 2.5 : 1.6,
              level: on.weak ? 0.1 : on.voiced ? 0.22 : 0.32,
              through: 'band',
            },
      )
    } else if (on.kind === 'click') {
      /* closure, burst, then — for p, t and k — a breath of aspiration before the voice comes in */
      say(cFrom + 0.012, on.voiced ? 0.12 : 0)
      say(vowelAt - 0.003, on.voiced ? 0.12 : 0, 'set')
      rise(vowelAt + atk * 0.6)
      const burst = vowelAt - (on.voiced ? 0.012 : 0.03)
      bursts.push({
        at: burst,
        len: 0.012,
        hz: on.hz,
        q: 1.2,
        level: on.voiced ? 0.3 : 0.5,
        through: 'band',
      })
      if (!on.voiced)
        bursts.push({
          at: burst + 0.012,
          len: vowelAt + 0.012 - (burst + 0.012),
          hz: 0,
          q: 0,
          level: 0.35,
          through: 'vowel',
        })
    } else if (on.kind === 'hum') {
      say(cFrom + 0.025, 0.5 * L)
      say(vowelAt - 0.005, 0.5 * L, 'set')
      rise(vowelAt + 0.035)
    } else {
      say(cFrom + 0.02, 0.75 * L)
      rise(vowelAt + 0.035)
    }

    /* the stutter: the syllable's start cut on and off on 32nds before it holds */
    if (e.stutter.length) {
      const shift = vowelAt - e.vowelAt
      for (const s of e.stutter) {
        say(s + shift, L, 'set')
        say(s + shift + beat / 16, 0, 'set')
      }
      say(e.stutter[e.stutter.length - 1] + shift + beat / 8, L, 'set')
    }

    /* ── the end of the vowel: the coda, then a release unless the next syllable follows on ── */
    const coda = e.phones.coda
    const merged = legato && coda && next?.phones.onset?.kind === coda.kind && coda.kind !== 'hum'
    /* a coda needs the end of the note to itself: never inside a stutter, never before the vowel */
    const busy = voicing[voicing.length - 1].t
    if (coda && !merged && hold - 0.11 > busy) {
      const room = hold - vowelAt
      if (coda.kind === 'hiss' && room > 0.15) {
        say(hold - 0.1, L, 'set')
        say(hold - 0.06, coda.voiced ? 0.3 * L : 0)
        bursts.push({
          at: hold - 0.09,
          len: 0.09,
          hz: coda.hz * v.formant,
          q: coda.hz > 4500 ? 2.5 : 1.6,
          level: (coda.weak ? 0.1 : coda.breath ? 0.2 : 0.3) * 0.8,
          through: coda.breath ? 'vowel' : 'band',
        })
      } else if (coda.kind === 'click' && room > 0.1) {
        say(hold - 0.06, L, 'set')
        say(hold - 0.045, coda.voiced ? 0.12 : 0)
        bursts.push({
          at: hold - 0.025,
          len: 0.012,
          hz: coda.hz,
          q: 1.2,
          level: 0.3,
          through: 'band',
        })
      } else if (coda.kind === 'hum' && room > 0.15) {
        allTo(nasal, hold - 0.1, 'target', 0.02)
        say(hold - 0.11, L, 'set')
        say(hold - 0.07, 0.5 * L)
      } else if (coda.kind === 'glide' && room > 0.15) {
        allTo(shape(coda.from), hold - 0.09, 'target', 0.03)
      }
    }
    if (!legato) {
      const last = voicing[voicing.length - 1].t
      const fall = Math.max(last, hold - 0.04)
      say(fall, level, 'set')
      say(Math.max(fall + 0.01, hold), 0)
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
    .map((b) => (b.at < from ? { ...b, at: from, len: b.len - (from - b.at) } : b))
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
  const presence = add(c.createBiquadFilter())
  presence.type = 'peaking'
  presence.frequency.value = 3000
  presence.Q.value = 0.7
  presence.gain.value = v.bright
  fs[3].connect(presence)
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
    const sh = add(c.createWaveShaper())
    sh.curve = crushCurve(5)
    tail.connect(sh)
    tail = sh
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
      const rise = Math.min(0.008, b.len / 3)
      env.gain.setValueAtTime(0, b.at)
      env.gain.linearRampToValueAtTime(b.level, b.at + rise)
      env.gain.setValueAtTime(b.level, Math.max(b.at + rise, b.at + b.len - rise))
      env.gain.linearRampToValueAtTime(0, b.at + b.len)
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
  const v = PRESETS[opts.preset]
  const phrases = planPhrases(planLine(sung, start, opts), v, opts.beat, opts.seed ?? 1)
  const voices: { stop(): void }[] = []
  for (const ph of phrases) {
    if (ph.part === 'harmony') {
      voices.push(build(c, dest, ph, v, { pan: 0, gain: HARMONY, cents: 0, bursts: false }))
    } else if (opts.double) {
      const d = v.double
      voices.push(build(c, dest, ph, v, { pan: -d.pan, gain: 1, cents: 0, bursts: true }))
      voices.push(
        build(c, dest, doublePhrase(ph, d.ms / 1000, d.formant), v, {
          pan: d.pan,
          gain: DOUBLE,
          cents: d.cents,
          bursts: true,
        }),
      )
    } else voices.push(build(c, dest, ph, v, { pan: 0, gain: 1, cents: 0, bursts: true }))
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const x of voices) x.stop()
  }
}
