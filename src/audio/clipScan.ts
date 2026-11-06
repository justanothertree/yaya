/**
 * What a window of audio says about itself: how loud it got, and how much of it went past
 * what the output can represent.
 *
 * ⚠️ ITS OWN MODULE BECAUSE audioHealth.ts CANNOT BE IMPORTED WITHOUT A BROWSER. That file
 * opens the shared AudioContext and builds an AudioWorklet at import, so the one decision in
 * it worth asking a question about — what counts as clipped — could not be asked. This is the
 * same move play.ts, designation.ts and now takeFx.ts each describe in their own headers: the
 * rule comes out, the wiring stays.
 *
 * ⚠️ AND THE DECISION IS NOT OBVIOUS, WHICH IS WHY IT BELONGS SOMEWHERE IT CAN BE PINNED. The
 * old test was `>= 0.985` on bytes, and it was a proxy forced by the data rather than a
 * definition: `getByteTimeDomainData` saturates at 255, so a sample at 1.0 and a sample at 1.5
 * arrive identical and the only available question was "is the top flat". That proxy is wrong
 * in both directions. A clean sine peaking at 0.99 is not clipped and was counted; a mix at
 * 1.10 is clipped by 0.8dB and read as 0.992.
 *
 * With floats the real question is askable, so it is asked: a sample is clipped when it is
 * past full scale, and not when it merely approaches it.
 */

/** Past this a sample cannot be represented at the converter and the peak is flattened. */
export const FULL_SCALE = 1

export type ClipScan = {
  /** loudest absolute sample in the window — UNCLAMPED, so it can exceed 1 */
  peak: number
  /** how many samples were past full scale */
  over: number
}

/**
 * Scan a window, carrying the running peak in so a caller sampling repeatedly keeps the worst.
 *
 * ⚠️ `was` is a PEAK TO BEAT, not a starting value to add to. Counting is the caller's job for
 * the same reason: a total that only climbs and a window that resets are different lifetimes,
 * and folding them together here is how one of them silently becomes the other.
 */
export function clipScan(buf: ArrayLike<number>, was = 0): ClipScan {
  let peak = was
  let over = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] < 0 ? -buf[i] : buf[i]
    /* ⚠️ NaN fails every comparison, so it can neither raise the peak nor be counted — which
       is the right answer rather than a lucky one. A NaN in the graph is silence at the
       output, and reporting it as a 0 peak says exactly that. */
    if (v > peak) peak = v
    if (v > FULL_SCALE) over++
  }
  return { peak, over }
}

/**
 * How much of the audio a sampler at this cadence actually looks at.
 *
 * ⚠️ THE NUMBER THAT MADE THE OLD METER MISLEADING, and it was in a comment rather than in the
 * code. One 2048-sample read a second at 48kHz is 4.3% of the audio, so `clip 0` meant "none
 * seen in one twenty-third of the time". Stated as a function because the strip SHOWS this
 * figure to the person reading it, and a coverage figure typed into a tooltip beside a cadence
 * defined somewhere else is two copies of one number.
 */
export function coverage(windowSamples: number, everyMs: number, rate: number): number {
  if (!(windowSamples > 0) || !(everyMs > 0) || !(rate > 0)) return 0
  return Math.min(1, windowSamples / rate / (everyMs / 1000))
}
