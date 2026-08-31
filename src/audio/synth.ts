import { registerTap } from './audioTap'
import { makeGain, releaseGain } from './mixer'
import { broadcastBus, resumeAudio, sharedCtx } from './context'
import { storedNumber } from '../ui/storedNumber'

/**
 * The instrument — a small synthesiser built out of oscillators.
 *
 * ⚠️ SYNTHESISED, NOT SAMPLED, and that is a decision about the future rather than about sound
 * quality. Samples would sound better immediately and would also be megabytes of audio to ship,
 * a licence to think about, and — the part that actually matters — useless for playing together.
 * A room where people play in time has to send NOTES, not audio: "C4 down at t=1234" is a few
 * bytes and arrives in one packet, where streaming the sound of that note is a continuous
 * bitstream that arrives late and out of order. Every client holding the same synth means every
 * client can render anybody's note the instant the event lands.
 *
 * The honest limit, stated up front: real-time musical timing over the internet is not achievable
 * — 30ms of network is already past what a drummer notices. This is built to be a shared studio
 * you can noodle in together, not a rehearsal room where you lock in.
 *
 * ⚠️ ONE CONTEXT, and voices are cleaned up when they finish. A synth that leaks a node per
 * keypress is fine for thirty seconds and then audibly falls apart, because every dead oscillator
 * is still summed into the mix.
 */

export type InstrumentId =
  | 'keys'
  | 'pluck'
  | 'bell'
  | 'pad'
  | 'bass'
  | 'organ'
  | 'brass'
  | 'reed'
  | 'marimba'
  | 'choir'
  | 'sub'
  | 'drums'

export const INSTRUMENTS: Array<[InstrumentId, string, string]> = [
  ['keys', '🎹', 'Keys'],
  ['pluck', '🪕', 'Pluck'],
  ['bell', '🔔', 'Bell'],
  ['pad', '🌊', 'Pad'],
  ['bass', '🎸', 'Bass'],
  ['organ', '🎼', 'Organ'],
  ['brass', '🎺', 'Brass'],
  ['reed', '🎷', 'Reed'],
  ['marimba', '🪘', 'Marimba'],
  ['choir', '🗣️', 'Choir'],
  ['sub', '🔊', 'Sub'],
  ['drums', '🥁', 'Drums'],
]

/** Attack, decay, sustain level, release — in seconds except sustain, which is a fraction. */
type Shape = {
  a: number
  d: number
  s: number
  r: number
  wave: OscillatorType
  /**
   * The oscillators stacked to make one note, as multiples of the fundamental.
   *
   * ⚠️ This is where the CHARACTER of an instrument actually lives — far more than the
   * waveform does. An organ is sines at 1, 2, 3 and 4; a bell is inharmonic (2.76 belongs to no
   * scale, which is exactly why it rings rather than sings); a choir is the same note detuned
   * against itself so the two drift in and out of phase. Same envelope, different stack, and you
   * would not guess they were the same synth.
   */
  partials: Array<{ ratio: number; detune: number; gain: number }>
  /** lowpass cutoff in Hz at note-on and where it travels to — up is a swell, down is a decay */
  filter?: { from: number; to: number; q: number }
  /** a pitch that falls (or rises) into place: multiplier at note-on, and how long it takes */
  pitch?: { mult: number; time: number }
  /** peak gain, so a bass patch does not drown a bell */
  level: number
}

