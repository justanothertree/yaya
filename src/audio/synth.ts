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
  | 'harp'
  | 'glass'
  | 'strings'
  | 'kalimba'
  | 'flute'
  | 'clav'
  | 'lead'
  | 'box'
  | 'steelpan'
  | 'vibes'
  | 'koto'
  | 'drone'
  | 'banjo'
  | 'cello'
  | 'whistle'
  | 'fifths'
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
  ['harp', '🎶', 'Harp'],
  ['glass', '💎', 'Glass'],
  ['strings', '🎻', 'Strings'],
  ['kalimba', '🪵', 'Kalimba'],
  ['flute', '🌬', 'Flute'],
  ['clav', '🪶', 'Clav'],
  ['lead', '⚡', 'Lead'],
  ['box', '🎁', 'Music box'],
  ['steelpan', '🛢', 'Steel pan'],
  ['vibes', '🎐', 'Vibes'],
  ['koto', '🏯', 'Koto'],
  ['drone', '🕉', 'Drone'],
  ['banjo', '🤠', 'Banjo'],
  ['cello', '🎗', 'Cello'],
  ['whistle', '😗', 'Whistle'],
  ['fifths', '🗼', 'Fifths'],
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
  /**
   * Plucked like the Pluck, but ringing on instead of stopping — the difference is the RELEASE,
   * not the attack. A harp string is not damped when you let go, so a chord you played a second
   * ago is still there under the one you are playing now.
   */
  harp: {
    a: 0.002,
    d: 1.6,
    s: 0,
    r: 1.2,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.34 },
      { ratio: 3, detune: 0, gain: 0.16 },
      { ratio: 5, detune: 0, gain: 0.05 },
    ],
    filter: { from: 5200, to: 900, q: 0.8 },
    level: 0.42,
  },
  /**
   * Where the Bell is inharmonic and metallic, this is nearly pure: a fundamental with two quiet
   * octaves above it and a very slow decay. Almost no attack transient, so it arrives rather than
   * strikes — the closest thing here to a wine glass under a wet finger.
   */
  glass: {
    a: 0.02,
    d: 3.2,
    s: 0,
    r: 2.2,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 3, gain: 0.22 },
      { ratio: 4, detune: -4, gain: 0.09 },
      { ratio: 6.1, detune: 0, gain: 0.03 },
    ],
    filter: { from: 6000, to: 2400, q: 0.6 },
    level: 0.34,
  },
  /**
   * Bowed rather than blown or struck: a slow swell, a full sustain, and a sawtooth stack tuned
   * against itself so the section never quite agrees with its own pitch. Slower to arrive than
   * the Pad and much brighter, which is what stops the two being the same patch twice.
   */
  strings: {
    a: 0.22,
    d: 0.6,
    s: 0.8,
    r: 0.55,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -8, gain: 1 },
      { ratio: 1, detune: 7, gain: 0.9 },
      { ratio: 2, detune: 0, gain: 0.3 },
      { ratio: 3, detune: 4, gain: 0.12 },
    ],
    filter: { from: 2600, to: 1300, q: 1.4 },
    level: 0.26,
  },
  /**
   * A thumb piano: a short woody body like the Marimba, but with a metal tine on top — the tenth
   * partial is what gives it the little bloom the wooden bars do not have.
   */
  kalimba: {
    a: 0.001,
    d: 0.7,
    s: 0,
    r: 0.28,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 3, detune: 0, gain: 0.2 },
      { ratio: 10.4, detune: 0, gain: 0.07 },
    ],
    filter: { from: 4200, to: 1100, q: 1.2 },
    level: 0.46,
  },
  /**
   * Air rather than string or metal: almost nothing but the fundamental, and a second partial
   * quiet enough to be breath instead of a harmonic. The attack is the slowest of any non-pad
   * voice here, because a flute has to be blown before it speaks.
   */
  flute: {
    a: 0.06,
    d: 0.35,
    s: 0.7,
    r: 0.22,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 6, gain: 0.12 },
      { ratio: 3, detune: -5, gain: 0.04 },
    ],
    filter: { from: 3000, to: 2100, q: 0.7 },
    level: 0.34,
  },
  /**
   * A clavinet: plucked and gone in a moment, but bright the whole way. Where Pluck rounds off,
   * this keeps its odd harmonics, which is what makes it cut through a mix instead of sitting in
   * it — the shortest sustained voice here and the most percussive of the strings.
   */
  clav: {
    a: 0.001,
    d: 0.22,
    s: 0.12,
    r: 0.1,
    wave: 'square',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 3, detune: 0, gain: 0.3 },
      { ratio: 5, detune: 0, gain: 0.14 },
    ],
    filter: { from: 4800, to: 1600, q: 4 },
    level: 0.3,
  },
  /**
   * The synth voice the set was missing: a detuned saw pair under a filter that opens on the
   * attack and closes again. Everything else here imitates an instrument that exists; this one
   * only sounds like a synthesiser, which is why it is worth having.
   */
  lead: {
    a: 0.006,
    d: 0.5,
    s: 0.55,
    r: 0.2,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -9, gain: 1 },
      { ratio: 1, detune: 10, gain: 0.9 },
      { ratio: 2, detune: 0, gain: 0.22 },
    ],
    filter: { from: 4200, to: 900, q: 6 },
    level: 0.24,
  },
  /**
   * A music box: the Bell's inharmonic ring with the decay cut right down, so it chimes and stops
   * rather than hanging. The high partials are what make it sound small — a large bell keeps its
   * fundamental longest, a little tine does not.
   */
  box: {
    a: 0.001,
    d: 0.9,
    s: 0,
    r: 0.5,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 0.7 },
      { ratio: 2.76, detune: 0, gain: 1 },
      { ratio: 5.4, detune: 0, gain: 0.4 },
      { ratio: 8.9, detune: 0, gain: 0.12 },
    ],
    filter: { from: 6500, to: 2600, q: 1 },
    level: 0.3,
  },
  /**
   * A steel pan: inharmonic like the Bell, but WARM and short with it. The 2.4 and 3.7 partials
   * are close enough to a scale to sound tuned and far enough off it to sound hammered — which is
   * exactly what an oil drum with dents in it is.
   */
  steelpan: {
    a: 0.002,
    d: 0.55,
    s: 0.08,
    r: 0.35,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2.4, detune: 4, gain: 0.42 },
      { ratio: 3.7, detune: -6, gain: 0.2 },
      { ratio: 6.1, detune: 0, gain: 0.06 },
    ],
    filter: { from: 3800, to: 1200, q: 1.6 },
    level: 0.38,
  },
  /**
   * A vibraphone: Marimba's struck bars in metal, with the tremolo that gives it its name.
   *
   * ⚠️ The wobble is TWO COPIES a few cents apart, not a modulator — there is no LFO on the
   * amplitude anywhere in this synth, and two detuned partials beating against each other produce
   * the same slow pulse for nothing. Same trick the Choir uses, at a different depth.
   */
  vibes: {
    a: 0.002,
    d: 1.5,
    s: 0,
    r: 0.9,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: -3, gain: 1 },
      { ratio: 1, detune: 3, gain: 0.95 },
      { ratio: 4, detune: 0, gain: 0.18 },
      { ratio: 9.6, detune: 0, gain: 0.04 },
    ],
    filter: { from: 4200, to: 1400, q: 0.9 },
    level: 0.36,
  },
  /**
   * A koto: plucked, but the pitch BENDS UP into the note rather than sitting on it. Sub already
   * uses a falling bend for weight; rising into the note is what a string being pushed sideways
   * does, and it is the whole character here.
   */
  koto: {
    a: 0.002,
    d: 1.1,
    s: 0,
    r: 0.7,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 5, gain: 0.3 },
      { ratio: 3, detune: -4, gain: 0.18 },
      { ratio: 7, detune: 0, gain: 0.05 },
    ],
    pitch: { mult: 0.94, time: 0.07 },
    filter: { from: 4600, to: 1000, q: 2 },
    level: 0.4,
  },
  /**
   * A drone: the longest thing here by a distance, and the only voice meant to be held under
   * something else rather than played. Full sustain, a very slow attack, and low partials only —
   * everything above the fifth is filtered away so it never competes with a melody on top.
   */
  /**
   * A banjo: the shortest, brightest pluck here. Where Clav is square and electric, this is a
   * skin head — a hard transient over a body that dies almost at once, with the fifth partial
   * strong enough to give it the twang it is known for.
   */
  banjo: {
    a: 0.001,
    d: 0.28,
    s: 0,
    r: 0.12,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.45 },
      { ratio: 5, detune: 3, gain: 0.26 },
      { ratio: 8, detune: 0, gain: 0.08 },
    ],
    filter: { from: 5600, to: 1400, q: 2.4 },
    level: 0.34,
  },
  /**
   * A cello: Strings an octave down and one player instead of a section, so the detune is much
   * narrower — a section is many instruments not quite agreeing, and using that width on a solo
   * voice is what makes a synth "cello" sound like a chorus pedal instead.
   */
  cello: {
    a: 0.13,
    d: 0.7,
    s: 0.75,
    r: 0.45,
    wave: 'sawtooth',
    partials: [
      { ratio: 0.5, detune: 0, gain: 1 },
      { ratio: 1, detune: -3, gain: 0.7 },
      { ratio: 1.5, detune: 2, gain: 0.2 },
      { ratio: 2, detune: 0, gain: 0.14 },
    ],
    filter: { from: 1500, to: 640, q: 1.8 },
    level: 0.3,
  },
  /**
   * A whistle: one sine and almost nothing else, which is the purest thing in the set. It only
   * works because of what it LACKS — every other voice here is defined by its partials, and this
   * one is defined by having none worth mentioning.
   */
  whistle: {
    a: 0.03,
    d: 0.3,
    s: 0.65,
    r: 0.18,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.05 },
    ],
    filter: { from: 4000, to: 3200, q: 0.5 },
    level: 0.3,
  },
  /**
   * Fifths: a chord from a single key.
   *
   * ⚠️ The only patch whose partials are a HARMONY rather than a timbre. 1.5 is a perfect fifth
   * and 2 is the octave, so every note played is a power chord — which means it is the one voice
   * here where playing two keys at once is usually too much. Worth having precisely because it
   * changes how you play rather than how it sounds.
   */
  fifths: {
    a: 0.008,
    d: 0.8,
    s: 0.5,
    r: 0.3,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 1.5, detune: 2, gain: 0.75 },
      { ratio: 2, detune: -2, gain: 0.5 },
      { ratio: 3, detune: 0, gain: 0.16 },
    ],
    filter: { from: 2600, to: 1000, q: 2 },
    level: 0.22,
  },
  drone: {
    a: 0.9,
    d: 1.4,
    s: 0.85,
    r: 2.4,
    wave: 'sawtooth',
    partials: [
      { ratio: 0.5, detune: 0, gain: 0.8 },
      { ratio: 1, detune: -6, gain: 1 },
      { ratio: 1, detune: 6, gain: 0.9 },
      { ratio: 2, detune: 0, gain: 0.25 },
    ],
    filter: { from: 700, to: 420, q: 1 },
    level: 0.2,
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
export type Fx = {
  echo: number
  echoTime: number
  space: number
  vibrato: number
  /**
   * How long a note takes to slide from the pitch of the one before it. 0 is off.
   *
   * ⚠️ it lives in Fx rather than beside the instrument list because it belongs to the
   * PART, exactly like echo and reverb do — a recorded layer keeps the glide it was played with,
   * and a peer's notes glide from their own last note rather than from yours. Putting it on the
   * instrument would make it a property of the sound instead of a property of the playing.
   */
  glide: number
}

type Bus = {
  in: GainNode
  /** LFO depth for this part; voices connect it to their detune */
  vib: GainNode
  set(fx: Fx): void
  /** how loud this whole part is, 0..1.5 — see Layer.gain */
  level(v: number): void
  dispose(): void
  /** ctx time this bus last had a note, so eviction can leave ringing tails alone */
  used: number
}

let fxOut: GainNode | null = null
/** the last node before the fork — fxOut through the limiter. See ensure(). */
let peak: AudioNode | null = null
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
/**
 * The last pitch each part played, so the next note knows where to slide from.
 *
 * ⚠️ PER PART, not one shared value. The live keyboard, every recorded layer and every peer
 * in a jam all schedule through here, so a single last-note would make your melody slide from
 * whatever somebody else just played — which is not a subtle bug, it is every note landing wrong.
 * Cleared with the bus it belongs to, so it cannot outlive the part.
 */
const lastPitch = new Map<string, number>()

/** A bus idle for less than this may still be ringing, so it is never evicted. */
const RING_TAIL = 4

/**
 * How far ahead a live note is scheduled, and the answer to the remaining clicks.
 *
 * ⚠️ AN ENVELOPE THAT STARTS AT `currentTime` STARTS IN THE PAST. Audio is rendered in blocks of
 * 128 frames — about 2.7ms at 48kHz — and `currentTime` is the start of the block being worked on
 * now, so by the time anything scheduled at exactly that instant is looked at, the moment has
 * already gone by. A 2ms attack ramp laid down there is entirely behind the playhead, and the
 * parameter simply arrives at its end value on the next block: silence to full level in one
 * sample, which is the definition of a click. The same thing happens at the other end, where a
 * release that was supposed to fade over `r` instead lands already finished.
 *
 * Scheduled notes never had this problem, which is why it was the LIVE playing that popped, and
 * only sometimes — it depends where in the block the key happened to fall.
 *
 * Two render blocks of margin puts the whole ramp safely in the future. Six milliseconds is far
 * below the ~20ms where a delay starts to be felt under the fingers, so nothing feels slower.
 */
const SAFE_START = 0.006

export type Knob = 'echo' | 'echoTime' | 'space' | 'vibrato' | 'glide'
const KNOB_KEY: Record<Knob, string> = {
  echo: 'synth_echo_v1',
  echoTime: 'synth_echo_time_v1',
  space: 'synth_space_v1',
  vibrato: 'synth_vibrato_v1',
  glide: 'synth_glide_v1',
}
/** Dry by default: an instrument that arrives drenched in reverb is a toy, not an instrument. */
const knobs: Record<Knob, number> = {
  echo: 0,
  echoTime: 0.26,
  space: 0.18,
  vibrato: 0,
  glide: 0,
}
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
  return {
    echo: knobs.echo,
    echoTime: knobs.echoTime,
    space: knobs.space,
    vibrato: knobs.vibrato,
    glide: knobs.glide,
  }
}

