import { sharedImpulse } from './synth'

/**
 * What a recorded voice can be put through.
 *
 * ⚠️ NATIVE NODES ONLY, AND THAT IS THE WHOLE DESIGN. Everything here is a BiquadFilter, a
 * DynamicsCompressor, a DelayNode or a Convolver — no hand-written DSP, no ScriptProcessor, no
 * worklet. A vocal chain made of the browser's own nodes runs on the audio thread, costs
 * approximately nothing on a phone, and cannot drift out of time with the loop. The moment one
 * of these needs a pitch shifter that changes, and it should be argued for on its own.
 *
 * ⚠️ AND IT IS NOT THE SYNTH'S CHAIN. makeBus in synth.ts does echo and space for a PART, with
 * a polyphony gain in front of it and a bus pool behind it, both of which are meaningless for a
 * recording. What is shared is the thing worth sharing: the reverb impulse, which is one buffer
 * for the whole app — see sharedImpulse.
 *
 * ⚠️ THE ORDER IS THE ORDER A VOICE WANTS. Tone before squeeze, because compressing first then
 * cutting the low end means the rumble you removed was already deciding how hard everything got
 * squashed. Double before the sends, so the echo repeats the doubled voice rather than only the
 * original. Sends last and in parallel, which is what a send is.
 */

export type VoiceFx = {
  /**
   * -1 warm, 0 as recorded, 1 thin.
   *
   * ⚠️ ONE KNOB FOR TWO FILTERS, because the two useful moves on a recorded voice are "less
   * rumble" and "more air", and nobody wants four sliders to make a phone recording listenable.
   */
  tone: number
  /** 0 to 1 — how hard it is held down. A voice is the thing that needs this most. */
  squeeze: number
  /** 0 to 1 — a second copy a few milliseconds late, which is what makes one voice sound like two */
  double: number
  echo: number
  /** seconds between repeats */
  echoTime: number
  space: number
}

export const PLAIN_VOICE: VoiceFx = {
  tone: 0,
  squeeze: 0,
  double: 0,
  echo: 0,
  echoTime: 0.3,
  space: 0,
}

export type VoiceChain = {
  in: GainNode
  out: GainNode
  set(fx: VoiceFx): void
  dispose(): void
}

/** the widest a double can be before it stops being a double and starts being an echo */
const DOUBLE_MAX = 0.042

export function makeVoiceChain(ctx: AudioContext, to: AudioNode): VoiceChain {
  const input = ctx.createGain()
  const out = ctx.createGain()

  const low = ctx.createBiquadFilter()
  low.type = 'highpass'
  low.frequency.value = 20
  const air = ctx.createBiquadFilter()
  air.type = 'highshelf'
  air.frequency.value = 3200
  air.gain.value = 0

  const squash = ctx.createDynamicsCompressor()
  /* a vocal setting rather than a limiter: low ratio, slow-ish release, knee wide enough that
     it is not audible as it comes in */
  squash.threshold.value = 0
  squash.knee.value = 30
  squash.ratio.value = 2
  squash.attack.value = 0.006
  squash.release.value = 0.16

  /* the double: one short delay, slightly detuned by being a delay that moves */
  const twin = ctx.createDelay(0.1)
  twin.delayTime.value = 0.022
  const twinGain = ctx.createGain()
  twinGain.gain.value = 0

  const delay = ctx.createDelay(1.2)
  const echoWet = ctx.createGain()
  const fb = ctx.createGain()
  const verb = ctx.createConvolver()
  verb.buffer = sharedImpulse(ctx)
  const verbWet = ctx.createGain()

  /**
   * ⚠️ THE DRY PATH HAS A GAIN OF ITS OWN, so the double can be a BLEND rather than an
   * addition. Adding a second copy at 0.75 on top of a dry at 1 is 1.75 of signal, and the
   * destination clips at 1 — measured at 1.249 on a loud source, which is a doubled voice that
   * also crackles. Leaning the dry back as the twin comes up keeps the pair near unity, which
   * is what doubling is supposed to sound like anyway: one voice, thicker, not two voices.
   */
  const dry = ctx.createGain()
  input.connect(low).connect(air).connect(squash)
  squash.connect(dry).connect(out)
  squash.connect(twin).connect(twinGain).connect(out)

  /**
   * ⚠️ UNPLUGGED WHEN THEY ARE NOT IN USE, which synth.ts learned the hard way and explains at
   * length: Web Audio has no bypass, so any node pulled toward the destination is processed on
   * every render quantum whether or not its gain is zero. A convolution against 2.2 seconds of
   * stereo is the most expensive thing in either graph, and a delay feeding itself is a loop
   * that never rests. Both are off by default here too, so leaving them wired would cost a
   * phone the same constant tax for silence. The gate is on the WET path, one node late, so the
   * tail is intact the moment it is plugged back in.
   */
  let echoOn = false
  let spaceOn = false
  squash.connect(delay)
  delay.connect(echoWet)
  delay.connect(fb).connect(delay)
  squash.connect(verb).connect(verbWet)
  out.connect(to)

  let dead = false

  return {
    in: input,
    out,
    set(fx) {
      if (dead) return
      const t = Math.max(-1, Math.min(1, fx.tone))
      /* warm rolls a little off the top, thin lifts it and pulls the bottom out */
      low.frequency.value = t > 0 ? 80 + t * 220 : 20 + (1 + t) * 60
      air.gain.value = t * 6
      /**
       * ⚠️ THE BOOST IS PAID FOR ON THE WAY OUT, or the top of the range clips. A 6dB
       * high shelf is a 2x gain on everything above 3.2kHz, and on a bright source that is
       * enough to push the whole chain past full scale — measured on broadband noise, a flat
       * peak of 0.748 became 1.377 at tone 1, which is clipping at the destination rather than
       * a brighter voice. Backing the output off by the same amount makes the control an EQ,
       * which is what it is meant to be, instead of an EQ and a volume at once.
       */
      out.gain.value = 1 / (1 + Math.max(0, t) * 0.78)

      const sq = Math.max(0, Math.min(1, fx.squeeze))
      squash.threshold.value = -6 - sq * 26
      squash.ratio.value = 1.5 + sq * 5

      const dbl = Math.max(0, Math.min(1, fx.double))
      dry.gain.value = 1 - dbl * 0.38
      twinGain.gain.value = dbl * 0.62
      twin.delayTime.value = 0.012 + dbl * (DOUBLE_MAX - 0.012)

      const e = Math.max(0, Math.min(1, fx.echo))
      delay.delayTime.value = Math.max(0.02, Math.min(1.2, fx.echoTime))
      echoWet.gain.value = e * 0.5
      fb.gain.value = e * 0.45
      if (e > 0 && !echoOn) {
        echoWet.connect(out)
        echoOn = true
      } else if (e <= 0 && echoOn) {
        try {
          echoWet.disconnect(out)
        } catch {
          /* already apart */
        }
        echoOn = false
      }

      const s = Math.max(0, Math.min(1, fx.space))
      verbWet.gain.value = s * 0.7
      if (s > 0 && !spaceOn) {
        verbWet.connect(out)
        spaceOn = true
      } else if (s <= 0 && spaceOn) {
        try {
          verbWet.disconnect(out)
        } catch {
          /* already apart */
        }
        spaceOn = false
      }
    },
    dispose() {
      dead = true
      for (const n of [
        input,
        low,
        air,
        squash,
        twin,
        twinGain,
        delay,
        echoWet,
        fb,
        verb,
        verbWet,
        out,
      ])
        try {
          n.disconnect()
        } catch {
          /* the context went away under it */
        }
    },
  }
}
