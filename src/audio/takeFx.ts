import { SAFE_START, sharedImpulse } from './synth'

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
   * -1 warm, 0 the default, 1 thin.
   *
   * ⚠️ ONE KNOB FOR TWO FILTERS, because the two useful moves on a recorded voice are "less
   * rumble" and "more air", and nobody wants four sliders to make a phone recording listenable.
   *
   * ⚠️ AND CENTRE IS NOT "AS RECORDED", WHICH IS WHAT THIS LINE SAID FOR AS LONG AS NOTHING
   * COULD ASK IT. The shelf really is flat at 0, but the highpass is at **80Hz** there and only
   * opens to 20Hz at full warm — read the else branch in voiceTargets: it interpolates 20 → 80
   * across the warm half, which only makes sense if centre is meant to be an ordinary rumble
   * filter. That is the right default for a phone recording of a voice and the wrong sentence
   * to describe it with; it is audible on anything with real low end in it, which a take can
   * easily be. The slider's own on-screen hint claims nothing about centre and is fine.
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

/** the narrowest a double can be and still be heard as thickness rather than as blur */
const DOUBLE_MIN = 0.012
/** the widest a double can be before it stops being a double and starts being an echo */
const DOUBLE_MAX = 0.042

/**
 * ⚠️ THE DELAY LINE'S CAPACITY AND THE CLAMP ON IT WERE TWO COPIES OF ONE NUMBER — the shape
 * CLAUDE.md names as a bound typed in beside the table that owns the answer.
 *
 * A DelayNode handed a delayTime past the maximum it was BUILT with does not throw and does not
 * warn: it clamps, in the audio thread, silently. So raising the slider's ceiling without
 * raising `createDelay()` would give an echo-time control that simply stops responding partway
 * along, with nothing on screen and nothing in the console to say why. One constant, read by
 * both the node and the clamp.
 */
export const ECHO_MAX = 1.2
/** under this a delay stops being an echo and becomes a comb filter on the voice */
export const ECHO_MIN = 0.02

/**
 * Every number the chain is set to, worked out from the six knobs.
 *
 * ⚠️ SEPARATE FROM THE NODES ON PURPOSE, and it is the same move play.ts and designation.ts
 * each describe in their own headers. Everything in makeVoiceChain needs an AudioContext, which
 * the test runner has not got — so for as long as this arithmetic lived inside `set()` there was
 * no way to ask it anything, and the claims written around it (that Flat is flat, that a tone
 * boost is paid for on the way out, that the feedback cannot run away) were prose. Prose cannot
 * be run. They are assertions in takeFx.test.ts now.
 *
 * ⚠️ AND IT IS TOTAL, which the inline version was not. `Math.max(-1, Math.min(1, undefined))`
 * is NaN, and Web Audio answers a NaN on an AudioParam with SILENCE rather than an error — the
 * exact trap synth.ts records against a layer saved before Tone existed. A take is restored from
 * a song file, so a missing or malformed knob is reachable from disk, not only from a slider
 * that can never produce one.
 */
export type VoiceTargets = {
  /** highpass corner, Hz */
  lowHz: number
  /** high shelf, dB */
  airDb: number
  /** output trim, linear */
  outGain: number
  /** compressor threshold, dB */
  threshold: number
  ratio: number
  dryGain: number
  twinGain: number
  /** seconds */
  twinDelay: number
  /** seconds */
  echoDelay: number
  echoWet: number
  feedback: number
  verbWet: number
}

const fin = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function voiceTargets(fx: VoiceFx): VoiceTargets {
  const t = clamp(fin(fx?.tone, 0), -1, 1)
  const sq = clamp(fin(fx?.squeeze, 0), 0, 1)
  const dbl = clamp(fin(fx?.double, 0), 0, 1)
  const e = clamp(fin(fx?.echo, 0), 0, 1)
  const s = clamp(fin(fx?.space, 0), 0, 1)
  return {
    /* warm rolls a little off the top, thin lifts it and pulls the bottom out */
    lowHz: t > 0 ? 80 + t * 220 : 20 + (1 + t) * 60,
    airDb: t * 6,
    /**
     * ⚠️ THE BOOST IS PAID FOR ON THE WAY OUT, or the top of the range clips. A 6dB high shelf
     * is a 2x gain on everything above 3.2kHz, and on a bright source that is enough to push the
     * whole chain past full scale — measured on broadband noise, a flat peak of 0.748 became
     * 1.377 at tone 1, which is clipping at the destination rather than a brighter voice.
     * Backing the output off makes the control an EQ, which is what it is meant to be, instead
     * of an EQ and a volume at once.
     *
     * ⚠️ IT IS NOT EXACT, and the test says so rather than pretending otherwise: 0.78 cancels
     * the boost for the BROADBAND case it was measured on, not for a pure tone sitting entirely
     * above the shelf corner, where 10^(6/20) / 1.78 still leaves **1.12**. A singing voice has
     * very little full-scale energy above 3.2kHz, so that worst case is theoretical — but it is
     * a worst case, not an absence of one, and the number belongs written down.
     */
    outGain: 1 / (1 + Math.max(0, t) * 0.78),
    threshold: -6 - sq * 26,
    ratio: 1.5 + sq * 5,
    dryGain: 1 - dbl * 0.38,
    twinGain: dbl * 0.62,
    twinDelay: DOUBLE_MIN + dbl * (DOUBLE_MAX - DOUBLE_MIN),
    echoDelay: clamp(fin(fx?.echoTime, PLAIN_VOICE.echoTime), ECHO_MIN, ECHO_MAX),
    echoWet: e * 0.5,
    /* ⚠️ well under 1. At 1 an echo never decays and the delay line builds until it clips —
       a runaway that outlives the take that started it and has no obvious cause. */
    feedback: e * 0.45,
    verbWet: s * 0.7,
  }
}