const KNOB_EVENT = 'synth:knob'

/**
 * Told when any knob moves, however it moved.
 *
 * ⚠️ Needed the moment something OTHER than a slider can set one — saving a rig and pressing it
 * later does exactly that, and without this the slider goes on showing the old number while the
 * sound is already the new one. Same shape as onMixerChange, for the same reason.
 */
export function onKnobChange(fn: () => void): () => void {
  window.addEventListener(KNOB_EVENT, fn)
  return () => window.removeEventListener(KNOB_EVENT, fn)
}

export function setKnob(k: Knob, v: number) {
  knobs[k] = Math.max(0, Math.min(1, v))
  applyKnobs()
  try {
    localStorage.setItem(KNOB_KEY[k], String(knobs[k]))
  } catch {
    /* applies for this visit */
  }
  window.dispatchEvent(new Event(KNOB_EVENT))
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
  // ⚠️ delay → wet is permanent; only wet → fxOut is switched, so the tail is intact the instant
  // the echo is plugged back in. Wiring the gate one node earlier severed the effect entirely.
  delay.connect(wet)
  delay.connect(fb).connect(delay)
  input.connect(verb).connect(verbWet)

  /**
   * ⚠️ THE REVERB IS UNPLUGGED WHEN IT IS NOT IN USE, and this is the single biggest thing
   * the instrument does to a phone.
   *
   * A ConvolverNode does not stop working because the gain after it is zero. Web Audio has no
   * bypass: any node whose output is pulled toward the destination is processed on every render
   * quantum, and convolution against a 2.2 second stereo impulse is by a wide margin the most
   * expensive thing in this graph. The instrument is DRY BY DEFAULT, so out of the box every bus
   * was running a full reverb to produce silence — up to MAX_BUSES of them at once, for ever,
   * from the moment a part first sounded.
   *
   * That cost is constant rather than per-note, which is exactly the shape of the fault it
   * causes: a single steadily held note crackles, because the thread is already behind before
   * you play anything. It is invisible on a desktop and ruinous on a phone.
   *
   * So verbWet reaches fxOut only while there is reverb to hear. Turning it off waits for the
   * tail before unplugging, or the room would be cut off mid-decay.
   */
  /**
   * ⚠️ THE SAME ARGUMENT AS THE REVERB BELOW, and it was left standing when that was fixed.
   *
   * A DelayNode feeding itself is a feedback loop that runs on every render quantum whether or
   * not anybody can hear it, and echo is off by default too. One delay line is far cheaper than
   * one convolution, but there is a bus per part and the cost is constant rather than per-note,
   * which is the shape that hurts a phone.
   */
  let echoLive = false
  let echoOff = 0
  const echoConnect = (on: boolean) => {
    if (on) {
      if (echoOff) {
        clearTimeout(echoOff)
        echoOff = 0
      }
      if (!echoLive) {
        wet.connect(fxOut!)
        echoLive = true
      }
    } else if (echoLive && !echoOff) {
      // long enough for the longest delay time plus its feedback to fall away
      echoOff = window.setTimeout(() => {
        echoOff = 0
        echoLive = false
        try {
          wet.disconnect()
        } catch {
          /* already gone */
        }
      }, 3000)
    }
  }

  let verbLive = false
  let verbOff = 0
  const verbConnect = (on: boolean) => {
    if (on) {
      if (verbOff) {
        clearTimeout(verbOff)
        verbOff = 0
      }
      if (!verbLive) {
        verbWet.connect(fxOut!)
        verbLive = true
      }
    } else if (verbLive && !verbOff) {
      // 2.2s of impulse plus the ramp that is fading it out, then let go
      verbOff = window.setTimeout(() => {
        verbOff = 0
        verbLive = false
        try {
          verbWet.disconnect()
        } catch {
          /* already gone */
        }
      }, 2600)
    }
  }

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
    level(v: number) {
      /* ⚠️ ramped like every other live control. Setting a gain outright while a note is
         sounding is a step in the waveform, which is a click — the same lesson as the release. */
      ramp(input.gain, Math.max(0, Math.min(1.5, v)))
    },
    set(fx: Fx) {
      ramp(wet.gain, fx.echo * 0.55)
      echoConnect(fx.echo > 0.001)
      // ⚠️ Feedback is capped well under 1. At 1 an echo never decays and the delay line
      // builds until it clips — a runaway howl that outlives the note that started it and has
      // no obvious cause.
      ramp(fb.gain, Math.min(0.6, fx.echo * 0.6))
      ramp(delay.delayTime, 0.06 + fx.echoTime * 0.7)
      ramp(verbWet.gain, fx.space * 0.9)
      verbConnect(fx.space > 0.001)
      // 0–70 cents: a whole semitone of wobble is a special effect, not vibrato
      ramp(vib.gain, fx.vibrato * 70)
      // dry backs off only slightly, so turning effects up thickens rather than swaps
      ramp(dry.gain, 1 - Math.min(0.35, fx.space * 0.35))
    },
    dispose() {
      if (echoOff) clearTimeout(echoOff)
      if (verbOff) clearTimeout(verbOff)
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
function busFor(c: AudioContext, part: string, fx: Fx, gain?: number): Bus {
  let b = buses.get(part)
  if (!b) {
    if (buses.size >= MAX_BUSES) evictBus(c)
    b = makeBus(c)
    buses.set(part, b)
  }
  b.used = c.currentTime
  b.set(fx)
  if (gain !== undefined) b.level(gain)
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
  lastPitch.delete(victim)
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

type Voice = { stop(at: number, force?: boolean): void; ends: number }
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

  /**
   * A limiter across everything the instrument makes.
   *
   * ⚠️ Notes SUM. Normalising the partials fixes one voice; it does nothing about six of them
   * held at once, and nothing about the reverb and delay returns which are added on top of the
   * dry signal by design. Past 1.0 the hardware simply flattens the peaks, which is the crunch
   * you hear on a chord and never on a single note.
   *
   * Set as a limiter rather than a compressor — a high ratio above a high threshold, so it is
   * inaudible until something is about to clip and then catches only the overshoot. A gentler
   * ratio would breathe on every note, which is a worse sound than the occasional peak it would
   * be preventing.
   */
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  fxOut.connect(limiter)
  peak = limiter

  out = makeGain(ctx, 'instrument')
  // the fork: full signal to the analyser and the room, attenuated signal to your speakers
  // ⚠️ the fork moves AFTER the limiter, so the visualiser draws the signal you actually
  // hear rather than the one before it was caught
  peak.connect(analyser)
  peak.connect(out)
  out.connect(ctx.destination)
  wireBroadcast()
  // your own hands get their bus up front, so the very first keypress is not also a graph build
  busFor(ctx, LIVE_PART, fxSnapshot())
  registerTap('instrument', analyser)
  return ctx
}

/**
 * Whether the instrument is also piped down the voice call as audio.
 *
 * ⚠️ TURNED OFF WHILE JAMMING, and that is not an optimisation. Notes are broadcast as events
 * in a jam and synthesised on every machine, so leaving the audio path connected meant every note
 * reached a listener TWICE — once as a message they played instantly, once as call audio arriving
 * on its own schedule. Two copies of the same note a few tens of milliseconds apart is a flam,
 * and it made careful playing sound sloppy for reasons the player could not see.
 *
 * The event copy is the one worth keeping. Call audio is echo-cancelled, noise-gated and
 * compressed for speech, and a sustained instrument is exactly what that machinery is built to
 * identify as noise and remove.
 */
let broadcasting = true

function wireBroadcast() {
  if (!peak) return
  try {
    if (broadcasting) peak.connect(broadcastBus())
    else peak.disconnect(broadcastBus())
  } catch {
    /* no bus on this device, or already in the state we asked for — you still hear yourself */
  }
}

/** Send the instrument down the call as audio, or don't. See `broadcasting`. */
export function setBroadcastAudio(onAir: boolean) {
  if (onAir === broadcasting) return
  broadcasting = onAir
  wireBroadcast()
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
/**
 * The kit, one piece per semitone, repeating every octave.
 *
 * ⚠️ `midi % 12`, so a given key ALWAYS plays the same drum. It was `midi % 3` — three sounds
 * cycling across the keyboard — which meant the layout carried no information: you could not
 * learn where the snare was, because the snare was wherever you happened to be standing. A
 * repeating octave means you learn the kit once and it is under your fingers at any octave, and
 * a pattern drawn in the note editor keeps meaning the same thing when you move it.
 *
 * Roughly the General MIDI order for the first few — kick, rim, snare, clap — so anybody who has
 * used a drum machine finds them where they expect.
 */
export const DRUMS: string[] = [
  'Kick',
  'Rim',
  'Snare',
  'Clap',
  'Low tom',
  'Mid tom',
  'Closed hat',
  'High tom',
  'Open hat',
  'Ride',
  'Cowbell',
  'Crash',
]

/** The piece a key plays, for a UI that wants to label the keyboard. */
export function drumName(midi: number): string {
  return DRUMS[((midi % 12) + 12) % 12]
}

/** A short noise burst through a filter — the basis of every metal and skin sound here. */
function noiseHit(
  c: AudioContext,
  at: number,
  g: GainNode,
  type: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
  dur: number,
) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, at)
  env.gain.linearRampToValueAtTime(peak, at + 0.001)
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(f).connect(env).connect(g)
  src.start(at)
  src.stop(at + dur + 0.02)
}

/** A pitched body: a sine that falls, which is what a kick and a tom both are. */
function drumTone(
  c: AudioContext,
  at: number,
  g: GainNode,
  from: number,
  to: number,
  drop: number,
  peak: number,
  dur: number,
  wave: OscillatorType = 'sine',
) {
  const o = c.createOscillator()
  o.type = wave
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + drop)
  const env = c.createGain()
  // ⚠️ 1ms in, never a step. A vertical edge in the waveform is a click riding the drum.
  env.gain.setValueAtTime(0.0001, at)
  env.gain.linearRampToValueAtTime(peak, at + 0.001)
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(env).connect(g)
  o.start(at)
  o.stop(at + dur + 0.02)
}