const SHAPES: Record<Exclude<InstrumentId, 'drums'>, Shape> = {
  // struck and held: quick on, long tail, an octave of thickness underneath
  keys: {
    a: 0.004,
    d: 0.9,
    s: 0.25,
    r: 0.5,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 4, gain: 0.3 },
    ],
    filter: { from: 5200, to: 1400, q: 0.7 },
    level: 0.5,
  },
  // no sustain at all: the note IS the decay, which is what makes it read as plucked
  pluck: {
    a: 0.002,
    d: 0.45,
    s: 0,
    r: 0.14,
    wave: 'sawtooth',
    partials: [{ ratio: 1, detune: 0, gain: 1 }],
    filter: { from: 4200, to: 500, q: 3 },
    level: 0.42,
  },
  // 2.76 is deliberately not a musical interval — inharmonic partials are what make metal ring
  bell: {
    a: 0.002,
    d: 2.4,
    s: 0,
    r: 1.4,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2.76, detune: 0, gain: 0.45 },
      { ratio: 5.4, detune: 0, gain: 0.12 },
    ],
    level: 0.4,
  },
  // slow in, slow out, two detuned saws beating against each other
  pad: {
    a: 0.5,
    d: 1.2,
    s: 0.7,
    r: 1.1,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -11, gain: 1 },
      { ratio: 1, detune: 11, gain: 0.7 },
    ],
    filter: { from: 1600, to: 900, q: 1 },
    level: 0.3,
  },
  bass: {
    a: 0.006,
    d: 0.5,
    s: 0.5,
    r: 0.18,
    wave: 'square',
    partials: [{ ratio: 1, detune: 0, gain: 1 }],
    filter: { from: 900, to: 220, q: 4 },
    level: 0.5,
  },
  // additive drawbars: whole-number partials and no filter movement at all. An organ has no
  // decay — it is on or it is off, which is most of why it sounds like one.
  organ: {
    a: 0.012,
    d: 0.05,
    s: 1,
    r: 0.09,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.5 },
      { ratio: 3, detune: 0, gain: 0.32 },
      { ratio: 4, detune: 0, gain: 0.2 },
      { ratio: 8, detune: 0, gain: 0.1 },
    ],
    level: 0.3,
  },
  // the filter opens INTO the note rather than closing after it — that swell is the brass
  brass: {
    a: 0.07,
    d: 0.3,
    s: 0.75,
    r: 0.25,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 1, detune: 7, gain: 0.5 },
    ],
    filter: { from: 400, to: 3200, q: 2 },
    level: 0.34,
  },
  // odd harmonics only, which is the hollow woody sound of anything with a reed in it
  reed: {
    a: 0.03,
    d: 0.2,
    s: 0.8,
    r: 0.16,
    wave: 'square',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 3, detune: 0, gain: 0.22 },
      { ratio: 5, detune: 0, gain: 0.09 },
    ],
    filter: { from: 2200, to: 1500, q: 1 },
    level: 0.3,
  },
  // wooden bars: a hard transient and gone. Short decay does the work, not the waveform.
  marimba: {
    a: 0.001,
    d: 0.32,
    s: 0,
    r: 0.1,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 4, detune: 0, gain: 0.28 },
      { ratio: 9.2, detune: 0, gain: 0.06 },
    ],
    level: 0.5,
  },
  // three copies of one note, all slightly out of tune with each other, arriving slowly
  choir: {
    a: 0.35,
    d: 0.8,
    s: 0.65,
    r: 0.8,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -14, gain: 1 },
      { ratio: 1, detune: 0, gain: 0.8 },
      { ratio: 1, detune: 15, gain: 1 },
    ],
    filter: { from: 1100, to: 700, q: 3 },
    level: 0.24,
  },
  // an 808: the pitch falls into the note, which is what you feel rather than hear
  sub: {
    a: 0.004,
    d: 1.1,
    s: 0.3,
    r: 0.4,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.08 },
    ],
    pitch: { mult: 2.2, time: 0.09 },
    filter: { from: 700, to: 160, q: 1 },
    level: 0.62,
  },
}

/** A4 = 440 by definition; MIDI 69 is A4. */
export const freqOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

let ctx: AudioContext | null = null
let out: GainNode | null = null
let analyser: AnalyserNode | null = null
let noise: AudioBuffer | null = null

