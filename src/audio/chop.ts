/**
 * Chopping a take up in time with the bar.
 *
 * ⚠️ THIS IS THE THING THAT NEEDED THE LOOP CLOCK. A gate that is not locked to the bar is a
 * tremolo; the whole character of the effect is that the chop lands exactly on the eighth and
 * therefore sounds deliberate rather than wobbly. There was nowhere to put it until a take was
 * scheduled against the transport — see the note in looper.ts about placing a take.
 *
 * ⚠️ IT RETURNS POINTS, IT DOES NOT TOUCH AUDIO. Everything here is arithmetic over one bar,
 * which means the shapes can be checked without a browser, a speaker or an AudioContext — and
 * the caller applies them with setValueAtTime and linearRampToValueAtTime, which are
 * sample-accurate in a way that no timer in JavaScript is. The same split the looper already
 * makes for notes: work out what happens when, then hand the clock a list.
 *
 * ⚠️ AND IT IS A GAIN SHAPE, NOT A TIME SHAPE. The original plugin this is named after does
 * both — it moves audio around in time as well as turning it up and down. Time is the harder
 * half and it is deliberately not here; `stutter` is the one time-like shape and it is done by
 * the caller re-triggering the buffer, because that is a scheduling decision rather than an
 * envelope. See stutterAt.
 */

export type ChopShape = 'off' | 'gate' | 'swell' | 'duck' | 'tremolo' | 'stutter'

export const CHOP_SHAPES: ChopShape[] = ['off', 'gate', 'swell', 'duck', 'tremolo', 'stutter']

/** How many slices a bar is cut into. Powers of two, because that is what a bar divides into. */
export const CHOP_RATES = [2, 4, 8, 16]

export type Chop = {
  shape: ChopShape
  /** slices per bar — one of CHOP_RATES */
  rate: number
  /** 0 none of it, 1 all of it */
  amount: number
}

export const NO_CHOP: Chop = { shape: 'off', rate: 8, amount: 1 }

/**
 * A moment the gain should be at a value.
 *
 * `snap` is the difference between a gate and a tremolo: true jumps, false slides. A jump is
 * still given a hair of ramp by the caller — see EDGE.
 */
export type ChopPoint = { t: number; v: number; snap: boolean }

/**
 * How long a hard edge takes.
 *
 * ⚠️ NOT ZERO, AND IT CANNOT BE. A gain that steps from 1 to 0 between two samples is a
 * discontinuity in the waveform, and a discontinuity is a click — audible on every single slice,
 * which at sixteen to the bar is a buzz rather than a rhythm. Two milliseconds is under the
 * threshold where the ear hears it as a fade and far over the one where it hears a click.
 */
export const EDGE = 0.002

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** blend a shape's value toward 1 by how much of the effect is asked for */
const mix = (v: number, amount: number) => 1 - (1 - v) * clamp01(amount)

/**
 * The gain envelope for ONE bar, in seconds from the start of that bar.
 *
 * @param bar how long a bar is, in seconds
 */
export function chopEnvelope(chop: Chop, bar: number): ChopPoint[] {
  const rate = Math.max(1, Math.round(chop.rate))
  if (chop.shape === 'off' || chop.shape === 'stutter' || chop.amount <= 0 || !(bar > 0)) return []
  const slice = bar / rate
  /* an edge cannot be longer than the slice it is inside, or a fast gate never reaches either end */
  const edge = Math.min(EDGE, slice / 4)
  const out: ChopPoint[] = []

  for (let i = 0; i < rate; i++) {
    const at = i * slice
    switch (chop.shape) {
      case 'gate': {
        /* on for the first half, off for the second, with the edges rounded just enough */
        out.push({ t: at, v: mix(1, chop.amount), snap: true })
        out.push({ t: at + slice / 2 - edge, v: mix(1, chop.amount), snap: false })
        out.push({ t: at + slice / 2, v: mix(0, chop.amount), snap: false })
        out.push({ t: at + slice - edge, v: mix(0, chop.amount), snap: false })
        break
      }
      case 'swell': {
        /* silent at the top of the slice, full by the end of it — a reverse gate */
        out.push({ t: at, v: mix(0, chop.amount), snap: true })
        out.push({ t: at + slice - edge, v: mix(1, chop.amount), snap: false })
        break
      }
      case 'duck': {
        /* ⚠️ THE PUMP. Hard down on the beat and back up across the slice, which is the shape
           a compressor keyed off a kick makes and the reason dance records breathe. */
        out.push({ t: at, v: mix(0.15, chop.amount), snap: true })
        out.push({ t: at + slice * 0.85, v: mix(1, chop.amount), snap: false })
        out.push({ t: at + slice - edge, v: mix(1, chop.amount), snap: false })
        break
      }
      case 'tremolo': {
        /**
         * ⚠️ SAMPLED, NOT SNAPPED. The other three are made of straight lines between corners,
         * so their corners ARE the shape. A sine has no corners, so it is walked at a handful
         * of points per slice and the ramps between them do the rest — eight is plenty at
         * these rates and keeps the automation list short enough to schedule every bar.
         */
        const steps = 8
        for (let k = 0; k < steps; k++) {
          const f = k / steps
          const v = (Math.cos(f * Math.PI * 2) + 1) / 2
          out.push({ t: at + f * slice, v: mix(v, chop.amount), snap: k === 0 && i === 0 })
        }
        break
      }
    }
  }
  /* close the bar so the last ramp has somewhere to arrive */
  const lastV = out.length ? out[out.length - 1].v : 1
  out.push({ t: bar, v: chop.shape === 'gate' ? mix(0, chop.amount) : lastV, snap: false })
  return out
}

/**
 * Where a stutter re-triggers, in seconds from the start of the bar.
 *
 * ⚠️ A TIME EFFECT IS A SCHEDULING DECISION, NOT AN ENVELOPE. Every other shape here turns the
 * audio up and down; this one plays the same sliver of it again and again, which cannot be done
 * with a gain node at any value. So it hands back the moments, and the caller starts a source at
 * each of them reading from the SAME offset — which is what makes it a repeat rather than a
 * chopped-up playthrough.
 *
 * ⚠️ AND IT ONLY REPEATS THE LAST QUARTER OF THE BAR at full amount, tapering to nothing at
 * zero. A stutter across a whole bar is not an effect, it is a different piece of music; the
 * useful version is the fill at the end of a phrase.
 */
export function stutterAt(chop: Chop, bar: number): { at: number; from: number; len: number }[] {
  if (chop.shape !== 'stutter' || chop.amount <= 0 || !(bar > 0)) return []
  const rate = Math.max(1, Math.round(chop.rate))
  const slice = bar / rate
  /* how much of the bar the stutter covers: a quarter at full, less below it */
  const covers = bar * 0.25 * clamp01(chop.amount)
  const begins = bar - covers
  const out: { at: number; from: number; len: number }[] = []
  for (let t = begins; t < bar - 1e-6; t += slice)
    out.push({ at: t, from: begins, len: Math.min(slice, bar - t) })
  return out
}
