import { sharedCtx } from './context'
import {
  VOWELS,
  phonesOf,
  type Consonant,
  type Phones,
  type SungNote,
  type VowelId,
} from './lyrics'
import { freqOf, partInput, type Fx } from './synth'

/**
 * A robotic singing voice, made in the browser from a buzz and three resonances.
 *
 * ⚠️ PHASE 0 OF docs/2026-11-10-sung-lyrics-plan.md — a prototype to be HEARD, nothing saved. It
 * sings a line of syllables (lyrics.ts decides what) through a part bus like any instrument.
 *
 * ⚠️ HOW A VOWEL IS MADE. A sawtooth is a buzz with every harmonic in it, which is roughly what
 * vocal folds produce; the throat and mouth then pick out a few bands of it, and those bands — the
 * formants — are what makes "ee" not "ah". Three band-pass filters set to a vowel's measured
 * formants (VOWELS) do the same job. Consonants are short noises in front of the vowel: a hiss is
 * filtered noise, a click is a few milliseconds of it, a hum is the vowel through nasal formants,
 * and a glide starts on one vowel and slides to the next.
 *
 * ⚠️ NO NEW DEPENDENCY AND NO WORKLET. Everything here is ordinary Web Audio nodes, which is why
 * it runs on a phone, offline, and the same on every machine — the reasons the plan gives for
 * choosing it.
 */

export type VoiceId = 'airy' | 'bright'

/** the two voices: one machine, set differently */
export const VOICES: Record<
  VoiceId,
  { name: string; formant: number; breath: number; bright: number; vibrato: number }
> = {
  /* breathier and softer on top — the whispered half of a glitchpop duet */
  airy: { name: 'Airy', formant: 1, breath: 0.35, bright: 0.6, vibrato: 18 },
  /* formants a little higher and the upper ones louder — the front, cutting voice */
  bright: { name: 'Bright', formant: 1.07, breath: 0.08, bright: 1, vibrato: 9 },
}

export type Glitch = {
  /** a syllable at the top of a bar trips over its own start: g-g-glitter */
  stutter: boolean
  /** a stepped wave shaper — the sound of too few bits */
  crush: boolean
  /** the voice gated on and off every sixteenth note */
  chop: boolean
  /** formants scaled without moving the note: below 1 is a robot, above 1 a chipmunk */
  formant: number
}

export type SingOpts = {
  lead: VoiceId
  /** the harmony note for a melody note, or null for no harmony */
  harmony: ((midi: number) => number) | null
  glitch: Glitch
  /** seconds per beat, for the glitch grid */
  beat: number
}

/** one voice singing one syllable — and the held notes after it */
export type Event = {
  voice: VoiceId
  phones: Phones
  /** when the consonant starts — BEFORE the beat, so the vowel lands on it */
  from: number
  /** when the vowel starts: the note's own time */
  vowelAt: number
  end: number
  /** the pitch at each note this syllable spans: the syllable's own, then each hold */
  pitches: { at: number; midi: number }[]
  /** extra retriggers of the syllable's start, for the stutter */
  stutter: number[]
}

/** how long a consonant takes before its vowel, in seconds */
export function consonantLength(c: Consonant | null): number {
  if (!c) return 0
  return c.kind === 'hiss' ? 0.08 : c.kind === 'click' ? 0.025 : 0.05
}

/**
 * A line of sung notes into the events that will play it — pure, so the timing can be asked.
 *
 * ⚠️ THE VOWEL IS ON THE BEAT, THE CONSONANT BEFORE IT, which is how singers place words: "sky"
 * starts its hiss early so the "ai" lands where the note is. Clamped to `start`, so the first word
 * of a line does not reach back before the line begins.
 *
 * ⚠️ A HOLD IS NOT A NEW EVENT: it extends the syllable before it to its own end and adds its pitch,
 * so the vowel carries straight across with no consonant and no gap — the "hold one across notes"
 * in the plan.
 */