/**
 * The effects chain — ONE PER PART, not one for the instrument.
 *
 *     voices ─► bus.in ─┬─► dry ────────────┐
 *                       ├─► delay ─► wet ───┼─► fxOut ─► analyser / gain / broadcast bus
 *                       │      ↑______↓     │
 *                       │      feedback     │
 *                       └─► reverb ─► wet ──┘
 *
 * ⚠️ IT USED TO BE ONE SHARED CHAIN, AND THAT WAS A BUG YOU COULD HEAR. The knobs are live, so
 * a layer recorded with a long echo and a big room stopped having them the moment you turned the
 * echo down to record something dry over the top. Nothing about the take had changed — the
 * events are just notes — but every part in the stack was played through whatever the knobs
 * happened to say NOW. You could not build an arrangement, because the last thing you touched
 * rewrote everything underneath it.
 *
 * The same defect made a jam wrong in a subtler way: a peer's notes arrive as "C#4, bell", and
 * their bell was then played through YOUR reverb setting. Two people who had each dialled in a
 * sound heard two different rooms, and neither heard what the other had made.
 *
 * So effects belong to the PART — a looper layer, your live hands, one peer — rather than to the
 * instrument. Each part gets its own delay line and its own reverb, which is also what makes the
 * echoes behave: an echo is voices overlapping into each other, and a bassline's repeats should
 * feed the bassline's delay rather than being mixed into the lead's.
 *
 * ⚠️ Convolvers are the expensive node here, which is why buses are POOLED AND CAPPED rather
 * than made per note (a reverb tail allocated per keypress would take the tab down inside a
 * minute). They are keyed by part, reused for the life of that part, and the least recently used
 * is dropped once there are too many — but never while it might still be ringing, or you would
 * hear a tail cut off mid-decay for no reason the player could see.
 *
 * fxOut is still shared and is still where the fork happens, so the analyser sees every part's
 * full signal including its effects — the visualiser should show the reverb tail, since you can
 * hear it.
 */
export type Fx = { echo: number; echoTime: number; space: number; vibrato: number }

type Bus = {
  in: GainNode
  /** LFO depth for this part; voices connect it to their detune */
  vib: GainNode
  set(fx: Fx): void
  dispose(): void
  /** ctx time this bus last had a note, so eviction can leave ringing tails alone */
  used: number
}

let fxOut: GainNode | null = null
let verbBuf: AudioBuffer | null = null
const buses = new Map<string, Bus>()

/** The part your own hands play through. */
export const LIVE_PART = 'live'
/**
 * How many parts may have their own effects at once.
 *
 * Sized above any real arrangement — a dozen looper layers plus a full call already exceeds what
 * the voice mesh supports — so eviction is a backstop against a pathological case rather than
 * something a normal session reaches.
 */
const MAX_BUSES = 14
/** A bus idle for less than this may still be ringing, so it is never evicted. */
const RING_TAIL = 4

export type Knob = 'echo' | 'echoTime' | 'space' | 'vibrato'
const KNOB_KEY: Record<Knob, string> = {
  echo: 'synth_echo_v1',
  echoTime: 'synth_echo_time_v1',
  space: 'synth_space_v1',
  vibrato: 'synth_vibrato_v1',
}
/** Dry by default: an instrument that arrives drenched in reverb is a toy, not an instrument. */
const knobs: Record<Knob, number> = { echo: 0, echoTime: 0.26, space: 0.18, vibrato: 0 }
// ⚠️ the same zero trap the mixer hit — these ranges start at 0, so a missing key must mean
// "keep the default", not "the default is 0"
for (const k of Object.keys(knobs) as Knob[]) {
  const v = storedNumber(KNOB_KEY[k], 0, 1)
  if (v != null) knobs[k] = v
}

export function knob(k: Knob): number {
  return knobs[k]
}

/**
 * The knobs as a value, for storing on a take.
 *
 * ⚠️ A COPY, not the live object. The looper keeps this on the layer, and handing it the
 * mutable one would reintroduce the exact bug this change exists to fix — the layer's settings
 * would follow the sliders again, which is the opposite of sticking to the recording.
 */
export function fxSnapshot(): Fx {
  return { echo: knobs.echo, echoTime: knobs.echoTime, space: knobs.space, vibrato: knobs.vibrato }
}

export function setKnob(k: Knob, v: number) {
  knobs[k] = Math.max(0, Math.min(1, v))
  applyKnobs()
  try {
    localStorage.setItem(KNOB_KEY[k], String(knobs[k]))
  } catch {
    /* applies for this visit */
  }
}

/** A knob only ever moves YOUR live sound now; every other part keeps what it was given. */
function applyKnobs() {
  buses.get(LIVE_PART)?.set(fxSnapshot())
}

/**
 * Build one part's effects.
 *
 * The convolver shares a single impulse buffer with every other bus — an AudioBuffer is
 * immutable as far as the graph is concerned, so generating 2.2 seconds of stereo noise once and
 * pointing every reverb at it costs one buffer rather than fourteen.
 */
