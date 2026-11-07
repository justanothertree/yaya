/**
 * POLYPHONY SCALING — how loud one voice is allowed to be, given what else is sounding.
 *
 * ⚠️ IT IS ITS OWN FILE BECAUSE THE RULE IT KEEPS WAS WRONG FOR TWO MONTHS AND NOTHING COULD ASK
 * ABOUT IT. This arithmetic lived in the middle of synth.ts, which opens an AudioContext and is
 * 98kB of graph building, so `npm run test` could not reach it — and the only way to find out
 * what it did was to paste a probe into a browser and listen to the answer. It had a plain defect
 * all that time: the sum was measured in the PATCH's level and the signal in the LAYER's, so a
 * backing with every fader at zero took 5-7dB off your hands to make room for sound that did not
 * exist. See `busGain`.
 *
 * That is the sentence this repository keeps writing — a rule written where nothing can call it
 * is a rule nobody checks — and it is why `settings.mjs`, `verdict.ts` and `designation.ts` exist
 * too. The decision moves out; the graph stays in synth.ts.
 *
 * Nothing here touches Web Audio. Every function is arithmetic over numbers the caller already
 * holds, which is also why synth.ts can afford to run it twenty times a second.
 */

/**
 * The level the limiter starts working at: -3dBFS, matching its threshold, with a little margin.
 *
 * ⚠️ THE CRACKLE WAS INTERMODULATION FROM THE LIMITER, proved rather than guessed. A capture of
 * the fault contained spectral lines at 73.2, 120.1, 155.3 and 193.4Hz — the exact arithmetic
 * DIFFERENCES between the notes being played. Linear mixing of sines cannot produce those; only a
 * nonlinearity can. Reproduced offline with the same nine notes: through the limiter they sit at
 * -59 to -64dB, and with it bypassed, or with the signal merely kept under threshold, they are at
 * -180dB, which is numerical zero.
 *
 * That is why it needed a pure tone to hear. IMD products are discrete lines, not noise, so they
 * have nothing to hide behind on a sine and vanish inside the harmonics of a rich patch.
 *
 * ⚠️ No limiter setting fixes it. Softer knees and slower attacks do lower the IMD, but only by
 * letting the peak through — measured, a 40dB knee drops distortion 39dB and raises the output
 * peak to 2.55, which hard-clips at the converter and is worse. The input has to come down.
 */
export const LIMIT_AT = 0.7

/**
 * The most a layer's fader can actually do, whatever the slider's own range is.
 *
 * ⚠️ IT IS NOT THE SLIDER'S MAXIMUM AND THAT GAP IS DELIBERATE — `setLayerGain` clamps to 2 and
 * this clamps to 1.5, so the top quarter of the fader's travel does nothing. Whether that is
 * right is OPEN-DECISIONS §11c and an ear's call; what matters HERE is only that the sum and the
 * bus agree about it, which is why both of them ask `busGain` rather than clamping their own way.
 */
export const BUS_CEILING = 1.5

/**
 * A fader as the bus actually applies it.
 *
 * ⚠️ ONE FUNCTION, CALLED BY BOTH SIDES, and that is the whole fix for OPEN-DECISIONS §11a. The
 * layer gain is applied at the bus INPUT, downstream of the polyphony gain, so for two months the
 * sum of "what is sounding" never saw it: a layer at fader 0 counted its full patch level and a
 * layer at fader 2 counted half of what it contributed. Measured in the pane with `ducking()` from
 * scripts/sound-probe.js, four-layer backing, every fader dragged to 0 so it made no sound at all
 * and every guard green — a held C4 read 0.5334 with the backing STOPPED and 0.2879 with the
 * silent backing RUNNING, which is **-5.36dB of ducking from nothing**. And it was a range rather
 * than a constant, because the sum follows the backing's envelopes: a hand-run an hour earlier
 * measured -6.74dB, so a held note PUMPED in time with music nobody could hear.
 *
 * ⚠️ UNDEFINED IS UNITY HERE AND SILENCE IN `soundingSum`, which is the one place the two sides
 * genuinely differ and so is two functions over one clamp. `noteOn` takes `part?.gain`, and
 * omitting it means your own live hands, which have no fader and are never anything but 1. Reading
 * a fader back off a part that has no bus is the opposite question — no bus, no sound — and
 * answering it with 1 would duck the room for a voice that cannot be heard.
 *
 * ⚠️ AND NaN IS SILENCE RATHER THAN NaN, which matters more than it looks. `Math.min(1.5, NaN)` is
 * NaN; a NaN on a gain node is already silence, so a layer carrying a corrupt gain is inaudible
 * today and nothing is lost by saying so — but a NaN in the SUM makes `polyGain` NaN, and a NaN
 * pushed onto every bus's gain silences THE WHOLE INSTRUMENT. `v > 0` is false for NaN, which is
 * the comparison that gets that and a negative with one branch.
 */
function clampFader(v: number): number {
  return v > 0 ? Math.min(BUS_CEILING, v) : 0
}
export function busGain(v: number | undefined): number {
  return v === undefined ? 1 : clampFader(v)
}