export function planLine(sung: readonly SungNote[], start: number, opts: SingOpts): Event[] {
  const out: Event[] = []
  const bar = opts.beat * 4
  const voices: { voice: VoiceId; pitch: (m: number) => number }[] = [
    { voice: opts.lead, pitch: (m) => m },
  ]
  if (opts.harmony)
    voices.push({ voice: opts.lead === 'airy' ? 'bright' : 'airy', pitch: opts.harmony })
  for (const v of voices) {
    let cur: Event | null = null
    for (const n of sung) {
      const at = start + n.t
      if (n.hold && cur) {
        cur.end = at + n.dur
        cur.pitches.push({ at, midi: v.pitch(n.midi) })
        continue
      }
      const phones = phonesOf(n.text)
      const onBar = Math.abs(n.t / bar - Math.round(n.t / bar)) < 1e-3
      cur = {
        voice: v.voice,
        phones,
        from: Math.max(start, at - consonantLength(phones.onset)),
        vowelAt: at,
        end: at + n.dur,
        pitches: [{ at, midi: v.pitch(n.midi) }],
        stutter: opts.glitch.stutter && onBar ? [0, 1, 2].map((k) => at + (k * opts.beat) / 8) : [],
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

const DRY: Fx = { echo: 0, echoTime: 0.26, space: 0.25, vibrato: 0, glide: 0, tone: 0.5 }
/**
 * The formant bank's make-up gain: three narrow bands keep only a sliver of the buzz.
 *
 * ⚠️ MEASURED, NOT GUESSED: at 3.2 a held "ah" at C5 read 0.41 on the instrument tap against 0.24
 * for Keys on the same note — the voice nearly twice as loud as the instrument it sings over. At
 * 2 it sits beside Keys; the layer's own fader and the room's volume do the rest.
 */
const BANK = 2

let noise: AudioBuffer | null = null
function noiseFor(c: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  noise = b
  return b
}

const formantsOf = (v: VowelId, scale: number) => VOWELS[v].map((f) => f * scale)
const NASAL = [250, 1000, 2600]

/**
 * Sing a line now. Returns a stop that silences it at once.
 *
 * Every node an event makes is disconnected when it ends, the rule synth.ts keeps for its voices:
 * a line of sixteen syllables in two voices is a few hundred nodes, and leaving them hanging off
 * the bus is the slow leak that turns into dropouts on a phone.
 */
export function singLine(sung: readonly SungNote[], start: number, opts: SingOpts): () => void {
  const c = sharedCtx()
  const dest = partInput('sing', DRY, 0.9)
  const made: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []
  let out: AudioNode = dest
  if (opts.glitch.crush) {
    const sh = c.createWaveShaper()
    /* five levels a side: at twelve the crush measured as almost nothing above 6kHz — 0.0001 to
       0.0002 — which is a glitch nobody would hear */
    sh.curve = crushCurve(5)
    sh.connect(dest)
    made.push(sh)
    out = sh
  }
  for (const ev of planLine(sung, start, opts)) eventNodes(c, out, ev, opts, made, sources)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const now = c.currentTime
    for (const s of sources)
      try {
        s.stop(now)
      } catch {
        /* never started, or already stopped */
      }
    for (const n of made) n.disconnect()
  }
}

function eventNodes(
  c: AudioContext,
  out: AudioNode,
  ev: Event,
  opts: SingOpts,
  made: AudioNode[],
  sources: AudioScheduledSourceNode[],
) {
  const v = VOICES[ev.voice]
  const scale = v.formant * opts.glitch.formant
  const own: AudioNode[] = []
  const keep = <T extends AudioNode>(n: T): T => {
    own.push(n)
    made.push(n)
    return n
  }

  /* the envelope, then the chop gate, then out */
  const env = keep(c.createGain())
  env.gain.value = 0
  const gate = keep(c.createGain())
  env.connect(gate)
  gate.connect(out)

  /* three formant bands, summed into the envelope */
  const bank = keep(c.createGain())
  bank.gain.value = BANK
  bank.connect(env)
  const bands = [0, 1, 2].map((k) => {
    const f = keep(c.createBiquadFilter())
    f.type = 'bandpass'
    f.Q.value = [5, 8, 10][k]
    const g = keep(c.createGain())
    g.gain.value = [1, 0.6 * v.bright, 0.35 * v.bright][k]
    f.connect(g)
    g.connect(bank)
    return f
  })
  const setFormants = (fs: readonly number[], at: number, glide = 0) =>
    bands.forEach((b, k) => {
      if (glide > 0) b.frequency.setTargetAtTime(fs[k], at, glide)
      else b.frequency.setValueAtTime(fs[k], at)
    })

  /* the buzz: one pitch per note it spans, snapped — hard-tuned — with a late vibrato */
  const osc = c.createOscillator()
  osc.type = 'sawtooth'
  for (const p of ev.pitches) osc.frequency.setValueAtTime(freqOf(p.midi), Math.max(ev.from, p.at))
  osc.frequency.setValueAtTime(freqOf(ev.pitches[0].midi), ev.from)
  bands.forEach((b) => osc.connect(b))
  const lfo = c.createOscillator()
  lfo.frequency.value = 5.5
  /* vibrato comes in after the note settles, as a singer's does — a straight start, then the wobble */
  const depth = keep(c.createGain())
  depth.gain.setValueAtTime(0, ev.from)
  depth.gain.linearRampToValueAtTime(v.vibrato, ev.vowelAt + 0.25)
  lfo.connect(depth)
  depth.connect(osc.detune)

  /* breath: noise shaped by the same formants, so it whispers the vowel */
  const breath = c.createBufferSource()
  breath.buffer = noiseFor(c)
  breath.loop = true
  const hp = keep(c.createBiquadFilter())
  hp.type = 'highpass'
  hp.frequency.value = 1200
  const bg = keep(c.createGain())
  bg.gain.value = v.breath
  breath.connect(hp)
  hp.connect(bg)
  bands.forEach((b) => bg.connect(b))

  /* the vowel, gliding to the second half of a diphthong */
  const vowel = formantsOf(ev.phones.vowel, scale)
  const on = ev.phones.onset
  if (on?.kind === 'glide') {
    setFormants(formantsOf(on.from, scale), ev.from)
    setFormants(vowel, ev.from, 0.02)
  } else if (on?.kind === 'hum') {
    setFormants(
      NASAL.map((f) => f * scale),
      ev.from,
    )
    setFormants(vowel, ev.vowelAt, 0.015)
  } else setFormants(vowel, ev.from)
  if (ev.phones.to)
    setFormants(formantsOf(ev.phones.to, scale), ev.vowelAt + (ev.end - ev.vowelAt) * 0.4, 0.06)

  /* the envelope: glides and hums sound from the consonant on; everything else from the vowel */
  const voicedEarly = on?.kind === 'glide' || on?.kind === 'hum'
  const open = voicedEarly ? ev.from : ev.vowelAt
  env.gain.setValueAtTime(0, Math.max(0, open - 0.001))
  env.gain.linearRampToValueAtTime(voicedEarly ? 0.6 : 1, open + 0.02)
  if (voicedEarly) env.gain.linearRampToValueAtTime(1, ev.vowelAt + 0.02)
  const release = Math.max(ev.vowelAt + 0.03, ev.end - 0.05)
  env.gain.setValueAtTime(1, release)
  env.gain.linearRampToValueAtTime(0, ev.end)

  /* the stutter: the start of the syllable cut on and off three times on 32nds before it holds */
  if (ev.stutter.length) {
    const sliver = opts.beat / 16
    for (const t of ev.stutter) {
      env.gain.setValueAtTime(1, t)
      env.gain.setValueAtTime(0, t + sliver)
    }
    env.gain.setValueAtTime(1, ev.stutter[ev.stutter.length - 1] + opts.beat / 8)
  }

  /* the chop: the whole voice gated on sixteenths */
  if (opts.glitch.chop) {
    gate.gain.setValueAtTime(0, ev.from)
    for (const [a, b] of chopGates(ev.from, ev.end, opts.beat)) {
      gate.gain.setValueAtTime(1, a)
      gate.gain.setValueAtTime(0, b)
    }
  }

  /* consonants that are noise: before the vowel, and a closing one at the end */
  const noiseBurst = (cons: Consonant, at: number, len: number) => {
    if (cons.kind !== 'hiss' && cons.kind !== 'click') return
    const src = c.createBufferSource()
    src.buffer = noiseFor(c)
    const bp = keep(c.createBiquadFilter())
    bp.type = 'bandpass'
    bp.frequency.value = cons.hz
    bp.Q.value = cons.kind === 'hiss' ? 1.4 : 2.5
    const g = keep(c.createGain())
    g.gain.value = 0
    const peak = cons.kind === 'hiss' ? 0.5 : 0.8
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(peak, at + Math.min(0.02, len / 3))
    g.gain.linearRampToValueAtTime(0, at + len)
    src.connect(bp)
    bp.connect(g)
    g.connect(gate)
    src.start(at)
    src.stop(at + len + 0.01)
    sources.push(src)
  }
  if (on) noiseBurst(on, ev.from, Math.max(0.015, ev.vowelAt - ev.from))
  const coda = ev.phones.coda
  if (coda?.kind === 'hum')
    setFormants(
      NASAL.map((f) => f * scale),
      ev.end - (ev.end - ev.vowelAt) * 0.25,
      0.02,
    )
  else if (coda) noiseBurst(coda, Math.max(ev.vowelAt, ev.end - 0.06), 0.05)

  const stopAt = ev.end + 0.05
  for (const s of [osc, lfo, breath]) {
    s.start(ev.from)
    s.stop(stopAt)
    sources.push(s)
  }
  osc.onended = () => {
    for (const n of own) n.disconnect()
    osc.disconnect()
    lfo.disconnect()
    breath.disconnect()
  }
}