function makeBus(c: AudioContext): Bus {
  const input = c.createGain()
  const dry = c.createGain()
  const delay = c.createDelay(1.2)
  const wet = c.createGain()
  const fb = c.createGain()
  const verb = c.createConvolver()
  if (!verbBuf) verbBuf = impulse(c, 2.2)
  verb.buffer = verbBuf
  const verbWet = c.createGain()

  input.connect(dry).connect(fxOut!)
  input.connect(delay)
  delay.connect(wet).connect(fxOut!)
  delay.connect(fb).connect(delay)
  input.connect(verb).connect(verbWet).connect(fxOut!)

  // one LFO per part, so two parts can wobble independently
  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 5.2
  const vib = c.createGain()
  vib.gain.value = 0
  lfo.connect(vib)
  lfo.start()

  const ramp = (p: AudioParam, v: number) => {
    try {
      p.setTargetAtTime(v, c.currentTime, 0.02)
    } catch {
      p.value = v
    }
  }

  return {
    in: input,
    vib,
    used: c.currentTime,
    set(fx: Fx) {
      ramp(wet.gain, fx.echo * 0.55)
      // ⚠️ Feedback is capped well under 1. At 1 an echo never decays and the delay line
      // builds until it clips — a runaway howl that outlives the note that started it and has
      // no obvious cause.
      ramp(fb.gain, Math.min(0.6, fx.echo * 0.6))
      ramp(delay.delayTime, 0.06 + fx.echoTime * 0.7)
      ramp(verbWet.gain, fx.space * 0.9)
      // 0–70 cents: a whole semitone of wobble is a special effect, not vibrato
      ramp(vib.gain, fx.vibrato * 70)
      // dry backs off only slightly, so turning effects up thickens rather than swaps
      ramp(dry.gain, 1 - Math.min(0.35, fx.space * 0.35))
    },
    dispose() {
      try {
        lfo.stop()
      } catch {
        /* already stopped */
      }
      for (const n of [input, dry, delay, wet, fb, verb, verbWet, vib]) n.disconnect()
    },
  }
}

/**
 * The bus for a part, created on first use.
 *
 * ⚠️ `fx` is applied on every call, not only on creation. A looper layer's settings are fixed,
 * but a peer can turn their reverb up mid-jam and the live part changes whenever you touch a
 * slider — so the cheap thing is to keep writing the values, which setTargetAtTime already makes
 * a no-op when they have not moved.
 */
function busFor(c: AudioContext, part: string, fx: Fx): Bus {
  let b = buses.get(part)
  if (!b) {
    if (buses.size >= MAX_BUSES) evictBus(c)
    b = makeBus(c)
    buses.set(part, b)
  }
  b.used = c.currentTime
  b.set(fx)
  return b
}

/** Drop the least recently used bus, but never one whose tail could still be sounding. */
function evictBus(c: AudioContext) {
  let victim: string | null = null
  let oldest = Infinity
  for (const [k, b] of buses) {
    if (k === LIVE_PART) continue
    if (c.currentTime - b.used < RING_TAIL) continue
    if (b.used < oldest) {
      oldest = b.used
      victim = k
    }
  }
  if (!victim) return
  buses.get(victim)!.dispose()
  buses.delete(victim)
}

/**
 * A reverb impulse: noise that decays.
 *
 * Generated rather than downloaded — a real impulse response is a wav file to host, and for a
 * room this size the difference is inaudible. Two channels of decaying noise IS the mathematical
 * shape of a room's response; the fancy ones just have a real room's colour on top.
 */
function impulse(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      // ^2.5 rather than a straight line: rooms lose their high end fast and their tail slowly
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5)
    }
  }
  return buf
}

type Voice = { stop(at: number): void; ends: number }
const voices = new Map<string, Voice>()

/** More than this many at once and the oldest is cut — see the note in noteOn. */
const MAX_VOICES = 16