/**
 * One voice that is still making sound, as the numbers its envelope was scheduled from.
 *
 * ⚠️ NOT A VOICE COUNT, for two reasons the original investigation turned up.
 *
 * First, noteOff DELETES a voice while its release is still ringing, so counting the map missed
 * every tail. That is the whole "organ pops on one voice" report: spamming a key retriggers, the
 * map holds one, and five or six tails are still sounding and still summing. The strip said
 * `voices 1` and was telling the truth about the wrong thing.
 *
 * Second, a count cannot tell a whistle from an organ. Summing the LEVELS makes a mixed
 * arrangement come out right, and lets the rule below be exact rather than a guess.
 */
export type Ringing = {
  /** ctx time the envelope starts */
  at: number
  /** attack */
  a: number
  /** decay */
  d: number
  /**
   * The level this voice's own envelope peaks at — the PATCH's level, before any fader.
   *
   * It stays the patch's own number on purpose: the voice's gain node really is scheduled to
   * this, and the fader is a separate multiplication further down the graph. Folding the two
   * together here would make the decay's `target / peak` ratio depend on the fader, which is a
   * second thing to get wrong for no gain. `soundingSum` multiplies instead.
   */
  peak: number
  /** absolute sustain level, and the floor a one-shot decays to */
  target: number
  /** release time constant, once released */
  tau: number
  /** ctx time the release began; Infinity while the key is still down */
  off: number
  /** when it stops mattering and the entry can go */
  until: number
  /**
   * Whose sound this is — the bus key, so the fader can be asked for FRESHLY each time.
   *
   * ⚠️ THE FADER IS NOT SNAPSHOTTED AT NOTE-ON, and the difference is a whole bar of wrongness.
   * `setLayerGain`'s own comment says it "takes effect on whatever is already ringing", because
   * it rides the part's bus rather than scaling the notes. A gain copied in here would therefore
   * disagree with the signal for as long as the longest note already sounding — pull a pad
   * layer's fader to zero and your hands would keep being ducked by it until its next note, which
   * is the transient form of the very bug this file is the fix for.
   */
  part: string
}

/**
 * How loud this voice's own envelope is RIGHT NOW, not how loud it peaks. Before the fader.
 *
 * ⚠️ COUNTING THE PEAK MADE BELL DUCK ITSELF INTO SILENCE. Bell is a one-shot: d 2.4s, r 1.4s,
 * sustain zero. Its entry therefore lived for 3.8 seconds, and the first version counted its full
 * 0.4 the whole time — so four bell notes summed to 1.6 and pulled the instrument down to 0.44,
 * on the strength of level that had decayed away almost a second earlier. Every decaying patch
 * was over-counted; bell just has the longest tail and the highest peak, so it was worst.
 *
 * This is the same arithmetic the release code already does, and for the same stated reason: the
 * envelope is segments we scheduled ourselves from numbers we still hold, so its value at any
 * instant is arithmetic rather than something to ask the engine for.
 */
export function levelAt(r: Ringing, now: number): number {
  if (now <= r.at) return 0
  let v: number
  if (now < r.at + r.a) v = r.peak * ((now - r.at) / r.a)
  else if (now < r.at + r.a + r.d)
    v = r.peak * Math.pow(r.target / r.peak, (now - r.at - r.a) / r.d)
  else v = r.target
  if (now > r.off) v *= Math.exp(-(now - r.off) / r.tau)
  return v
}

/**
 * Everything still making sound, as the sum of what it ACTUALLY CONTRIBUTES.
 *
 * `gainOf` answers "what is this part's fader doing right now" — and 0 for a part with no bus,
 * which is a part that cannot be heard. See `Ringing.part` for why it is asked rather than
 * remembered.
 *
 * ⚠️ IT PRUNES AS IT GOES, which is why it takes the array rather than a readonly one. An entry
 * past its `until` is dropped: nothing else sweeps this list, and a voice whose nodes have been
 * stopped must stop counting or the room never hands its headroom back.
 */
export function soundingSum(
  rings: Ringing[],
  now: number,
  gainOf: (part: string) => number,
): number {
  let sum = 0
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]
    if (r.until <= now) {
      rings.splice(i, 1)
      continue
    }
    /* through the SAME clamp the bus uses, so the sum cannot be in a different unit from the
       signal again — and 0 for a part with no bus, which is a part nothing can hear */
    const g = clampFader(gainOf(r.part))
    if (g <= 0) continue
    sum += levelAt(r, now) * g
  }
  return sum
}

/**
 * The gain one voice should have right now. Never above 1 — this only ever takes away.
 *
 * ⚠️ TAKES AWAY ONLY WHAT IS NECESSARY, which is the whole difference from the 1/sqrt(n) version
 * this replaces. sqrt reduced from the second note onward whether or not anything was close to
 * distorting, which cost 2.7dB on fast passages and made the instrument feel muted for no benefit
 * — a real complaint, and a fair one. This holds the sum at the limiter threshold and otherwise
 * does nothing at all: one note and two notes are now at FULL level, where sqrt had already taken
 * 3dB off the pair.
 *
 * It is also exactly enough. At the threshold the limiter measures zero intermodulation, so this
 * is the loudest the instrument can be while producing none.
 *
 * ⚠️ Counted across ALL parts, not per part. Clipping happens where everything sums — at the
 * limiter — so a looper stack of eight notes has to make room for your live hands too. And it is
 * one number pushed to every bus, so it changes how loud the room is and never the balance
 * between the layers in it; the faders own that.
 */
export function polyGain(rings: Ringing[], now: number, gainOf: (part: string) => number): number {
  const sum = soundingSum(rings, now, gainOf)
  return sum <= LIMIT_AT ? 1 : LIMIT_AT / sum
}
