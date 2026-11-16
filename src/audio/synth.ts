import { registerTap } from './audioTap'
import { busGain, polyGain } from './poly'
import type { Ringing } from './poly'
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
  | 'rhodes'
  | 'pluck'
  | 'bell'
  | 'pad'
  | 'bass'
  | 'organ'
  | 'brass'
  | 'reed'
  | 'accordion'
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
  | 'handpan'
  | 'vibes'
  | 'koto'
  | 'drone'
  | 'banjo'
  | 'cello'
  | 'whistle'
  | 'fifths'
  | 'finger'
  | 'slap'
  | 'upright'
  | 'synthbass'
  | '808'
  | 'pick'
  | 'fretless'
  | 'acid'
  | 'tuba'
  | 'bassmarimba'
  | 'fmbass'
  | 'supersaw'
  | 'chip'
  | 'harpsichord'
  | 'sitar'
  | 'guitar'
  | 'overdrive'
  | 'fuzz'
  | 'drums'

/**
 * ⚠️ THE ORDER IS THE PICKER'S, AND THE BASSES SIT TOGETHER since 10 Nov 2026, when Evan asked
 * for "several distinct bass voices". Sub moved up beside them; an id is forever (a song stores
 * it), so reordering is free where renaming is not.
 */
export const INSTRUMENTS: Array<[InstrumentId, string, string]> = [
  ['keys', '🎹', 'Keys'],
  ['rhodes', '🎛', 'Rhodes'],
  ['harpsichord', '🏰', 'Harpsichord'],
  ['pluck', '🪕', 'Pluck'],
  ['guitar', '🤘', 'Electric guitar'],
  ['overdrive', '🔥', 'Overdrive guitar'],
  ['bell', '🔔', 'Bell'],
  ['pad', '🌊', 'Pad'],
  ['bass', '🎸', 'Bass'],
  ['finger', '🖐', 'Finger bass'],
  ['pick', '🔺', 'Pick bass'],
  ['fuzz', '🌀', 'Fuzz bass'],
  ['slap', '👋', 'Slap bass'],
  ['fretless', '〰️', 'Fretless'],
  ['upright', '🌳', 'Upright bass'],
  ['synthbass', '🎚', 'Synth bass'],
  ['acid', '🧪', 'Acid bass'],
  ['808', '💥', '808'],
  ['sub', '🔊', 'Sub'],
  ['fmbass', '📡', 'FM bass'],
  ['bassmarimba', '🎋', 'Bass marimba'],
  ['tuba', '📯', 'Tuba'],
  ['organ', '🎼', 'Organ'],
  ['brass', '🎺', 'Brass'],
  ['reed', '🎷', 'Reed'],
  ['accordion', '🪗', 'Accordion'],
  ['marimba', '🪘', 'Marimba'],
  ['choir', '🗣️', 'Choir'],
  ['harp', '🎶', 'Harp'],
  ['glass', '💎', 'Glass'],
  ['strings', '🎻', 'Strings'],
  ['kalimba', '🪵', 'Kalimba'],
  ['flute', '🌬', 'Flute'],
  ['clav', '🪶', 'Clav'],
  ['lead', '⚡', 'Lead'],
  ['supersaw', '🌈', 'Supersaw'],
  ['chip', '👾', '8-bit'],
  ['box', '🎁', 'Music box'],
  ['steelpan', '🛢', 'Steel pan'],
  ['handpan', '🛸', 'Handpan'],
  ['vibes', '🎐', 'Vibes'],
  ['koto', '🏯', 'Koto'],
  ['sitar', '🪷', 'Sitar'],
  ['drone', '🕉', 'Drone'],
  ['banjo', '🤠', 'Banjo'],
  ['cello', '🎗', 'Cello'],
  ['whistle', '😗', 'Whistle'],
  ['fifths', '🗼', 'Fifths'],
  ['drums', '🥁', 'Drums'],
]

/**
 * The voices a bassline can be played on, for the backing panel's Bass row — the original Bass
 * first, because that is what the row has always laid.
 */
export const BASS_VOICES: InstrumentId[] = [
  'bass',
  'finger',
  'pick',
  'fuzz',
  'slap',
  'fretless',
  'upright',
  'synthbass',
  'acid',
  '808',
  'sub',
  'fmbass',
  'bassmarimba',
  'tuba',
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
  /**
   * How hard the note is pushed into a soft clipper before its envelope, 0 to 1 — an amp turned
   * up. Absent is clean. See `driveCurve`.
   */
  drive?: number
  /**
   * Peak gain, so a bass patch does not drown a bell.
   *
   * ⚠️ IT IS PER PARTIAL, AND THE PARTIALS SUM, which is why reading this column on its own
   * says nothing about loudness: a four-partial patch at 0.30 is louder than a one-partial
   * patch at 0.50. What the ear gets is level x sum(partial gains), and what it gets from a
   * HELD note is that times `s`. Measured across all 27 presets: peaks were already within
   * 2.5x, but held notes ran from 0.052 to 0.636 — so in a loop, where every note is held, a
   * whistle layer sat three times under an organ one and the layer fader could not close the
   * gap. Six were raised to bring the peaks inside 0.50-0.78; the other 21 were already there.
   * If you change one of these, run scripts/synth-levels.py and look at the PEAK column rather
   * than at the number you just typed.
   */
  level: number
}

/**
 * How far above a note its WAVEFORM reaches, in harmonics, before it stops mattering to a filter.
 *
 * ⚠️ A PARTIAL IS NOT A SINE UNLESS THE WAVE IS ONE. `partials` lists the oscillators stacked to
 * make a note, but each of them is a whole waveform with its own harmonics: a saw at 82Hz has
 * energy at 164, 246, 328Hz and on up, falling only as 1/n, so its tenth harmonic is still within
 * 20dB of the note. A sine has none, and a triangle's fall as 1/n² — its third is already 19dB
 * down — which is why both are treated as the bare partial, the case the crackle fix was measured on.
 */
const WAVE_REACH: Record<OscillatorType, number> = {
  sine: 1,
  triangle: 1,
  sawtooth: 10,
  square: 10,
  custom: 1,
}

/**
 * Whether a note's filter should sweep, or sit still at its destination.
 *
 * ⚠️ 8 Sep 2026's crackle fix skipped the sweep "where the filter's destination sits well above the
 * highest partial this note actually has" — and measured the highest partial as the highest RATIO,
 * which is only true of a sine. On a saw or a square that switched the sweep off across most of the
 * keyboard: Slap lost its snap below A2, Synth bass never swept anywhere a bass line plays, and
 * Brass lost the swell its own comment calls "the brass" from A♭3 up — eighteen voices in all, and
 * the timbre changed abruptly at the pitch where the rule flipped. Measured in the room, the share of
 * a Slap E2's energy above 1.5kHz in its first 43ms was 0.07% before this and 7.8% after — and a
 * Slap B2, where the old rule did sweep, reads 11–12% either way.
 *
 * Near-sines keep the rule exactly as it was measured, because they are where the crackle is
 * audible; a saw or a square is the "rich patch" that commit found it hides in.
 */
export function filterSweeps(
  sh: Pick<Shape, 'wave' | 'partials' | 'filter'>,
  freq: number,
): boolean {
  if (!sh.filter) return false
  const top =
    freq * sh.partials.reduce((m, x) => Math.max(m, x.ratio), 1) * (WAVE_REACH[sh.wave] ?? 1)
  return Math.max(80, sh.filter.to) <= top * 1.6
}

