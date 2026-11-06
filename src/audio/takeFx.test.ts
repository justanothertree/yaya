import { describe, expect, it } from 'vitest'
import { ECHO_MAX, ECHO_MIN, PLAIN_VOICE, voiceTargets, type VoiceFx } from './takeFx'

/**
 * What a recorded voice is put through, asked instead of assumed.
 *
 * ⚠️ NONE OF THIS COULD BE ASKED UNTIL THE ARITHMETIC CAME OUT OF THE GRAPH. `makeVoiceChain`
 * needs an AudioContext and the runner has not got one, so every claim in that file — that Flat
 * is flat, that a tone boost is paid for on the way out, that the feedback cannot run away, that
 * the echo time fits the line it is written into — was a sentence in a comment. Four of them,
 * all load-bearing, none of them runnable. This is the same move `server/lib/settings.mjs` and
 * `supabase/functions/pictures/verdict.ts` each are, for the same reason.
 *
 * ⚠️ AND THE EXPECTATIONS ARE WRITTEN FROM WHAT THE WORLD REQUIRES, never from the sums in
 * voiceTargets — a test built from the same arithmetic as the code agrees with the code,
 * including when the code is wrong. "A delay line at unity feedback never decays" is a fact
 * about delay lines. "feedback === echo * 0.45" is a copy of the implementation.
 */

const knob = (over: Partial<VoiceFx>): VoiceFx => ({ ...PLAIN_VOICE, ...over })
const sweep = (n = 51) => Array.from({ length: n }, (_, i) => i / (n - 1))

describe('flat is flat', () => {
  /**
   * The Flat button's own title is "Back to how it was recorded". If any of these is not its
   * neutral value then pressing it leaves a colour on the take and the label is a lie — the
   * exact failure this repository keeps finding in copy that stopped matching its feature.
   */
  it('PLAIN_VOICE is a true bypass, not a quiet one', () => {
    const v = voiceTargets(PLAIN_VOICE)
    expect(v.dryGain).toBe(1) // the recording arrives whole
    expect(v.outGain).toBe(1) // and leaves at the level it came in
    expect(v.airDb).toBe(0) // no shelf
    expect(v.twinGain).toBe(0) // no second copy
    expect(v.echoWet).toBe(0)
    expect(v.feedback).toBe(0)
    expect(v.verbWet).toBe(0)
  })

  /**
   * ⚠️ THE ONE PLACE IT IS NOT A BYPASS, AND THIS TEST FOUND IT BY FAILING. Written to assert
   * that centre leaves the low end alone — because the type's own doc said "0 as recorded" —
   * it came back with **80Hz**. The highpass interpolates 20 → 80 across the WARM half and
   * then climbs to 300 across the thin half, so centre is an ordinary rumble filter and full
   * warm is the position that turns it off.
   *
   * That is a sensible default for a phone recording of a voice and it is deliberate: a knob
   * meant to be off at centre would have had `: 20` rather than an interpolation. So the code
   * is right and the sentence above it was wrong, which is the whole reason for lifting this
   * arithmetic somewhere a test can reach it — three lines of comment had been contradicting
   * three lines of code since the file was written, with nothing able to say so.
   *
   * Left as it is rather than "fixed": where the corner sits is a tone decision about every
   * take anybody has already recorded, and 80Hz on a voice is inaudible. It is NOT inaudible on
   * a take with real low end in it — a beatbox, a hummed bassline — and that is the open
   * question, recorded here rather than guessed at.
   */
  it('is a rumble filter at centre, and only full warm turns it off', () => {
    expect(voiceTargets(PLAIN_VOICE).lowHz).toBeCloseTo(80, 6)
    expect(voiceTargets(knob({ tone: -1 })).lowHz).toBeLessThan(25)
  })

  it('moves the corner one way only, with no step where the two halves meet', () => {
    let last: number | null = null
    for (const tone of sweep(81).map((t) => t * 2 - 1)) {
      const hz = voiceTargets(knob({ tone })).lowHz
      if (last !== null) {
        expect(hz).toBeGreaterThanOrEqual(last)
        /* continuity: the branch changes at 0, and a jump there would be a click in the
           middle of the slider's travel rather than at one of its ends. One step of this
           sweep is 0.025 of the knob, which is 5.5Hz on the steeper half. */
        expect(hz - last).toBeLessThan(10)
      }
      last = hz
    }
  })
})

describe('the echo cannot run away', () => {
  /**
   * A delay line whose feedback reaches 1 never decays: every repeat is as loud as the one
   * before it and the line fills until it clips. It outlives the take that started it, and
   * nothing on screen says where the noise is coming from. synth.ts caps its own at 0.6 and
   * explains this at length; the question here is whether the TAKE chain can be driven there.
   */
  it('keeps feedback under unity across the whole knob', () => {
    for (const echo of sweep()) {
      const fb = voiceTargets(knob({ echo })).feedback
      expect(fb).toBeLessThan(1)
      expect(fb).toBeGreaterThanOrEqual(0)
    }
  })

  it('cannot be driven past unity by a knob outside its range', () => {
    /* a song file is not a slider — it can carry anything that was ever written to it */
    expect(voiceTargets(knob({ echo: 9 })).feedback).toBeLessThan(1)
    expect(voiceTargets(knob({ echo: -4 })).feedback).toBeGreaterThanOrEqual(0)
  })
})

