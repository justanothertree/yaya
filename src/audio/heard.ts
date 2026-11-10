/**
 * Where on the audio clock the sound coming out of the speaker RIGHT NOW was scheduled.
 *
 * ⚠️ `currentTime` IS WHAT IS BEING RENDERED, NOT WHAT IS BEING HEARD. Between the two sits the
 * output's own buffering — a few milliseconds on a laptop's speakers, and on a Bluetooth headset
 * routinely a fifth of a second or more. A playhead drawn from `currentTime` therefore runs ahead
 * of the sound by exactly that much, which on a waveform you are trimming against is the
 * difference between cutting on the consonant and cutting after it.
 *
 * The browser reports the gap two ways, and this prefers the precise one:
 *
 *   · `getOutputTimestamp()` pairs a context time with the moment it reached the output, so
 *     carrying it forward to `nowMs` gives the moment being heard now
 *   · `outputLatency` is a single estimate, used when the timestamp is missing or not yet
 *     meaningful (it reads zero until the output has started)
 *
 * ⚠️ BOTH ARE THE BROWSER'S CLAIM ABOUT THE DEVICE, and a device can misreport — Bluetooth stacks
 * are the usual offender. This is as right as the platform lets a page be; whether a given
 * headset agrees with it is a listening test, not something a measurement here can settle.
 *
 * Never later than `currentTime`: whatever is heard was rendered first, so a report that says
 * otherwise is a report to distrust.
 */
export type HeardClock = {
  currentTime: number
  outputLatency?: number
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number }
}

export function heardTime(ctx: HeardClock, nowMs: number): number {
  const now = ctx.currentTime
  let ts: { contextTime?: number; performanceTime?: number } | undefined
  try {
    ts = ctx.getOutputTimestamp?.()
  } catch {
    /* a context that is closing may refuse — fall through to the estimate */
  }
  const c = ts?.contextTime
  const p = ts?.performanceTime
  if (
    typeof c === 'number' &&
    typeof p === 'number' &&
    Number.isFinite(c) &&
    Number.isFinite(p) &&
    p > 0 &&
    c > 0
  )
    return Math.min(now, c + Math.max(0, nowMs - p) / 1000)
  const lag = ctx.outputLatency
  return now - (typeof lag === 'number' && Number.isFinite(lag) && lag > 0 ? lag : 0)
}