/**
 * Twelve pieces, all synthesised — no samples to host, and every one lands on the part's own
 * effects bus like any other voice.
 *
 * ⚠️ The levels are BALANCED AGAINST EACH OTHER, measured rather than guessed. The first pass put
 * the toms at 0.88 peak and the rim and clap at 0.25 — a three-and-a-half-to-one spread inside one
 * kit, so going from a rim to a tom jumped in your face and you ended up riding the volume instead
 * of playing. Measured again after: 2.05, and then the clap lifted to close it further.
 *
 * NOT flat, deliberately. The kick and snare sit on top and the clap sits under them, because that
 * is where they sit on a real kit — a set of drums levelled to identical peaks sounds like a
 * spreadsheet. The fault was the toms dominating, not the existence of a spread.
 */
function hitDrum(c: AudioContext, midi: number, at: number, bus: Bus | null) {
  const g = c.createGain()
  connectVoice(g, bus)
  switch (((midi % 12) + 12) % 12) {
    case 0: // Kick: a sine falling off a cliff, plus a click of noise for the beater
      drumTone(c, at, g, 150, 45, 0.12, 0.9, 0.35)
      noiseHit(c, at, g, 'highpass', 3000, 0.7, 0.12, 0.02)
      break
    case 1: // Rim: almost all click, almost no body
      noiseHit(c, at, g, 'bandpass', 2400, 6, 0.85, 0.035)
      drumTone(c, at, g, 420, 380, 0.02, 0.34, 0.04, 'triangle')
      break
    case 2: // Snare: noise for the wires, a tone for the skin under it
      noiseHit(c, at, g, 'bandpass', 1900, 0.9, 0.55, 0.19)
      drumTone(c, at, g, 190, 150, 0.06, 0.3, 0.12, 'triangle')
      break
    case 3:
      /**
       * Clap: four bursts a few milliseconds apart, not one.
       *
       * ⚠️ The stagger IS the sound. A single noise burst through the same filter is just a
       * short snare; what makes a clap read as many hands is that the hits do not land together.
       */
      for (let i = 0; i < 4; i++)
        noiseHit(
          c,
          at + i * 0.011,
          g,
          'bandpass',
          1150,
          1.4,
          i === 3 ? 0.95 : 0.68,
          i === 3 ? 0.16 : 0.03,
        )
      break
    case 4: // Low tom
      drumTone(c, at, g, 150, 70, 0.22, 0.46, 0.5)
      break
    case 5: // Mid tom
      drumTone(c, at, g, 210, 100, 0.2, 0.45, 0.42)
      break
    case 6: // Closed hat: short, bright, gone
      noiseHit(c, at, g, 'highpass', 8000, 0.8, 0.44, 0.045)
      break
    case 7: // High tom
      drumTone(c, at, g, 290, 140, 0.18, 0.44, 0.36)
      break
    case 8: // Open hat: the same metal, allowed to ring
      noiseHit(c, at, g, 'highpass', 7500, 0.8, 0.4, 0.32)
      break
    case 9: // Ride: metal with a ping on top of it
      noiseHit(c, at, g, 'highpass', 6000, 0.6, 0.24, 0.7)
      drumTone(c, at, g, 780, 760, 0.05, 0.2, 0.5, 'square')
      break
    case 10: // Cowbell: two squares a fifth-ish apart, which is the whole trick
      drumTone(c, at, g, 540, 535, 0.02, 0.24, 0.28, 'square')
      drumTone(c, at, g, 800, 795, 0.02, 0.19, 0.24, 'square')
      break
    default: // Crash: a lot of metal, decaying slowly
      noiseHit(c, at, g, 'highpass', 5200, 0.5, 0.32, 1.3)
      break
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
  part?: { key: string; fx: Fx; gain?: number },
) {
  noteCounts.on++
  const c = ensure()
  resumeAudio()
  const at = Math.max(when ?? 0, c.currentTime + SAFE_START)
  const bus = busFor(c, part?.key ?? LIVE_PART, part?.fx ?? fxSnapshot(), part?.gain)

  if (instrument === 'drums') {
    hitDrum(c, midi, at, bus)
    return
  }
  // already sounding: retrigger rather than stack a second voice on the same key. Forced,
  // because otherwise hammering one key would pile up rings that nothing is tracking.
  voices.get(id)?.stop(at, true)
  voices.delete(id)

  // ⚠️ Voice stealing. Without a cap, a stuck key or a fast peer can pile up oscillators until
  // the mix clips and the tab heats up. Oldest goes first, which is the least surprising.
  if (voices.size >= MAX_VOICES) {
    const oldest = voices.keys().next().value
    if (oldest !== undefined) {
      voices.get(oldest)?.stop(at, true)
      voices.delete(oldest)
    }
  }

  const sh = SHAPES[instrument]
  const freq = freqOf(midi)

  /**
   * ⚠️ only slides when there is somewhere to slide FROM. The first note after silence has
   * no previous pitch, and starting it from an arbitrary one would make every phrase open with a
   * swoop nobody played. A repeat of the same note is skipped too, since sliding to where you
   * already are is a ramp that does nothing but cost a scheduled event.
   */
  const partKey = part?.key ?? LIVE_PART
  const glideTime = (part?.fx ?? fxSnapshot()).glide * 0.3
  const previous = lastPitch.get(partKey)
  const glideFrom =
    glideTime > 0.005 && previous && Math.abs(previous - freq) > 0.5 ? previous : null
  lastPitch.set(partKey, freq)
  const g = c.createGain()
  /**
   * ⚠️ EVERY NODE THIS VOICE MAKES, so it can be disconnected when it stops.
   *
   * Nothing used to take a voice down. A note left its gain, its filter and one sub-gain per
   * partial hanging off the bus and relied entirely on garbage collection — which for an audio
   * node is not prompt and, while any automation on it is still running, may not come at all. A
   * bell is five partials, so a minute of playing left hundreds of live nodes attached to a bus
   * that is mixed every single render quantum. That is free on a desktop and is exactly the sort
   * of accumulating cost that turns into dropouts on a phone.
   */
  const made: AudioNode[] = [g]
  let sink: AudioNode = g
  if (sh.filter) {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = sh.filter.q
    f.frequency.setValueAtTime(sh.filter.from, at)
    f.frequency.exponentialRampToValueAtTime(Math.max(80, sh.filter.to), at + sh.d)
    g.connect(f)
    sink = f
    made.push(f)
  }
  connectVoice(sink, bus)

  /**
   * ⚠️ Partials are NORMALISED so a voice peaks at `level`, whatever it is built from.
   *
   * They were summed raw: Bell is 1 + 0.45 + 0.12 = 1.57 before `level` is applied, Pad is 1.7.
   * So an instrument was louder for having more partials, which is backwards — the extra
   * partials are there to make it sound like metal, not to make it louder than the others — and
   * `level` did not mean what it said. Measured: four pad notes reached 1.008 and clipped, where
   * one bell note reached 0.28.
   *
   * Dividing by the sum keeps every partial's share of the tone exactly as written and only
   * changes the total, so the timbre is untouched and the headroom is predictable.
   */
  const partialSum = sh.partials.reduce((n, x) => n + x.gain, 0) || 1

  const oscs: OscillatorNode[] = []
  for (const part of sh.partials) {
    const o = c.createOscillator()
    o.type = sh.wave
    o.detune.value = part.detune
    const f0 = freq * part.ratio
    if (glideFrom) {
      /**
       * Glide: start at the pitch of the previous note and slide into this one.
       *
       * ⚠️ it REPLACES the patch's own bend rather than adding to it. Sub and Koto already
       * arrive from above or below by design, and doing both would mean sliding from the last
       * note to a wrong pitch and only then to the right one — an audible stumble at the front of
       * every note. When you have asked for a slide, the slide is what you get.
       *
       * Exponential for the same reason the patch bends are: pitch is heard logarithmically, so a
       * linear ramp sounds like it lands early and then crawls the rest of the way.
       */
      o.frequency.setValueAtTime(Math.max(20, glideFrom * part.ratio), at)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f0), at + glideTime)
    } else if (sh.pitch) {
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
    const share = part.gain / partialSum
    if (share === 1) {
      o.connect(g)
    } else {
      const sub = c.createGain()
      sub.gain.value = share
      o.connect(sub).connect(g)
      made.push(sub)
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

  /**
   * ⚠️ The teardown hangs off the FIRST oscillator's `ended`, not off a timer. Every
   * oscillator in a voice is given the same stop time, so one of them firing means the voice is
   * genuinely finished — where a setTimeout would be guessing, and would fire early on a page
   * whose timers are being throttled in a background tab.
   */
  if (oscs.length) {
    oscs[0].onended = () => {
      for (const n of made) {
        try {
          n.disconnect()
        } catch {
          /* already gone */
        }
      }
    }
  }

  const ends = sh.s > 0 ? Infinity : at + sh.a + sh.d + sh.r
  const voice: Voice = {
    ends,
    stop(t: number, force = false) {
      /**
       * ⚠️ A STRUCK NOTE RINGS OUT. Lifting your finger off a marimba bar does not stop the bar,
       * and ten of these patches are one-shots — they decay to silence on their own and their
       * sustain is zero. Applying a release to them as well CUT THE RING SHORT: marimba fell from
       * 0.32s to 0.10s, pluck from 0.45s to 0.14s, bell from 2.4s to 1.4s. Letting go of the key
       * was therefore audible, which is the whole complaint, and it was audible only when the
       * note was still sounding — release after it had died did nothing, because there was
       * nothing left to cut.
       *
       * force is for the cases that genuinely must silence a voice whatever it is: panic, and
       * stealing the oldest voice when the cap is reached.
       */
      if (sh.s <= 0 && !force) return
      const from = Math.max(t, c.currentTime + SAFE_START)
      try {
        /**
         * ⚠️ THIS WAS THE POP, and it got worse the more the sequencer was used.
         *
         * The release read `g.gain.value` — the gain RIGHT NOW — and pinned it at `from`, which
         * is a moment in the FUTURE for every note the looper, the song player or a jam schedules
         * ahead. A bell struck a moment ago is near its peak now and will have decayed a long
         * way by the time `from` arrives, so pinning today's value at tomorrow's instant yanks
         * the gain back UP at the release. A vertical jump in a waveform is a click, and it
         * happened on every scheduled note-off.
         */
        /**
         * ⚠️ WE WORK OUT THE LEVEL OURSELVES RATHER THAN ASKING THE ENGINE, and that is what
         * makes this sound the same in every browser.
         *
         * This used to call cancelAndHoldAtTime where it existed and fall back to
         * `setValueAtTime(g.gain.value, from)` where it did not. That fallback is the original
         * bug: it reads the gain NOW and pins it at `from`, a moment in the FUTURE, so a note
         * that has decayed in between is yanked back up at the release — a vertical edge, which
         * is a click.
         *
         * Firefox has never shipped cancelAndHoldAtTime. So every release in Firefox took the
         * broken branch while Chrome took the good one, which is exactly the shape of "no issues
         * in Chrome, still issues in Firefox" — one engine running code the other never sees.
         *
         * There was never a need to ask. The envelope is three segments we scheduled ourselves
         * from numbers we still hold, so the value at any instant is arithmetic. Computing it
         * removes the branch, the feature detection and the difference between engines all at
         * once.
         */
        const target = Math.max(0.0001, peak * sh.s || 0.0001)
        const level =
          from <= at
            ? 0.0001
            : from < at + sh.a
              ? 0.0001 + (peak - 0.0001) * ((from - at) / sh.a)
              : from < at + sh.a + sh.d
                ? peak * Math.pow(target / peak, (from - at - sh.a) / sh.d)
                : target
        g.gain.cancelScheduledValues(from)
        g.gain.setValueAtTime(Math.max(0.0001, level), from)
        /**
         * ⚠️ setTargetAtTime, NOT exponentialRampToValueAtTime — AND THIS IS THE SECOND HALF OF
         * THE POP, the one that holding the right level at the release does not fix.
         *
         * A ramp interpolates from the PREVIOUS AUTOMATION EVENT, not from now. Hold a note past
         * the end of its attack and decay and that event is hundreds of milliseconds in the past,
         * so a ramp "over sh.r" is already ~99.9% finished the instant it begins: the gain falls
         * off a cliff instead of fading, and a vertical edge is a click. Measured on organ, held
         * 600ms: 0.3 down to 0.00025 in 21ms of a 90ms release, a jump nine times the waveform's
         * own steepest slope.
         *
         * It bites hardest on organ because its decay ends after 62ms, so any real press is past
         * it — but every sustaining patch is exposed the moment it is held longer than a + d.
         *
         * setTargetAtTime has no such anchor: it decays from whatever the value genuinely is at
         * `from`, which is exactly what a release wants, and it composes correctly with the hold
         * above for notes released on a schedule. tau = r/5, so by `from + r` it has fallen to
         * 0.7% — about -43dB — and the oscillator stop below lands well under the noise.
         */
        const tau = Math.max(0.005, sh.r / 5)
        g.gain.setTargetAtTime(0.0001, from, tau)
        /**
         * ⚠️ AND THEN END IT. setTargetAtTime approaches its target forever and never
         * arrives, so the parameter stays in automation for as long as the node exists — computed
         * every sample, on every voice ever released, with nothing to stop it. The ramp it
         * replaced at least finished. Pinning the value at the moment the oscillators stop closes
         * the automation off; by then the curve is at about 0.7% of where the release started,
         * some -43dB, so the step down to the floor is far below anything audible.
         */
        g.gain.setValueAtTime(0.0001, from + sh.r + 0.02)
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

/**
 * ⚠️ Counts what ACTUALLY reached the synth, not what the UI meant to send.
 *
 * "It sounds once on press and again on release" is a claim about how many times noteOn ran, and
 * every attempt to answer it by reasoning about pointer events failed because the events on a
 * phone are not the events on a desktop. This makes the question answerable by looking: press a
 * key once and read the numbers.
 */
export const noteCounts = { on: 0, off: 0 }
/** How many voices are sounding right now — a held note should be 1. */
export const liveVoices = () => voices.size
export function resetNoteCounts() {
  noteCounts.on = 0
  noteCounts.off = 0
}

export function noteOff(id: string, when?: number) {
  noteCounts.off++
  const c = ctx
  if (!c) return
  const v = voices.get(id)
  if (!v) return
  v.stop(Math.max(when ?? 0, c.currentTime + SAFE_START))
  voices.delete(id)
}

/**
 * Silence only what the PLAYER is holding, and leave the sequencer alone.
 *
 * ⚠️ allNotesOff stops every voice there is, the looper's included. It was being called
 * whenever you changed instrument, scale, key or rig, and whenever the window lost focus — so
 * picking a different sound cut a bar out of a loop that had nothing to do with you. The reason
 * to stop notes there is that YOUR held keys would otherwise hang in the old instrument; that
 * argument does not reach a layer the sequencer is playing.
 *
 * Live notes are the ones this room's hands make: `k:` from the computer keyboard, `p:` from a
 * pointer. A layer's are `L…` and a jam's are `jam:…`, and neither is ours to end.
 */
export function stopLive() {
  const c = ctx
  if (!c) return
  for (const [id, v] of [...voices]) {
    if (!id.startsWith('k:') && !id.startsWith('p:')) continue
    v.stop(c.currentTime + SAFE_START, true)
    voices.delete(id)
  }
}

/** Panic — everything off. Worth having the moment a stuck note happens, which it will. */
export function allNotesOff() {
  const c = ctx
  if (!c) return
  for (const [, v] of voices) v.stop(c.currentTime + SAFE_START, true)
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
    peak?.disconnect()
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
  peak = null
  ctx = null
}