const curves = new Map<number, Float32Array<ArrayBuffer>>()

/**
 * The soft clipper's transfer curve for a drive of 0 to 1: tanh, normalised so ±1 still maps to
 * ±1. Everything in between is pushed up towards the edges, which is what an amp turned up does —
 * the quiet part of the wave gets louder, the loud part cannot, and the corners that leaves are
 * the odd harmonics that make it sound driven.
 *
 * ⚠️ PURE AND EXPORTED, so the shape can be asked a question without a browser: that it is odd
 * (no DC, no even-harmonic lopsidedness), that it never folds back, and that ±1 stays ±1 so the
 * envelope after it keeps the peak. Memoised, because a voice is made per note.
 */
export function driveCurve(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 1000) / 1000 + n * 10
  const had = curves.get(key)
  if (had) return had
  const k = 1 + 9 * Math.max(0, Math.min(1, drive))
  const norm = Math.tanh(k)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    out[i] = Math.tanh(k * x) / norm
  }
  curves.set(key, out)
  return out
}

/**
 * ⚠️ EXPORTED SO SOMETHING CAN CHECK IT. `scripts/synth-levels.py` has carried the loudness
 * doctrine since September — peak is `level x sum(gains)`, held is that times sustain, and the
 * two disagreed once in a way that hid a 12x imbalance — but a script somebody has to remember
 * to run is a rule nobody checks. `presets.test.ts` asks the table the same questions on every
 * `npm run test`. Nothing outside this module may USE it to make a sound; the test imports it
 * to measure it.
 */