function ensure(): AudioContext {
  if (ctx) return ctx
  ctx = sharedCtx()
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.78

  fxOut = ctx.createGain()

  out = makeGain(ctx, 'instrument')
  // the fork: full signal to the analyser and the room, attenuated signal to your speakers
  fxOut.connect(analyser)
  fxOut.connect(out)
  out.connect(ctx.destination)
  try {
    fxOut.connect(broadcastBus())
  } catch {
    /* no bus on this device — you still hear yourself */
  }
  // your own hands get their bus up front, so the very first keypress is not also a graph build
  busFor(ctx, LIVE_PART, fxSnapshot())
  registerTap('instrument', analyser)
  return ctx
}

/**
 * Every voice goes into its part's effects chain, and the chain decides the rest.
 *
 * Short because ensure() wires fxOut to the analyser, the output gain and the broadcast bus
 * once, rather than every note doing it three times. The fork lives there — see the diagram
 * above Fx.
 */
function connectVoice(node: AudioNode, bus: Bus | null) {
  if (bus) node.connect(bus.in)
  else if (out) node.connect(out)
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise
  const n = Math.floor(c.sampleRate * 0.5)
  const b = c.createBuffer(1, n, c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  noise = b
  return b
}

/**
 * Drums: three sounds keyed off the note, rather than one pitched instrument.
 *
 * A kick is a sine whose pitch falls off a cliff; a snare is noise plus a short tone; a hat is
 * noise through a highpass. All three are one-shots — there is no note-off, because you cannot
 * hold a drum.
 */
function hitDrum(c: AudioContext, midi: number, at: number, bus: Bus | null) {
  const kind = midi % 3
  const g = c.createGain()
  connectVoice(g, bus)
  if (kind === 0) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150, at)
    o.frequency.exponentialRampToValueAtTime(45, at + 0.12)
    g.gain.setValueAtTime(0.9, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35)
    o.connect(g)
    o.start(at)
    o.stop(at + 0.4)
  } else {
    const src = c.createBufferSource()
    src.buffer = noiseBuffer(c)
    const f = c.createBiquadFilter()
    const hat = kind === 2
    f.type = hat ? 'highpass' : 'bandpass'
    f.frequency.value = hat ? 7000 : 1900
    const dur = hat ? 0.07 : 0.19
    g.gain.setValueAtTime(hat ? 0.35 : 0.6, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(f).connect(g)
    src.start(at)
    src.stop(at + dur + 0.02)
  }
}

/**
 * Start a note. `id` identifies it for the matching noteOff — a key, or a peer's key.
 *
 * ⚠️ `when` is an AudioContext timestamp, not a wall clock. Scheduling with setTimeout would put
 * every note a browser-timer's-worth of jitter away from where it belongs, which is audible as
 * sloppiness on anything rhythmic. This is also the hook multiplayer needs: a peer's note arrives
 * with a timestamp and gets scheduled a few milliseconds out rather than fired on arrival.
 *
 * `part` names whose sound this is — your live hands, a looper layer, one peer in a jam — and
 * carries the effects that belong to it. Omitting it means the live part with the current knobs,
 * which is what every existing caller wanted and still gets.
 */
