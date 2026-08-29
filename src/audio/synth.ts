import { registerTap } from './audioTap'
import { makeGain, releaseGain } from './mixer'
import { broadcastBus, resumeAudio, sharedCtx } from './context'

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

export type InstrumentId = 'keys' | 'pluck' | 'bell' | 'pad' | 'bass' | 'drums'

export const INSTRUMENTS: Array<[InstrumentId, string, string]> = [
  ['keys', '🎹', 'Keys'],
  ['pluck', '🪕', 'Pluck'],
  ['bell', '🔔', 'Bell'],
  ['pad', '🌊', 'Pad'],
  ['bass', '🎸', 'Bass'],
  ['drums', '🥁', 'Drums'],
]

/** Attack, decay, sustain level, release — in seconds except sustain, which is a fraction. */
type Shape = {
  a: number
  d: number
  s: number
  r: number
  /** oscillator flavour; 'noise' is a buffer of random samples rather than a periodic wave */
  wave: OscillatorType | 'noise'
  /** a second oscillator a fixed interval away, for thickness. Ratio of 1 means detune only. */
  second?: { ratio: number; detune: number; gain: number }
  /** lowpass cutoff in Hz at note-on, and where it falls to */
  filter?: { from: number; to: number; q: number }
  /** peak gain, so a bass patch does not drown a bell */
  level: number
}

const SHAPES: Record<Exclude<InstrumentId, 'drums'>, Shape> = {
  // struck and held: quick on, long tail, a fifth of thickness underneath
  keys: {
    a: 0.004,
    d: 0.9,
    s: 0.25,
    r: 0.5,
    wave: 'triangle',
    second: { ratio: 2, detune: 4, gain: 0.3 },
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
    filter: { from: 4200, to: 500, q: 3 },
    level: 0.42,
  },
  // an octave-and-a-bit above the fundamental gives the shimmer a bell has; long release
  bell: {
    a: 0.002,
    d: 2.4,
    s: 0,
    r: 1.4,
    wave: 'sine',
    second: { ratio: 2.76, detune: 0, gain: 0.45 },
    level: 0.4,
  },
  // slow in, slow out, two detuned saws beating against each other
  pad: {
    a: 0.5,
    d: 1.2,
    s: 0.7,
    r: 1.1,
    wave: 'sawtooth',
    second: { ratio: 1, detune: 11, gain: 0.7 },
    filter: { from: 1600, to: 900, q: 1 },
    level: 0.3,
  },
  bass: {
    a: 0.006,
    d: 0.5,
    s: 0.5,
    r: 0.18,
    wave: 'square',
    filter: { from: 900, to: 220, q: 4 },
    level: 0.5,
  },
}

/** A4 = 440 by definition; MIDI 69 is A4. */
export const freqOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

let ctx: AudioContext | null = null
let out: GainNode | null = null
let analyser: AnalyserNode | null = null
let noise: AudioBuffer | null = null

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
  out = makeGain(ctx, 'instrument')
  out.connect(ctx.destination)
  registerTap('instrument', analyser)
  return ctx
}

/**
 * Where every voice goes — three places, for three different reasons.
 *
 * ⚠️ The same fork the music player uses: voices reach the analyser at full strength AND the
 * output gain separately, so turning the instrument down does not shrink the visualiser. See
 * mixer.ts — getting this backwards is invisible until somebody drags a slider.
 *
 * ⚠️ And the broadcast bus, so anyone in a call with you hears you play. Connected here
 * always rather than only during a call: the bus goes nowhere when nobody is listening, and
 * wiring it up at call time would mean a note already sounding never joins the room. Whether the
 * bus actually reaches anyone is the call's business, not the synth's.
 */
function connectVoice(node: AudioNode) {
  if (analyser) node.connect(analyser)
  if (out) node.connect(out)
  try {
    node.connect(broadcastBus())
  } catch {
    /* no bus on this device — you still hear yourself */
  }
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
function hitDrum(c: AudioContext, midi: number, at: number) {
  const kind = midi % 3
  const g = c.createGain()
  connectVoice(g)
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
 */
export function noteOn(id: string, instrument: InstrumentId, midi: number, when?: number) {
  const c = ensure()
  resumeAudio()
  const at = Math.max(when ?? c.currentTime, c.currentTime)

  if (instrument === 'drums') {
    hitDrum(c, midi, at)
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
  connectVoice(sink)

  const oscs: OscillatorNode[] = []
  const add = (f0: number, detune: number, gain: number) => {
    const o = c.createOscillator()
    o.type = sh.wave as OscillatorType
    o.frequency.value = f0
    o.detune.value = detune
    if (gain === 1) {
      o.connect(g)
    } else {
      const sub = c.createGain()
      sub.gain.value = gain
      o.connect(sub).connect(g)
    }
    o.start(at)
    oscs.push(o)
  }
  add(freq, 0, 1)
  if (sh.second) add(freq * sh.second.ratio, sh.second.detune, sh.second.gain)

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
    out?.disconnect()
    analyser?.disconnect()
  } catch {
    /* already gone */
  }
  out = null
  analyser = null
  noise = null
  ctx = null
}