export const SHAPES: Record<Exclude<InstrumentId, 'drums'>, Shape> = {
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
    level: 0.55,
  },
  /**
   * Electric guitar, clean: a picked string through an amp. ⚠️ IT HOLDS, which is the whole
   * difference from every other plucked voice here — Harp, Koto, Banjo and Pluck all die to
   * nothing, while a pickup and an amp keep a fifth of the note ringing, so a chord can sit under
   * a song. Two copies of the note a few cents apart are the chorus pedal nearly every clean tone
   * is played through, and a filter that settles at a mid-bright 1.3kHz keeps it from turning into
   * the Supersaw. (Evan, 10 Nov 2026: "more instruments".)
   */
  guitar: {
    a: 0.002,
    d: 1.2,
    s: 0.22,
    r: 0.25,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -4, gain: 1 },
      { ratio: 1, detune: 4, gain: 0.5 },
      { ratio: 2, detune: 0, gain: 0.3 },
    ],
    filter: { from: 3400, to: 1300, q: 1.2 },
    level: 0.62,
  },
  /**
   * Overdrive guitar: the same picked string as the clean one, through an amp turned up. The
   * clipper squares off the wave — the grit — and squashes it, which is why it holds nearly half
   * its level where the clean one keeps a fifth. A filter settling at 2.6kHz is the speaker
   * cabinet, taking off the fizz a real one would never play.
   *
   * ⚠️ A SAW GOES IN, NOT A TRIANGLE, and the first version had it the other way round. A clipped
   * triangle is a trapezoid, whose harmonics still fall as 1/n² — so it measured DARKER than the
   * clean guitar (2.8% of its energy above 1kHz at C4 against 16.4%), the opposite of driven. A
   * clipped saw keeps its 1/n harmonics and adds the corners.
   */
  overdrive: {
    a: 0.002,
    d: 2,
    s: 0.45,
    r: 0.2,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -5, gain: 1 },
      { ratio: 1, detune: 5, gain: 0.6 },
      { ratio: 2, detune: 0, gain: 0.3 },
    ],
    drive: 0.6,
    filter: { from: 3200, to: 2600, q: 1.2 },
    level: 0.26,
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
    level: 0.42,
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
    level: 0.42,
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
    /**
     * ⚠️ Flute and whistle were reported as crackly and every LOUDER patch was fine — organ,
     * drone, strings, cello and choir all hit the limiter harder and none of them crackle. The
     * level was never what made these two different; the SPECTRUM is. A patch with a dozen
     * partials hides the limiter's intermodulation products inside its own harmonics. These are
     * essentially a sine, so there is nothing for the junk to hide behind and you hear it directly.
     *
     * They were dropped to 0.20/0.22 as a stopgap. Polyphony scaling (see polyTarget) fixes the
     * cause instead — a five-note chord is now mixed at 1/sqrt(5) — so the levels are back where
     * they were and single notes are full strength again. Measured through the real limiter:
     * flute at 0.34 went 3.91% distortion on a three-note chord and 6.68% on five; with scaling
     * it never reaches the limiter at all up to five voices.
     */
    level: 0.48,
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
    level: 0.4,
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
  /**
   * An electric piano's tine: a struck metal rod beside a pickup.
   *
   * ⚠️ THE 4.2 IS THE WHOLE SOUND. A Rhodes is not a dark piano — what makes one recognisable
   * in two notes is a high INHARMONIC partial that belongs to no scale, the same trick the bell
   * uses at 2.76, sitting over an otherwise ordinary stack. Take it out and this is `keys` with
   * a longer tail. The detune on the octave is the pickup's beat against the tine.
   */
  rhodes: {
    a: 0.005,
    d: 1.1,
    s: 0.22,
    r: 0.7,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 5, gain: 0.34 },
      { ratio: 4.2, detune: 0, gain: 0.13 },
      { ratio: 7, detune: 0, gain: 0.04 },
    ],
    filter: { from: 4200, to: 900, q: 0.8 },
    level: 0.4,
  },
  /**
   * Two reeds a few cents apart, which is what an accordion IS.
   *
   * ⚠️ A PAIR AT RATIO 1, NOT A DETUNED SINGLE. The instrument has two or three reeds per note
   * tuned slightly apart on purpose — the slow beat between them is the sound, and it is the
   * same construction `choir` uses for a different reason. The slow attack is the bellows
   * taking up; without it this is just a filtered saw.
   */
  accordion: {
    a: 0.05,
    d: 0.09,
    s: 0.95,
    r: 0.14,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -8, gain: 1 },
      { ratio: 1, detune: 8, gain: 0.9 },
      { ratio: 2, detune: 0, gain: 0.38 },
      { ratio: 3, detune: 0, gain: 0.16 },
    ],
    filter: { from: 3000, to: 2300, q: 0.6 },
    level: 0.44,
  },
  steelpan: {
    a: 0.002,
    d: 0.55,
    /**
     * ⚠️ ZERO, AND IT HAS TO BE ZERO RATHER THAN NEARLY ZERO.
     *
     * This is a one-shot like the marimba and the bell — you hit an oil drum and it rings, and
     * letting go of the mallet does nothing to it. But it was written with a sustain of 0.08,
     * which is inaudible as a level and yet decisive as a FLAG: stop() exempts a voice from the
     * release only when the sustain is zero, so this patch was the one struck sound still having
     * its ring cut when you let go. Its own decay falls with a time constant near 0.22s and the
     * release forces 0.07s, so the sound changed slope three-fold in the middle of a note, which
     * is heard as a knock rather than as a fade.
     *
     * The clav next door keeps its small sustain on purpose: a clavinet really does have a
     * damper, so stopping when you let go is what that instrument does.
     */
    s: 0,
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
  /**
   * A handpan: the sweet cousin of the steel pan.
   *
   * ⚠️ HARMONIC WHERE THE STEEL PAN IS NOT, and that one difference is the entire character.
   * `steelpan` is bright and clangy because its partials sit at 2.4 and 3.7 — deliberately
   * inharmonic. A handpan is hammered so its overtones land on the octave and the fifth above
   * it, which is why it sounds consonant with itself and why people play them in parks.
   * Everything else here — soft strike, long tail, no sustain — the two share.
   */
  handpan: {
    a: 0.004,
    d: 1.3,
    s: 0,
    r: 0.9,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: -4, gain: 0.5 },
      { ratio: 3, detune: 3, gain: 0.22 },
      { ratio: 5.4, detune: 0, gain: 0.05 },
    ],
    filter: { from: 2600, to: 700, q: 1 },
    level: 0.35,
  },
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
    /* Same story as flute above — purest patch in the set, so it exposed the limiter the same
       way. Back to 0.30 now that polyphony scaling keeps a chord under the threshold. */
    level: 0.5,
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

  /* ── added 10 Nov 2026: five basses, and four voices unlike anything above ────────────────
     ⚠️ NONE OF THESE HAS BEEN HEARD BY A PERSON. Each was measured in the room — how loud, how
     bright, how fast it dies away — against the others and against Bass and Sub; whether it
     sounds like what its name says is Evan's to judge. */

  /**
   * Finger bass: a round, warm pluck that keeps sounding — a triangle (few harmonics), a little
   * second and third for the growl of a string under a fingertip, and a gentle filter. The
   * original Bass is a resonant square; this is the soft one.
   */
  finger: {
    a: 0.008,
    d: 0.8,
    s: 0.35,
    r: 0.15,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.35 },
      { ratio: 3, detune: 0, gain: 0.12 },
    ],
    filter: { from: 1600, to: 500, q: 1.2 },
    level: 0.7,
  },
  /**
   * Slap bass: the snap is a filter that starts wide open and slams shut, with a resonant peak,
   * and a pitch that lands a hair sharp. Bright for an instant and then mostly gone, which is what
   * makes a slap line percussive rather than sung.
   */
  slap: {
    a: 0.001,
    d: 0.35,
    s: 0.3,
    r: 0.12,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.5 },
      { ratio: 4, detune: 0, gain: 0.2 },
    ],
    filter: { from: 6000, to: 700, q: 5 },
    pitch: { mult: 1.03, time: 0.03 },
    level: 0.7,
  },
  /**
   * Upright bass: woody and dying away — a triangle with a faint fifth harmonic for the wood, a
   * dark filter, and almost no sustain, so a walking line has air between the notes the way a
   * plucked double bass does.
   */
  upright: {
    a: 0.006,
    d: 1.2,
    s: 0.08,
    r: 0.25,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.22 },
      { ratio: 3, detune: 0, gain: 0.1 },
      { ratio: 5, detune: 0, gain: 0.04 },
    ],
    filter: { from: 1200, to: 320, q: 0.8 },
    pitch: { mult: 1.01, time: 0.02 },
    level: 0.72,
  },
  /**
   * Synth bass: two saws pulled apart so they beat against each other, an octave below for
   * weight, and a resonant filter — the dance-music bass. A held note stays full, unlike every
   * plucked bass above.
   */
  synthbass: {
    a: 0.004,
    d: 0.6,
    s: 0.7,
    r: 0.12,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -12, gain: 1 },
      { ratio: 1, detune: 12, gain: 0.6 },
      { ratio: 0.5, detune: 0, gain: 0.6 },
    ],
    filter: { from: 2400, to: 600, q: 7 },
    level: 0.55,
  },
  /**
   * 808: a sine that drops into its note and then HOLDS — the long boom under trap and hip hop.
   * Sub is the short thump; this one sustains, with a whisper of second and third so it still
   * reads on a phone speaker that cannot reproduce the fundamental.
   */
  '808': {
    a: 0.002,
    d: 2.2,
    s: 0.55,
    r: 0.6,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.12 },
      { ratio: 3, detune: 0, gain: 0.05 },
    ],
    pitch: { mult: 1.9, time: 0.06 },
    level: 0.62,
  },
  /**
   * Pick bass: an electric played with a plectrum — the rock bass. Brighter and harder at the
   * front than Finger, from a saw rather than a triangle, and it holds half its level, so a run
   * of eighths stays even where Slap would bounce.
   */
  pick: {
    a: 0.002,
    d: 1,
    s: 0.5,
    r: 0.12,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.25 },
    ],
    filter: { from: 3200, to: 900, q: 1.5 },
    level: 0.6,
  },
  /**
   * Fuzz bass: a bass through a fuzz pedal, clipped hard — thick, buzzing and sustained, the bass
   * under stoner rock and plenty of funk. A saw with an octave below it for weight, the clipper
   * turned nearly all the way, and a filter left open at 2.4kHz so the buzz is there to hear.
   *
   * ⚠️ THE FIRST VERSION SHUT THE FILTER AT 900Hz on a triangle, and measured 0% of its energy
   * above 1kHz — a fuzz with the fuzz filtered off. See the note on Overdrive about triangles.
   */
  fuzz: {
    a: 0.003,
    d: 1.2,
    s: 0.6,
    r: 0.15,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 0.5, detune: 0, gain: 0.5 },
    ],
    drive: 0.85,
    filter: { from: 2800, to: 2400, q: 0.9 },
    level: 0.32,
  },
  /**
   * Fretless: smooth and singing, the bass that slides. No fret means every note arrives from a
   * little under its pitch, so the pitch RISES into place (0.97) where Slap and the 808 fall; a
   * triangle with a soft octave and a long, held note does the rest.
   */
  fretless: {
    a: 0.02,
    d: 1.6,
    s: 0.6,
    r: 0.3,
    wave: 'triangle',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.3 },
    ],
    filter: { from: 900, to: 900, q: 2 },
    pitch: { mult: 0.97, time: 0.08 },
    level: 0.7,
  },
  /**
   * Acid: one saw through a very resonant filter that snaps shut on every note — the squelch of
   * acid house. The resonance is the instrument; with the per-note sweep it is a "yow" on each
   * step, and with the part's Glide turned up the notes slide into each other the way the sound is
   * known for.
   *
   * ⚠️ IT NEEDS THE SWEEP, which a saw only gets in the bass register since `filterSweeps` counts
   * the wave's own harmonics. Under the old rule this was a static resonant hum.
   */
  acid: {
    a: 0.002,
    d: 0.25,
    s: 0.2,
    r: 0.08,
    wave: 'sawtooth',
    partials: [{ ratio: 1, detune: 0, gain: 1 }],
    filter: { from: 3600, to: 260, q: 10 },
    level: 0.4,
  },
  /**
   * Tuba: a bass you blow. Every other bass here closes its filter after the attack; a brass note
   * OPENS it — the lips start buzzing dark and the bell brightens as the air arrives, the "bwah".
   * So the filter sweeps UP, from 160 to 650Hz over the swell, and the note scoops into pitch from
   * a little under it, as a lip does. A second saw 5 cents away is the bell's slow shimmer.
   *
   * ⚠️ 650Hz IS THE TOP OF THE SWEEP ON PURPOSE: filterSweeps only sweeps when the target is in
   * reach of the wave's own harmonics, and at the bottom of the bass (E1, 41Hz) a saw's reach is
   * 656Hz. Any higher and the lowest notes would sit at a static, open filter with no swell.
   */
  tuba: {
    a: 0.05,
    d: 0.4,
    s: 0.8,
    r: 0.15,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 1, detune: 5, gain: 0.3 },
    ],
    filter: { from: 160, to: 650, q: 1.4 },
    pitch: { mult: 0.985, time: 0.05 },
    level: 0.5,
  },
  /**
   * Bass marimba: a wooden bar struck with a soft mallet. A marimba bar is carved so its first
   * overtone sits exactly two octaves up (4x) rather than at the inharmonic place a plain bar puts
   * it, and that overtone over a pure fundamental IS the hollow, woody sound. Struck, so it never
   * sustains: the note dies away under the mallet whatever you hold. No filter, nothing driven.
   *
   * ⚠️ A LONG RING AND A HIGH LEVEL, BOTH MEASURED (14 Nov 2026, a held C2 and C3 through the
   * synth's tap, against Keys on the same notes). At d 0.9 and level 0.62 its RMS read 15dB under
   * Keys, where every other bass read between -9 and +7: a struck note that has died by the next
   * beat is a quiet bass however hard it is hit. A low bar on a real bass marimba rings for over a
   * second, which is what d 1.6 gives; at 0.72 it read -5 to -6dB, with its peak level with the
   * upright's.
   */
  bassmarimba: {
    a: 0.002,
    d: 1.6,
    s: 0,
    r: 0.3,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 4, detune: 0, gain: 0.35 },
    ],
    level: 0.72,
  },
  /**
   * FM bass: the glassy, knocking electric bass of 80s pop, which a DX7 made with frequency
   * modulation. ⚠️ THIS IS NOT FM — the synth has no modulator — it is the SOUND of one built from
   * what this file has: clean sine partials (no saw buzz), one of them at 3.5x, between the third
   * and fourth harmonic, which is the metallic "tink" in the attack, and a filter that closes fast
   * so the knock is gone in a tenth of a second and leaves a round, steady body.
   */
  fmbass: {
    a: 0.001,
    d: 0.3,
    s: 0.45,
    r: 0.1,
    wave: 'sine',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 0, gain: 0.6 },
      { ratio: 3, detune: 0, gain: 0.35 },
      { ratio: 3.5, detune: 0, gain: 0.2 },
    ],
    filter: { from: 5000, to: 260, q: 1.2 },
    level: 0.6,
  },
  /**
   * Supersaw: five saws spread around the note — the wall of sound under trance and big pop
   * choruses. Lead is two saws and a hard filter; this is wide and open.
   */
  supersaw: {
    a: 0.02,
    d: 0.8,
    s: 0.75,
    r: 0.35,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: -22, gain: 0.6 },
      { ratio: 1, detune: -11, gain: 0.8 },
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 1, detune: 11, gain: 0.8 },
      { ratio: 1, detune: 22, gain: 0.6 },
    ],
    filter: { from: 6000, to: 3500, q: 0.8 },
    level: 0.4,
  },
  /**
   * 8-bit: a raw square wave, on and off with nothing in between — a game console's voice. The
   * only patch with no filter and no envelope to speak of, which is the whole sound.
   */
  chip: {
    a: 0.001,
    d: 0.1,
    s: 0.8,
    r: 0.03,
    wave: 'square',
    partials: [{ ratio: 1, detune: 0, gain: 1 }],
    level: 0.28,
  },
  /**
   * Harpsichord: plucked by a quill, so bright and with no sustain — a saw through a filter that
   * starts very high, and a second string an octave up slightly out of tune with the first, which
   * is how the instrument's two registers sound together.
   */
  harpsichord: {
    a: 0.001,
    d: 2,
    s: 0,
    r: 0.25,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 3, gain: 0.6 },
      { ratio: 4, detune: -2, gain: 0.25 },
    ],
    filter: { from: 9000, to: 2600, q: 1.5 },
    level: 0.65,
  },
  /**
   * Sitar: a buzzing string that bends up into its note. The buzz is a narrow, very resonant
   * filter in the upper harmonics; the bend is a pitch that starts a little flat. Koto is a clean
   * pluck; this one rings and sings.
   */
  sitar: {
    a: 0.002,
    d: 2,
    s: 0.1,
    r: 0.6,
    wave: 'sawtooth',
    partials: [
      { ratio: 1, detune: 0, gain: 1 },
      { ratio: 2, detune: 6, gain: 0.5 },
      { ratio: 3, detune: -5, gain: 0.35 },
    ],
    filter: { from: 3800, to: 2200, q: 9 },
    pitch: { mult: 0.985, time: 0.12 },
    level: 0.35,
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
  /**
   * Darker or brighter, 0.5 being the preset as written.
   *
   * ⚠️ IT IS IN Fx AND NOT BESIDE THE INSTRUMENT, for the reason glide gives directly above: it
   * belongs to the PART. A recorded layer keeps the tone it was played with, a peer's notes
   * arrive with the tone they chose, and the live part follows the slider — all of which the
   * other five already do for free by living here.
   *
   * ⚠️ AND IT MAY BE MISSING. Every layer saved before this existed has an `fx` without it, so
   * every read is `?? 0.5`. A `tone: undefined` reaching a shelf's gain is NaN, which in the
   * Web Audio graph is not an error — it is a bus that outputs silence, for a song somebody
   * recorded last week.
   */
  tone: number
}