export function makeVoiceChain(ctx: AudioContext, to: AudioNode): VoiceChain {
  const input = ctx.createGain()
  const out = ctx.createGain()

  const low = ctx.createBiquadFilter()
  low.type = 'highpass'
  const air = ctx.createBiquadFilter()
  air.type = 'highshelf'
  air.frequency.value = 3200

  const squash = ctx.createDynamicsCompressor()
  /* a vocal setting rather than a limiter: low ratio, slow-ish release, knee wide enough that
     it is not audible as it comes in. These three are not on a knob, so they are set once. */
  squash.knee.value = 30
  squash.attack.value = 0.006
  squash.release.value = 0.16

  /* the double: one short delay, slightly detuned by being a delay that moves */
  const twin = ctx.createDelay(0.1)
  const twinGain = ctx.createGain()

  const delay = ctx.createDelay(ECHO_MAX)
  const echoWet = ctx.createGain()
  const fb = ctx.createGain()
  const verb = ctx.createConvolver()
  verb.buffer = sharedImpulse(ctx)
  const verbWet = ctx.createGain()

  /**
   * ⚠️ THE CHAIN IS BORN FLAT, FROM THE SAME FUNCTION THAT MOVES IT — and it was not before.
   *
   * Every one of these used to be a literal written beside the node, and three of them were
   * not written at all: a GainNode is born at **unity**, so `echoWet`, `fb` and `verbWet` each
   * started at 1 and `delay.delayTime` at 0. `fb` at 1 is a delay line feeding itself at full
   * strength; it never bit only because looper.ts calls `set(PLAIN_VOICE)` on the very next
   * line and nothing is connected to `input` yet. That is safety living in the calling order
   * rather than in the graph, and ramping `set()` turns a zero-length window into a real one.
   *
   * The ones that WERE written had quietly drifted from flat: the compressor was built at
   * threshold 0 / ratio 2 where flat is -6 / 1.5, the twin delay at 22ms where flat is 12ms,
   * and the highpass at 20Hz where flat is 80. Invisible while `set()` assigned, because it
   * landed in the same tick — and a 60ms glide from the wrong place once it ramps.
   *
   * So there is one description of flat and the constructor reads it too. Instantly: this is
   * the chain's initial state, not a move, and there is nothing yet to click.
   */
  const flat = voiceTargets(PLAIN_VOICE)
  low.frequency.value = flat.lowHz
  air.gain.value = flat.airDb
  out.gain.value = flat.outGain
  squash.threshold.value = flat.threshold
  squash.ratio.value = flat.ratio
  twin.delayTime.value = flat.twinDelay
  twinGain.gain.value = flat.twinGain
  delay.delayTime.value = flat.echoDelay
  echoWet.gain.value = flat.echoWet
  fb.gain.value = flat.feedback
  verbWet.gain.value = flat.verbWet

  /**
   * ⚠️ THE DRY PATH HAS A GAIN OF ITS OWN, so the double can be a BLEND rather than an
   * addition. Adding a second copy at 0.75 on top of a dry at 1 is 1.75 of signal, and the
   * destination clips at 1 — measured at 1.249 on a loud source, which is a doubled voice that
   * also crackles. Leaning the dry back as the twin comes up keeps the pair near unity, which
   * is what doubling is supposed to sound like anyway: one voice, thicker, not two voices.
   */
  const dry = ctx.createGain()
  dry.gain.value = flat.dryGain
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
  squash.connect(delay)
  delay.connect(echoWet)
  delay.connect(fb).connect(delay)
  squash.connect(verb).connect(verbWet)
  out.connect(to)

  /**
   * ⚠️ RAMPED, NEVER ASSIGNED — and this was measured, because the obvious reading is that a
   * knob is a setting and a setting is an assignment.
   *
   * `p.value = x` is a step in the waveform at the instant it lands, and on a delay line it is
   * not a step but a SPLICE: the read head jumps to a different part of the signal and the two
   * sides have nothing to do with each other. Measured in the Browser pane on 6 Nov 2026 with
   * an OfflineAudioContext, a 220Hz sine and ONE notch of the echo-time slider — 0.02s, the
   * smallest move the control can make — worst case over six phases:
   *
   *     delayTime stepped   1.813      <- sixty-three times the largest step the source can make
   *     delayTime ramped    0.02880
   *     out.gain stepped    0.03229
   *     out.gain ramped     0.02880
   *     a 220Hz sine's own slew at 48k is 2*pi*f/sr = 0.02880 per sample
   *
   * So a ramp at slider granularity is not merely better, it is exactly indistinguishable from
   * the signal doing nothing — while the step is an audible click, forty of them along the
   * slider.
   *
   * ⚠️ AND THE FIRST RUN OF THAT PROBE SAID THE OPPOSITE, because the fixture neutralised the
   * one dimension under test: 0.30 → 0.10 is exactly 44 whole periods of 220Hz, so the splice
   * came out phase-continuous and the STEP measured clean, while the ramp — asked to cover
   * 0.2s in 20ms, ten times any move a slider can make — measured terrible. The honest magnitude
   * is one notch, and it reverses the answer.
   *
   * synth.ts's bus has ramped since it was written and explains why at length; this file is the
   * one that was left behind. `+ SAFE_START` for the reason given there: currentTime is behind
   * the render head, so a target time already passed is evaluated partway along its own curve
   * and JUMPS to wherever the curve had got to instead of gliding from where it is.
   */
  const SLEW = 0.02
  const ride = (p: AudioParam, v: number) => {
    try {
      p.setTargetAtTime(v, ctx.currentTime + SAFE_START, SLEW)
    } catch {
      p.value = v
    }
  }

  /**
   * ⚠️ THE UNPLUG HAS TO WAIT FOR THE RAMP, which is the half of this change that is not
   * free. While the wet gain was assigned, it was already 0 at the moment the gate pulled the
   * plug and the disconnect was silent. Ramped, it is still most of the way up — so cutting the
   * edge there would replace the zipper noise with one much louder click at exactly the moment
   * somebody turns an effect off. Same shape and same timings as echoConnect/verbConnect in
   * synth.ts: long enough for the longest delay plus its feedback, and for 2.2s of impulse plus
   * the fade that is emptying it.
   */
  const gate = (node: GainNode, hold: number) => {
    let live = false
    let off = 0
    return {
      want(on: boolean) {
        if (on) {
          if (off) {
            clearTimeout(off)
            off = 0
          }
          if (!live) {
            node.connect(out)
            live = true
          }
        } else if (live && !off) {
          off = window.setTimeout(() => {
            off = 0
            live = false
            try {
              node.disconnect(out)
            } catch {
              /* already apart */
            }
          }, hold)
        }
      },
      /* ⚠️ cleared on dispose, or a chain lifted off the loop keeps a timer — and with it
         every node it closes over — alive for three seconds after it was thrown away. */
      stop() {
        if (off) clearTimeout(off)
        off = 0
      },
    }
  }
  const echoGate = gate(echoWet, 3000)
  const spaceGate = gate(verbWet, 2600)

  let dead = false

  return {
    in: input,
    out,
    set(fx) {
      if (dead) return
      const v = voiceTargets(fx)
      ride(low.frequency, v.lowHz)
      ride(air.gain, v.airDb)
      ride(out.gain, v.outGain)
      ride(squash.threshold, v.threshold)
      ride(squash.ratio, v.ratio)
      ride(dry.gain, v.dryGain)
      ride(twinGain.gain, v.twinGain)
      ride(twin.delayTime, v.twinDelay)
      ride(delay.delayTime, v.echoDelay)
      ride(echoWet.gain, v.echoWet)
      ride(fb.gain, v.feedback)
      ride(verbWet.gain, v.verbWet)
      /* ⚠️ the gates read the WET TARGET, not the knob, so "is anything being heard through
         this branch" is one question with one answer — the bug shape this repository keeps
         finding is a control derived from a setting sitting next to a control derived from
         the thing the setting produces. */
      echoGate.want(v.echoWet > 0)
      spaceGate.want(v.verbWet > 0)
    },
    dispose() {
      dead = true
      echoGate.stop()
      spaceGate.stop()
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