export function noteOn(
  id: string,
  instrument: InstrumentId,
  midi: number,
  when?: number,
  part?: { key: string; fx: Fx },
) {
  const c = ensure()
  resumeAudio()
  const at = Math.max(when ?? c.currentTime, c.currentTime)
  const bus = busFor(c, part?.key ?? LIVE_PART, part?.fx ?? fxSnapshot())

  if (instrument === 'drums') {
    hitDrum(c, midi, at, bus)
    return
  }
  // already sounding: retrigger rather than stack a second voice on the same key
  voices.get(id)?.stop(at)
  voices.delete(id)

  // ⚠️ Voice stealing. Without a cap, a stuck key or a fast peer can pile up oscillators until
  // the mix clips and the tab heats up. Oldest goes first, which is the least surprising.
  if (voices.size >= MAX_VOICES) {
    const oldest = voices.keys().next().value
    if (oldest !== undefined) {
      voices.get(oldest)?.stop(at)
      voices.delete(oldest)
    }
  }

  const sh = SHAPES[instrument]
  const freq = freqOf(midi)
  const g = c.createGain()
  let sink: AudioNode = g
  if (sh.filter) {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = sh.filter.q
    f.frequency.setValueAtTime(sh.filter.from, at)
    f.frequency.exponentialRampToValueAtTime(Math.max(80, sh.filter.to), at + sh.d)
    g.connect(f)
    sink = f
  }
  connectVoice(sink, bus)

  const oscs: OscillatorNode[] = []
  for (const part of sh.partials) {
    const o = c.createOscillator()
    o.type = sh.wave
    o.detune.value = part.detune
    const f0 = freq * part.ratio
    if (sh.pitch) {
      // a pitch that falls into place. Exponential because pitch is perceived logarithmically —
      // a linear slide sounds like it lands early and then crawls.
      o.frequency.setValueAtTime(f0 * sh.pitch.mult, at)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f0), at + sh.pitch.time)
    } else {
      o.frequency.value = f0
    }
    // ⚠️ Vibrato drives DETUNE, not frequency. detune is in cents, so one LFO depth gives the
    // same musical wobble at every pitch; driving frequency in Hz would be a shiver down low and
    // a siren up high.
    bus.vib.connect(o.detune)
    if (part.gain === 1) {
      o.connect(g)
    } else {
      const sub = c.createGain()
      sub.gain.value = part.gain
      o.connect(sub).connect(g)
    }
    o.start(at)
    oscs.push(o)
  }

  /**
   * ⚠️ setValueAtTime(0) then a LINEAR ramp up, then exponential down to a tiny non-zero floor.
   *
   * exponentialRampToValueAtTime cannot start from or reach zero — it silently does nothing from
   * 0, which is a note that never sounds, and throws on a target of 0. Linear up and exponential
   * down to 0.0001 is the shape that both works and sounds natural, since hearing is logarithmic.
   */
  const peak = sh.level
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(peak, at + sh.a)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sh.s || 0.0001), at + sh.a + sh.d)

  const ends = sh.s > 0 ? Infinity : at + sh.a + sh.d + sh.r
  const voice: Voice = {
    ends,
    stop(t: number) {
      const from = Math.max(t, c.currentTime)
      try {
        g.gain.cancelScheduledValues(from)
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), from)
        g.gain.exponentialRampToValueAtTime(0.0001, from + sh.r)
      } catch {
        /* context went away */
      }
      for (const o of oscs) {
        try {
          o.stop(from + sh.r + 0.02)
        } catch {
          /* already stopped */
        }
      }
    },
  }
  voices.set(id, voice)

  // a patch with no sustain releases itself, so a click-and-hold on a pluck still ends
  if (sh.s <= 0) {
    const life = (sh.a + sh.d + sh.r + 0.1) * 1000
    window.setTimeout(() => {
      if (voices.get(id) === voice) voices.delete(id)
    }, life)
    for (const o of oscs) {
      try {
        o.stop(at + sh.a + sh.d + sh.r)
      } catch {
        /* fine */
      }
    }
  }
}

export function noteOff(id: string, when?: number) {
  const c = ctx
  if (!c) return
  const v = voices.get(id)
  if (!v) return
  v.stop(Math.max(when ?? c.currentTime, c.currentTime))
  voices.delete(id)
}

/** Panic — everything off. Worth having the moment a stuck note happens, which it will. */
export function allNotesOff() {
  const c = ctx
  if (!c) return
  for (const [, v] of voices) v.stop(c.currentTime)
  voices.clear()
}

export function synthReady(): boolean {
  return ctx != null
}

/**
 * Let go of the synth's nodes.
 *
 * ⚠️ DISCONNECTS, never closes. The context is shared with the call, the music player and the
 * ringtone now — closing it here would silence all of them, and the symptom (leaving the
 * instrument page kills the call you are in) would be a genuinely bewildering thing to track
 * down. See context.ts.
 */
export function closeSynth() {
  allNotesOff()
  registerTap('instrument', null)
  releaseGain('instrument')
  try {
    for (const b of buses.values()) b.dispose()
    out?.disconnect()
    analyser?.disconnect()
    fxOut?.disconnect()
  } catch {
    /* already gone */
  }
  buses.clear()
  out = null
  analyser = null
  noise = null
  // ⚠️ the impulse goes too. It belongs to the AudioContext that made it, and a buffer from a
  // closed context assigned to a new convolver is a silent reverb rather than an error.
  verbBuf = null
  fxOut = null
  ctx = null
}