type Bus = {
  /**
   * Where voices connect. This is the POLYPHONY node, not the part level — see polyGain(). It
   * sits in front of `level()`'s node so a part's own volume and the headroom compensation stay
   * independent of each other.
   */
  in: GainNode
  /** LFO depth for this part; voices connect it to their detune */
  vib: GainNode
  set(fx: Fx): void
  /** how loud this whole part is, 0..BUS_CEILING — see Layer.gain */
  level(v: number): void
  /** what `level` is worth right now, mid-glide included — see faderOf */
  gain(): number
  dispose(): void
  /** ctx time this bus last had a note, so eviction can leave ringing tails alone */
  used: number
}

let fxOut: GainNode | null = null
/** the last node before the fork — fxOut through the limiter. See ensure(). */
let peak: AudioNode | null = null
/** the signal as it arrives at the limiter, before anything is taken off it */
let preAnalyser: AnalyserNode | null = null
let verbBuf: AudioBuffer | null = null
/**
 * POLYPHONY SCALING — how loud one voice is allowed to be, given how many are sounding.
 *
 * ⚠️ FOURTEEN OF THE TWENTY-SEVEN PATCHES SUMMED PAST FULL SCALE ON A FIVE-NOTE CHORD, because
 * every voice was mixed at its full level regardless of how many were already playing. The
 * limiter caught it, which is what a limiter is for — but a limiter working constantly is a
 * limiter you can hear, and on the near-sine patches (flute, whistle) you heard it as crackle.
 * The two of them were dropped ~4dB as a stopgap; this replaces that, and their levels go back.
 *
 * 1/sqrt(n) rather than 1/n. Voices at musical intervals are neither perfectly in phase nor
 * perfectly random, and sqrt is the incoherent-sum assumption that sits between the two: 1/n
 * would hold total power constant and make every chord quieter than the note it started from,
 * which is the cure being worse than the disease.
 *
 * ⚠️ ASYMMETRIC, and that is the part that makes it usable rather than a swell machine.
 * noteOff DELETES the voice immediately even though its release is still sounding, so the count
 * drops to zero the instant you lift a five-note chord. Gliding the gain back up at that speed
 * would take five decaying tails and boost them 7dB — you would hear the chord bloom as you let
 * go of it. So the gain falls fast (a new note must not clip) and rises slowly, over ~350ms,
 * which is longer than most release times: the tail is nearly gone before the compensation has
 * moved much. That asymmetry is doing the same job as tracking each voice's true end time, for
 * none of the bookkeeping.
 *
 * ⚠️ Counted across ALL parts, not per part. Clipping happens where everything sums — at the
 * limiter — so a looper stack of eight notes has to make room for your live hands too.
 *
 * This does not make every patch clean. Organ is hot enough that five voices still land over
 * full scale even scaled (1.42 against 3.18 before), and it does not need to be clean: it has a
 * dozen partials for the artefacts to hide in, which is exactly why it was never the complaint.
 */