describe('the echo time fits the line it is written into', () => {
  /**
   * ⚠️ A DelayNode handed a delayTime past the maximum it was BUILT with clamps in the audio
   * thread: no throw, no warning, nothing in the console. So a ceiling raised on one side and
   * not the other is a slider that silently stops responding partway along. The node and the
   * clamp read one constant now, and this is the assertion that keeps them together.
   */
  it('never asks for more delay than the line holds', () => {
    for (const echoTime of [0, 0.3, 0.8, 1.2, 4, 90, -1]) {
      const d = voiceTargets(knob({ echoTime })).echoDelay
      expect(d).toBeLessThanOrEqual(ECHO_MAX)
      expect(d).toBeGreaterThanOrEqual(ECHO_MIN)
    }
  })

  it('never asks for zero, which inside a feedback loop is whatever the renderer feels like', () => {
    expect(voiceTargets(knob({ echoTime: 0 })).echoDelay).toBeGreaterThan(0)
  })

  it('covers everything the slider can produce', () => {
    /* TakesPanel's range is 0 to 0.8; a clamp that bit inside that would be a dead end of the
       control, which is the half of a clamp nobody notices */
    expect(voiceTargets(knob({ echoTime: 0.8 })).echoDelay).toBeCloseTo(0.8, 6)
    expect(voiceTargets(knob({ echoTime: 0.1 })).echoDelay).toBeCloseTo(0.1, 6)
  })
})

describe('tone is an EQ, not an EQ and a volume', () => {
  it('costs nothing at centre or warm — only the boost is paid for', () => {
    for (const tone of sweep().map((t) => -t)) expect(voiceTargets(knob({ tone })).outGain).toBe(1)
  })

  it('never gets louder as it gets brighter', () => {
    let last = Infinity
    for (const tone of sweep()) {
      const g = voiceTargets(knob({ tone })).outGain
      expect(g).toBeLessThanOrEqual(last + 1e-12)
      last = g
    }
  })

  /**
   * ⚠️ A MEASURED NUMBER, PINNED RATHER THAN DESCRIBED. The comment in takeFx.ts says the boost
   * is "paid for on the way out", which is true for the broadband source it was measured on and
   * NOT true for a pure tone sitting entirely above the 3.2kHz corner, where the shelf's full
   * 2x meets a trim of 1/1.78. That leaves 1.121 — a 1dB worst case on material a voice does
   * not really produce.
   *
   * It is here as a number rather than as prose because this is precisely the claim §2 of
   * CLAUDE.md is about: if somebody changes 6dB or 0.78, the figure moves, and a figure that
   * moves inside a comment moves silently. Failing this test is not a bug — it is the reminder
   * that the trade has been re-decided and the comment needs the new number.
   */
  it('leaves a worst case of 1.12 above the shelf corner, and no more', () => {
    const v = voiceTargets(knob({ tone: 1 }))
    const boost = Math.pow(10, v.airDb / 20)
    expect(boost * v.outGain).toBeCloseTo(1.121, 3)
    /* and the trim is doing most of the work: uncompensated this is very nearly 2x */
    expect(boost).toBeCloseTo(1.995, 3)
  })
})

describe('the double is a blend, not an addition', () => {
  /**
   * The comment this protects: a second copy at 0.75 laid on top of a dry at 1 is 1.75 of
   * signal into a destination that clips at 1, "measured at 1.249 on a loud source". The fix
   * was to lean the dry back as the twin comes up — so the property is that the pair stays
   * near unity, and that at the top neither copy is the real one.
   */
  it('ends with two equal copies rather than an original and a guest', () => {
    const v = voiceTargets(knob({ double: 1 }))
    expect(v.dryGain).toBeCloseTo(v.twinGain, 6)
  })

  it('never reaches the 1.75 that clipped', () => {
    for (const double of sweep()) {
      const v = voiceTargets(knob({ double }))
      expect(v.dryGain + v.twinGain).toBeLessThan(1.3)
    }
  })

  it('stays a double rather than becoming a short echo', () => {
    /* past ~50ms a second copy stops being heard as thickness and starts being heard as a
       separate event — which is what the echo control is for */
    for (const double of sweep()) {
      expect(voiceTargets(knob({ double })).twinDelay).toBeLessThan(0.05)
      expect(voiceTargets(knob({ double })).twinDelay).toBeGreaterThan(0)
    }
  })
})

describe('a take restored from a file', () => {
  /**
   * ⚠️ NaN ON AN AudioParam IS SILENCE, not an error — synth.ts records this against a layer
   * saved before Tone existed, and a take carries its fx into the song file the same way. A
   * knob that is missing, null, or a string that did not parse must not be able to mute the
   * whole chain, which is what `Math.max(-1, Math.min(1, undefined))` quietly did.
   */
  it('cannot be muted by a knob that is missing or malformed', () => {
    const broken = { echoTime: 0.3 } as unknown as VoiceFx
    const v = voiceTargets(broken)
    for (const [k, n] of Object.entries(v)) {
      expect(Number.isFinite(n), `${k} is ${n}`).toBe(true)
    }
    expect(v.dryGain).toBe(1)
    expect(v.outGain).toBe(1)
  })

  it('falls back to a usable echo time rather than to zero', () => {
    const v = voiceTargets({ ...PLAIN_VOICE, echoTime: NaN })
    expect(v.echoDelay).toBe(PLAIN_VOICE.echoTime)
  })
})

describe('every send answers its own knob', () => {
  it('rises with it and never on its own', () => {
    const sends: [keyof VoiceFx, (v: ReturnType<typeof voiceTargets>) => number][] = [
      ['echo', (v) => v.echoWet],
      ['echo', (v) => v.feedback],
      ['space', (v) => v.verbWet],
      ['double', (v) => v.twinGain],
    ]
    for (const [key, read] of sends) {
      expect(read(voiceTargets(knob({ [key]: 0 })))).toBe(0)
      let last = -1
      for (const n of sweep()) {
        const got = read(voiceTargets(knob({ [key]: n })))
        expect(got).toBeGreaterThanOrEqual(last)
        last = got
      }
      expect(last).toBeGreaterThan(0)
    }
  })
})