const POLY_DOWN = 0.012
const POLY_UP = 0.35
/**
 * Everything still making sound, so the scaler can be asked how much room is left.
 *
 * ⚠️ THE ARITHMETIC IS IN poly.ts AND THAT IS NOT TIDYING. The rule it keeps was plainly wrong
 * for two months — the sum was measured in the PATCH's level and the signal in the LAYER's, so a
 * backing with every fader at zero took 5-7dB off your hands — and nothing could ask about it,
 * because this file opens an AudioContext and `npm run test` has no audio. It is numbers now, and
 * `poly.test.ts` puts the question. What stays here is the graph: when to re-evaluate, how fast to
 * glide, and which bus to push it to.
 */
const ringing: Ringing[] = []

/** The release time constant actually used — floored, because a faster one clicks by physics. */
function releaseTau(sh: { r: number }): number {
  return Math.max(0.04, sh.r / 5)
}

/**
 * How long the release actually needs before it can be cut off.
 *
 * ⚠️ THIS HAS TO TRACK THE TAU, and it did not, which is a regression I shipped an hour ago. The
 * release ends with a hard `setValueAtTime(0.0001)` whose original comment reasoned that "by then
 * the curve is at about 0.7%, some -43dB, far below anything audible". That was true only because
 * the cutoff sat at `r + 0.02` and tau was `r / 5`, so the cutoff was always five taus out.
 *
 * Flooring tau at 40ms broke the arithmetic without moving the cutoff. On organ the curve was
 * then still at 6.4% when the step landed, turning an inaudible -63.5dBFS join into -34.3dBFS —
 * 29dB louder, a click at the end of every release, on exactly the patches the floor was meant
 * to help. Deriving the span from the tau in use keeps the five-tau relationship whatever the
 * floor does.
 */
function releaseSpan(sh: { r: number }): number {
  return Math.max(sh.r, releaseTau(sh) * 5)
}

/**
 * A part's fader AS THE BUS IS APPLYING IT THIS INSTANT, and 0 for a part with no bus.
 *
 * ⚠️ READ BACK OFF THE GRAPH RATHER THAN REMEMBERED, which is the half of the fix that is not
 * one multiplication. `setLayerGain` rides the bus — its own comment says it "takes effect on
 * whatever is already ringing" — so a gain copied into the voice at note-on would disagree with
 * the signal for as long as the longest note already sounding. Measured before the fix: holding a
 * key over an audible backing and then pulling every fader to zero left that key at 0.2198 where
 * it reads 0.5312 alone, and it STAYED there, because nothing was going to re-strike it.
 *
 * An evicted or disposed bus is disconnected, so a ring that outlives its bus is silent and 0 is
 * the honest answer. evictBus already refuses to take a bus whose tail could still be sounding.
 */
function faderOf(part: string): number {
  return buses.get(part)?.gain() ?? 0
}

function polyTarget(): number {
  return polyGain(ringing, ctx ? ctx.currentTime : 0, faderOf)
}

/**
 * Push the current polyphony to every part.
 *
 * Called after the voice map changes. Cheap enough to be unconditional: it is one setTargetAtTime
 * per live bus, and there are at most MAX_BUSES of them.
 */
let polyTick = 0
/**
 * Keep re-evaluating while anything is still ringing.
 *
 * ⚠️ Note events alone are not enough now that the sum follows the envelopes. Without this the
 * gain would freeze at whatever the last keypress computed and only recover on the next one — so
 * a big chord would hand its headroom back late, and the last note of a phrase would stay ducked
 * until you played again. Runs only while something is sounding, and stops itself.
 */
function polyPulse() {
  if (polyTick) return
  polyTick = window.setInterval(() => {
    if (!ringing.length || !ctx) {
      window.clearInterval(polyTick)
      polyTick = 0
      if (ctx) applyPoly(ctx)
      return
    }
    applyPoly(ctx)
  }, 60)
}

function applyPoly(c: AudioContext) {
  const t = polyTarget()
  /**
   * ⚠️ SCHEDULED AHEAD, AND THIS LINE WAS THE CRACKLE. It used to pass `c.currentTime`, with a
   * comment of mine claiming that reading and scheduling at "the same instant" left nothing to
   * drift. That is wrong, and it is the one mistake this file warns about most loudly.
   *
   * currentTime is not the render position — the engine is already some way into the next block.
   * setTargetAtTime given a start time in the PAST is evaluated partway along its own curve, so
   * the gain does not begin gliding, it JUMPS to wherever the curve had already got to. With
   * POLY_DOWN at 12ms and about 10ms of buffer that is 1 - e^(-10/12), or 57% of the way to the
   * target, in a single sample — and this runs on every note on, every note off, and every 60ms
   * besides.
   *
   * Found in a recording from the machine that could provoke it. Seven isolated steps, each one
   * the waveform moving smoothly, jumping in ONE sample, then continuing smoothly at the same
   * slope — a pure value discontinuity of 0.107 to 0.128, a quarter to nearly half the local
   * amplitude. The jumps are multiplications: the ratios across them are 0.55, 0.58, 0.58, 0.60,
   * 0.60 and 0.36, which is a gain stepping rather than a signal breaking, and 0.57 is exactly
   * what the arithmetic above predicts.
   *
   * It explains the whole shape of the report: it fires on note events, gets worse the faster you
   * play, happens on every instrument, is plainest on the pure patches where a level step has
   * nothing to hide behind, is in the rendered signal so it survives into a recording, and is
   * untouched by buffer size. Firefox runs further ahead, so it jumps further.
   */
  const now = c.currentTime + SAFE_START
  if (ringing.length) polyPulse()
  for (const b of buses.values()) {
    const g = b.in.gain
    const tau = t < g.value ? POLY_DOWN : POLY_UP
    try {
      /* No cancelScheduledValues: successive setTargetAtTime calls already supersede each other
         from wherever the value has actually got to, which is what ramp() relies on for every
         other live control. Cancelling first is the branch that made releases click. */
      g.setTargetAtTime(t, now, tau)
    } catch {
      /* context went away mid-gesture */
    }
  }
}

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
/* exported because takeFx.ts needs the same lookahead for the same reason, and two copies of a
   constant is how the two of them drift apart */
export const SAFE_START = 0.006

export type Knob = 'echo' | 'echoTime' | 'space' | 'vibrato' | 'glide' | 'tone'
const KNOB_KEY: Record<Knob, string> = {
  echo: 'synth_echo_v1',
  echoTime: 'synth_echo_time_v1',
  space: 'synth_space_v1',
  vibrato: 'synth_vibrato_v1',
  glide: 'synth_glide_v1',
  tone: 'synth_tone_v1',
}
/** Dry by default: an instrument that arrives drenched in reverb is a toy, not an instrument. */
const knobs: Record<Knob, number> = {
  echo: 0,
  echoTime: 0.26,
  space: 0.18,
  vibrato: 0,
  glide: 0,
  /* ⚠️ THE ONE KNOB WHOSE NEUTRAL IS THE MIDDLE. The other five are effects and 0 means off;
     this one shapes what is already there, so 0.5 is "as the preset was written" and the slider
     has somewhere to go in both directions. */
  tone: 0.5,
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
    tone: knobs.tone,
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
  /* voices ─► poly ─► input ─► fx.  New buses start at whatever the current polyphony says,
     not at 1, or a layer joining a busy arrangement would jump in 3dB too loud. */
  const poly = c.createGain()
  poly.gain.value = polyTarget()
  /**
   * Tone: one shelf, between the polyphony node and everything else.
   *
   * ⚠️ HERE AND NOT AFTER THE SPLIT, which is the whole reason this is one node. `input` fans
   * out to the dry path, the delay and the convolver; shaping before the fan-out means the echo
   * and the reverb carry the same tone as the note, which is what a tone control means. Put it
   * on `dry` alone and darkening a part would leave a bright echo of itself behind.
   *
   * ⚠️ A HIGHSHELF RATHER THAN A LOWPASS, because the knob has to go both ways. A lowpass can
   * only ever take away, so a "tone" built from one is a Darken slider with a misleading name —
   * and the presets are already filtered, so brightening is the half people reach for first.
   * At 0.5 the gain is 0dB and the node is transparent.
   */
  const tone = c.createBiquadFilter()
  tone.type = 'highshelf'
  tone.frequency.value = 1500
  tone.gain.value = 0
  poly.connect(tone).connect(input)
  const dry = c.createGain()
  const delay = c.createDelay(1.2)
  const wet = c.createGain()
  const fb = c.createGain()
  const verb = c.createConvolver()
  verb.buffer = sharedImpulse(c)
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

  /**
   * ⚠️ SCHEDULED AHEAD, for the same reason applyPoly is — this is the other instance of the
   * bug and it runs on every note, because busFor calls set(fx) each time one starts.
   *
   * currentTime is not the render position. setTargetAtTime given a start time already passed is
   * evaluated partway along its own curve, so the parameter JUMPS to wherever the curve had got
   * to rather than gliding from where it is. At tau 0.02 with about 10ms of buffer that is
   * 1 - e^(-10/20), or 39% of the distance, in one sample. Harmless while nothing is changing,
   * and a click the moment anything is — a knob moved mid-note, a layer's level set, a peer's
   * reverb arriving in a jam.
   */
  const ramp = (p: AudioParam, v: number) => {
    try {
      p.setTargetAtTime(v, c.currentTime + SAFE_START, 0.02)
    } catch {
      p.value = v
    }
  }

  return {
    in: poly,
    vib,
    used: c.currentTime,
    level(v: number) {
      /* ⚠️ ramped like every other live control. Setting a gain outright while a note is
         sounding is a step in the waveform, which is a click — the same lesson as the release. */
      ramp(input.gain, busGain(v))
    },
    /* ⚠️ the LIVE value, not the target. A fader mid-glide is partly applied, and the sum
       has to be about what is reaching the speakers now — see poly.ts. */
    gain: () => input.gain.value,
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
      /* ⚠️ `?? 0.5` — a layer saved before Tone existed has no `tone`, and undefined here is
         NaN on the shelf's gain, which Web Audio answers with silence rather than an error.
         ±10dB: enough to hear on every preset, short of the point where a bright saw turns
         harsh or the limiter starts doing the deciding. */
      ramp(tone.gain, ((fx.tone ?? 0.5) - 0.5) * 20)
    },
    dispose() {
      if (echoOff) clearTimeout(echoOff)
      if (verbOff) clearTimeout(verbOff)
      try {
        lfo.stop()
      } catch {
        /* already stopped */
      }
      for (const n of [poly, tone, input, dry, delay, wet, fb, verb, verbWet, vib]) n.disconnect()
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
/**
 * The one impulse every reverb in the app points at.
 *
 * ⚠️ SHARED, AND THE COMMENT ON makeBus ALREADY SAYS WHY: an AudioBuffer is immutable as
 * far as the graph is concerned, so generating 2.2 seconds of stereo noise once and pointing
 * every convolver at it costs one buffer rather than one per part. A take's voice chain is one
 * more convolver and has no business generating a second copy — see takeFx.
 */
export function sharedImpulse(c: AudioContext): AudioBuffer {
  if (!verbBuf) verbBuf = impulse(c, 2.2)
  return verbBuf
}

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
  /**
   * ⚠️ A SECOND ANALYSER, BEFORE THE LIMITER, because every level the strip showed was measured
   * AFTER it. A post-limiter peak of 0.219 is compatible with 3.0 going in — the limiter's whole
   * job is to make those look the same — so "peak max" could never reveal an overdriven mix. This
   * is the number that decides whether the limiter has to work at all.
   */
  preAnalyser = ctx.createAnalyser()
  preAnalyser.fftSize = 2048
  fxOut.connect(preAnalyser)

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
  const partKey = part?.key ?? LIVE_PART
  const bus = busFor(c, partKey, part?.fx ?? fxSnapshot(), part?.gain)

  if (instrument === 'drums') {
    /* ⚠️ A DRUM HIT REGISTERS NO RING, so drums are invisible to the polyphony scaler and
       always have been — a kit is noise bursts and short tones built here rather than a voice
       with an envelope this file holds the numbers for. It is not obviously wrong (a kick is
       percussive and the limiter handles it) but it does mean the sum is a sum of the PITCHED
       parts only, and the beat picker's layers are drums.

       See OPEN-DECISIONS §13b, "Drums are invisible to the scaler" — NAMED as well as numbered
       on purpose, because an unmerged Lab draft adds a §13 of its own whose 13b is about who
       may read a minor's vote. A number is the one part of a cross-reference somebody else can
       change without touching this file. */
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
    /**
     * ⚠️ AUTOMATING A BIQUAD'S FREQUENCY INJECTS INHARMONIC ENERGY, and this was the crackle.
     *
     * A BiquadFilterNode recomputes its coefficients as the frequency moves, and the engine does
     * that in steps rather than per sample — so a swept filter modulates the signal slightly at
     * the update rate. On a rich patch that hides inside the harmonics. On a near-sine it is
     * plainly audible, which is exactly the four patches reported, and it happens on EVERY note
     * because every note starts a new sweep. Firefox updates more coarsely than Chrome, which is
     * why it was far worse there, and it is in the rendered signal, which is why it survives into
     * a recording while no discontinuity ever showed up in one.
     *
     * Measured as inharmonic energy DURING the sweep — the earlier test looked only after it had
     * finished, which is why this went unfound for so long:
     *
     *     patch     static   exponential ramp (was)   setTargetAtTime
     *     organ     0%       3.67%                    1.35%
     *     flute     0%       0.76%                    1.18%
     *     whistle   0%       0.53%                    0.67%
     *
     * ⚠️ STATIC WHERE THE SWEEP CANNOT BE HEARD — see `filterSweeps`, which decides it. Whistle
     * is the clearest case: its filter runs 4000->3200Hz while a C5 tops out at 1046Hz, three
     * octaves below, so the whole sweep was inaudible and pure cost.
     *
     * Everywhere else the sweep genuinely shapes the tone and has to stay, so it uses
     * setTargetAtTime, which measured two and a half times cleaner than the ramp on organ and is
     * a truer shape for a filter decaying anyway.
     */
    const dest = Math.max(80, sh.filter.to)
    if (!filterSweeps(sh, freq)) {
      f.frequency.value = dest
    } else {
      f.frequency.setValueAtTime(sh.filter.from, at)
      f.frequency.setTargetAtTime(dest, at, Math.max(0.005, sh.d / 4))
    }
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

  /**
   * ⚠️ THE CLIPPER GOES BEFORE THE ENVELOPE, NOT AFTER IT. The partials' shares sum to 1, so what
   * reaches it never exceeds ±1 — the range its curve is drawn over — and the envelope after it
   * still decides the peak, so `level` keeps meaning what the note above says it means. Put after
   * the envelope it would see ±level, a different curve per voice, and a distorted note would
   * come out louder than its own level by however much the clipper squashed it.
   */
  let into: AudioNode = g
  if (sh.drive) {
    const shaper = c.createWaveShaper()
    shaper.curve = driveCurve(sh.drive)
    /* a hard curve makes harmonics above Nyquist that fold back down as noise; 2x keeps most out */
    shaper.oversample = '2x'
    shaper.connect(g)
    made.push(shaper)
    into = shaper
  }

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
      o.connect(into)
    } else {
      const sub = c.createGain()
      sub.gain.value = share
      o.connect(sub).connect(into)
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

  /* held: rings until something stops it. stop() pins a real end time on this same entry, so a
     note is counted once — while held, and then for exactly as long as its tail lasts. */
  const mine: Ringing = {
    at,
    a: sh.a,
    d: sh.d,
    peak: sh.level,
    target: Math.max(0.0001, sh.level * sh.s || 0.0001),
    tau: Math.max(0.005, sh.r / 5),
    off: Infinity,
    until: Infinity,
    /* whose sound this is, so the scaler can ask that bus what its fader is doing — see faderOf */
    part: partKey,
  }
  ringing.push(mine)

  const ends = sh.s > 0 ? Infinity : at + sh.a + sh.d + sh.r
  /* ⚠️ a one-shot returns early from stop(), so nothing there would ever close its entry —
     bell rings for over two seconds and would have held the headroom down for ever. */
  if (sh.s <= 0) mine.until = ends
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
      /* the tail is still audible after noteOff drops the voice — keep it in the sum until it
         has actually decayed, which is what the map could never express */
      mine.off = from
      mine.until = from + releaseSpan(sh) + 0.02
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
        /**
         * ⚠️ PUT BACK WHATEVER THE CANCEL DESTROYED, WITHOUT DATING ANYTHING IN THE PAST.
         *
         * cancelScheduledValues removes every event at or after `from` — including a ramp still
         * MID-FLIGHT whose end time merely happens to be later. Such a ramp governs the whole
         * segment it spans, so removing it does not trim the tail, it deletes the segment: the
         * parameter falls back to the last surviving event, the note drops to 0.0001, sits there
         * for the SAFE_START lookahead, then jumps to the release level. A hole followed by a step
         * out of silence, on every note let go before its attack or decay had finished.
         *
         * ⚠️ THE REPAIR IS ANCHORED AT `now`, NOT AT THE NOTE'S OWN OLD EVENTS, and that is a
         * Firefox lesson this file has already learned once. The version before this re-created
         * the destroyed segment by writing a setValueAtTime at `at + sh.a` — a moment in the PAST
         * — and an exponentialRamp across an extreme ratio. Chrome tolerates both. Firefox is far
         * stricter about automation dated behind the render position, and the note above about
         * cancelAndHoldAtTime describes exactly this trap: "no issues in Chrome, still issues in
         * Firefox — one engine running code the other never sees." Reported here as rapid whistle
         * keys sounding more like crackling than like whistle, on Firefox only.
         *
         * So: hold the value the envelope genuinely has NOW, then ramp it to where the envelope
         * would have been at `from`. Only the SAFE_START window is reconstructed — six
         * milliseconds, across which every one of these envelopes is straight to well within a
         * decibel — and everything before `now` is already rendered and cannot be affected.
         * No event is dated in the past, no ratio is extreme, and both engines see one shape.
         */
        g.gain.cancelScheduledValues(from)
        /**
         * ⚠️ RE-RAMP FROM THE EVENT THAT SURVIVED, rather than inserting a new anchor. This is
         * the click on short notes, and it is the one rapid playing lands on constantly.
         *
         * cancelScheduledValues removes every event at or after `from`, including a ramp still
         * mid-flight. Release a note inside its attack and the attack ramp goes — but the
         * `setValueAtTime(0.0001, at)` that started it does NOT, because `at` is earlier. So the
         * gain holds at 0.0001 from the note's start until whatever is scheduled next, and then
         * jumps. Measured on organ across its 12ms attack, as a multiple of the steepest step the
         * waveform can legally take: held 1ms x2.4, 3ms x7.1, 5ms x11.3, 8ms x11.3 — a jump from
         * near-silence to full level in one sample. From 12ms on, x1.0.
         *
         * A ramp to `level` at `from` anchored on that surviving event reproduces the original
         * segment EXACTLY, because level is defined as the envelope's own value at `from`: the
         * attack is a straight line from the same anchor, and an exponential from peak to level
         * over the shortened span is the same curve as one from peak to target over the full
         * decay, evaluated up to `from`.
         *
         * ⚠️ And nothing here is dated in the past. The anchors are events the note scheduled for
         * itself when it started, which is ordinary; the earlier attempt at this INSERTED a
         * setValueAtTime behind the render head, which is the Firefox trap the cancelAndHold note
         * above describes. Ramping onto an existing anchor avoids both faults at once.
         */
        if (from < at + sh.a) {
          g.gain.linearRampToValueAtTime(Math.max(0.0001, level), from)
        } else if (from < at + sh.a + sh.d) {
          g.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), from)
        } else {
          g.gain.setValueAtTime(Math.max(0.0001, level), from)
        }
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
        /**
         * ⚠️ A FLOOR UNDER THE RELEASE, because past a certain speed a tonal note cannot stop
         * without you hearing it stop. This is not a defect being worked around: rendered
         * against an exponential decay computed by hand, Web Audio's release matches it to
         * within 0.07%, so the curve is already mathematically perfect. The audible click is
         * the physics of ending a near-sine quickly — a fast amplitude change broadens the
         * spectrum whether the maths is ideal or not.
         *
         * Measured as energy away from the note's own partials, against a 33.3% floor from a
         * steady tone that is not decaying at all: tau 18ms gives 42.2%, tau 40ms 35.5%, tau
         * 80ms 33.9%. So most of the splatter is gone by 40ms and it is at the floor by 80.
         *
         * ⚠️ Which patches this touches is exactly the complaint. Sorted by release speed, the
         * sustaining patches begin organ (tau 18ms, sustain 1.00), clav, reed, bass, whistle
         * (36ms), lead, flute (44ms) — and organ, whistle and flute are three of the four
         * reported. Organ is the extreme on every axis at once: the most level to lose, in the
         * least time, with the purest spectrum to lose it in. Everything reported as fine is
         * either a one-shot that never takes this path, or rich enough to mask it.
         *
         * Only the fast end moves. Cello at 90ms, strings at 110, pad at 220 and drone at 480
         * are already past the floor and keep the release they were written with.
         */
        const tau = releaseTau(sh)
        g.gain.setTargetAtTime(0.0001, from, tau)
        /**
         * ⚠️ AND THEN END IT. setTargetAtTime approaches its target forever and never
         * arrives, so the parameter stays in automation for as long as the node exists — computed
         * every sample, on every voice ever released, with nothing to stop it. The ramp it
         * replaced at least finished. Pinning the value at the moment the oscillators stop closes
         * the automation off; by then the curve is at about 0.7% of where the release started,
         * some -43dB, so the step down to the floor is far below anything audible.
         */
        /**
         * ⚠️ LAND ON EXACTLY ZERO, RATHER THAN STEPPING TO 0.0001 AND STOPPING.
         *
         * This was a hard `setValueAtTime(0.0001)` at the same instant the oscillators stop and
         * the nodes disconnect — reasoned to be inaudible because the curve is at about 0.7% by
         * then. It is quiet, but it is a STEP, and a step is broadband no matter how small: it
         * lands in the one moment of the note when nothing is left to mask it.
         *
         * Measured on organ, the worst sample-to-sample step per 20ms of the tail runs 0.000716,
         * 0.000416, 0.000273 — decaying smoothly — and then JUMPS to 0.000567 in the slice
         * containing this cut, before collapsing to 0.000088 after. A third of the remaining
         * signal, discarded in one sample.
         *
         * That also matches the shape of the report: it happens on every instrument, but it is
         * only reliably audible on the sustained near-sine patches, where the tail is a clean
         * tone and a broadband tick has nothing to hide in.
         *
         * So the last stretch is ramped to true zero instead. The anchor is computed from the
         * release curve rather than read from the engine — the same reasoning as the release
         * itself: setTargetAtTime is a shape we chose from numbers we still hold, so its value at
         * any instant is arithmetic. Landing at 0 makes stopping the oscillators silent by
         * construction, because there is nothing left to cut.
         */
        const fade = 0.02
        const tEnd = from + releaseSpan(sh) + 0.02
        const tFade = tEnd - fade
        const vFade = 0.0001 + (Math.max(0.0001, level) - 0.0001) * Math.exp(-(tFade - from) / tau)
        g.gain.setValueAtTime(Math.max(0.0000001, vFade), tFade)
        g.gain.linearRampToValueAtTime(0, tEnd)
      } catch {
        /* context went away */
      }
      for (const o of oscs) {
        try {
          o.stop(from + releaseSpan(sh) + 0.02)
        } catch {
          /* already stopped */
        }
      }
    },
  }
  voices.set(id, voice)
  applyPoly(c)

  // a patch with no sustain releases itself, so a click-and-hold on a pluck still ends
  if (sh.s <= 0) {
    const life = (sh.a + sh.d + sh.r + 0.1) * 1000
    window.setTimeout(() => {
      if (voices.get(id) === voice) {
        voices.delete(id)
        // a pluck ends itself, so nothing else would give the headroom back
        if (ctx) applyPoly(ctx)
      }
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
  applyPoly(c)
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
/**
 * Anything that GENERATES notes on its own, so it can be told to stop generating them.
 *
 * ⚠️ STOPPING VOICES IS NOT STOPPING A PLAYER. stopLive silences what is sounding right now,
 * which is the whole job when the sound comes from a held key — but a thing that plays a note
 * every 150ms simply plays the next one, so the dock's stop button did nothing you could hear for
 * longer than a step. Found on the home page sequencer: pressing stop made it stutter, not stop.
 *
 * So there are two halves and both are needed. The voices die here, and every registered loop is
 * told to put itself away.
 */
const stopSubs = new Set<() => void>()

/** Register a loop to be switched off by stopLive / allNotesOff. Returns the unsubscribe. */
export function onStopAll(fn: () => void): () => void {
  stopSubs.add(fn)
  return () => stopSubs.delete(fn)
}

function tellLoopsToStop() {
  for (const fn of [...stopSubs]) {
    try {
      fn()
    } catch {
      /* one bad listener must not stop the rest being silenced */
    }
  }
}

export function stopLive() {
  tellLoopsToStop()
  const c = ctx
  if (!c) return
  for (const [id, v] of [...voices]) {
    if (!id.startsWith('k:') && !id.startsWith('p:')) continue
    v.stop(c.currentTime + SAFE_START, true)
    voices.delete(id)
  }
  applyPoly(c)
}

/** Panic — everything off. Worth having the moment a stuck note happens, which it will. */
export function allNotesOff() {
  tellLoopsToStop()
  const c = ctx
  if (!c) return
  for (const [, v] of voices) v.stop(c.currentTime + SAFE_START, true)
  voices.clear()
  ringing.length = 0
  applyPoly(c)
}

/**
 * How hard the limiter is working right now, in dB. 0 is not at all; -6 means it is pulling the
 * signal down by six decibels at this instant.
 *
 * ⚠️ THIS IS THE NUMBER THE HEALTH STRIP WAS MISSING, and its absence is why the strip always
 * read clean while the instrument audibly crackled. That strip taps the analyser POST-limiter and
 * counts samples at or above 0.985 — but keeping the signal below that is precisely the
 * limiter's job, so the clip counter can essentially never fire no matter how badly the mix is
 * overdriven. The fault and the detector were on opposite sides of the same node.
 *
 * DynamicsCompressorNode has exposed `reduction` all along: a read-only dB figure, computed by
 * the engine, free to read. It is the difference between "the speakers are fine" (true, and
 * useless) and "the limiter is flattening 6dB off everything you play" (the actual complaint).
 */
export function limiterReduction(): number {
  const l = peak as DynamicsCompressorNode | null
  return l && typeof (l as DynamicsCompressorNode).reduction === 'number'
    ? (l as DynamicsCompressorNode).reduction
    : 0
}

/**
 * Where a sound that is not one of the SHAPES plugs in — the singing prototype (singer.ts).
 *
 * ⚠️ THROUGH A PART'S BUS, LIKE EVERY NOTE, so the voice gets what every instrument gets for free:
 * the part's effects and level, the polyphony headroom, the limiter, the instrument's volume, the
 * analyser the room draws and measures from, and the call broadcast. A voice wired straight to the
 * speakers would be the one sound in the room the volume slider could not reach.
 */
export function partInput(part: string, fx: Fx, gain?: number): AudioNode {
  const c = ensure()
  resumeAudio()
  return busFor(c, part, fx, gain).in
}

/**
 * The post-limiter node, for the debug recorder — the same fork the visualiser draws from, so a
 * capture is the signal your speakers were asked for rather than an idealised one.
 */
export function outputTap(): AudioNode | null {
  return peak
}

/**
 * Loudest sample arriving at the limiter since the last call, 0..n — CAN exceed 1.
 *
 * Reads the pre-limiter analyser, so unlike every other level in the strip this one says how hot
 * the mix actually is. Above about 0.708 (-3dBFS) the limiter starts working, and a limiter
 * working on near-sine patches is what the crackle turned out to be.
 */
let preScratch: Float32Array<ArrayBuffer> | null = null
export function preLimitPeak(): number {
  if (!preAnalyser) return 0
  if (!preScratch) preScratch = new Float32Array(preAnalyser.fftSize)
  preAnalyser.getFloatTimeDomainData(preScratch)
  let m = 0
  for (let i = 0; i < preScratch.length; i++) {
    const v = Math.abs(preScratch[i])
    if (v > m) m = v
  }
  return m
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
  preAnalyser = null
  preScratch = null
  noise = null
  // ⚠️ the impulse goes too. It belongs to the AudioContext that made it, and a buffer from a
  // closed context assigned to a new convolver is a silent reverb rather than an error.
  verbBuf = null
  fxOut = null
  peak = null
  ctx = null
}
