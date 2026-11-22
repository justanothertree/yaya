/**
 * The arithmetic of a recorded mix, apart from the recording — so it can be asked a question
 * without a browser. See instrument/songExport.ts for what records it.
 */

/** what the export captured: the mix's two channels and the marker, block by block */
export type Captured = { left: Float32Array[]; right: Float32Array[]; mark: Float32Array[] }

const join = (bits: readonly Float32Array[]) => {
  let n = 0
  for (const b of bits) n += b.length
  const all = new Float32Array(n)
  let at = 0
  for (const b of bits) {
    all.set(b, at)
    at += b.length
  }
  return all
}

/**
 * The mix from the song's first sample on.
 *
 * ⚠️ THE MARKER SAYS WHERE THAT IS, TO THE SAMPLE. It is a constant 1 started on the audio clock
 * at the loop's own top and recorded in a third channel beside the mix, so it lands in the same
 * blocks as the music whatever the browser's buffering. Reading a clock on the main thread and
 * guessing which block was playing then is the alternative, and it is off by up to a block.
 * Null when the marker never arrived: a recording that does not know where the song starts is
 * not one to hand anybody.
 */
export function fromMarker(c: Captured): { left: Float32Array; right: Float32Array } | null {
  const mark = join(c.mark)
  const start = mark.findIndex((x) => x > 0.5)
  if (start < 0) return null
  return { left: join(c.left).subarray(start), right: join(c.right).subarray(start) }
}

/**
 * Where the sound ends: the last sample louder than `floorDb` under the loudest, plus a breath, at
 * least `atLeast` samples in (the song itself, which may end on a rest).
 */
export function endOfSound(
  left: Float32Array,
  right: Float32Array,
  atLeast: number,
  rate: number,
  floorDb = -60,
): number {
  let peak = 0
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  const floor = peak * 10 ** (floorDb / 20)
  let last = 0
  for (let i = left.length - 1; i >= 0; i--)
    if (Math.abs(left[i]) > floor || Math.abs(right[i]) > floor) {
      last = i
      break
    }
  return Math.min(left.length, Math.max(atLeast, last + Math.round(0.05 * rate)))
}

/** a straight fade to silence over the last `frames` samples, so a cut tail does not click */
export function fadeOut(left: Float32Array, right: Float32Array, frames: number) {
  const n = left.length
  const f = Math.min(frames, n)
  for (let k = 0; k < f; k++) {
    const g = k / f
    left[n - 1 - k] *= g
    right[n - 1 - k] *= g
  }
}

/**
 * Bring the whole mix down, by one amount everywhere, so its loudest sample sits at `ceiling` —
 * when it is over; a mix already under is left exactly as it is. Returns the gain it applied.
 */
export function underCeiling(left: Float32Array, right: Float32Array, ceiling: number): number {
  let peak = 0
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  if (peak <= ceiling) return 1
  const g = ceiling / peak
  for (let i = 0; i < left.length; i++) {
    left[i] *= g
    right[i] *= g
  }
  return g
}

export type MixStats = { seconds: number; peakDb: number; rmsDb: number; clipped: number }

/** how long, how loud at its loudest and on average, and how many samples reached full scale */
export function measure(left: Float32Array, right: Float32Array, rate: number): MixStats {
  let peak = 0
  let sum = 0
  let clipped = 0
  for (let i = 0; i < left.length; i++) {
    const l = Math.abs(left[i])
    const r = Math.abs(right[i])
    peak = Math.max(peak, l, r)
    sum += left[i] * left[i] + right[i] * right[i]
    if (l >= 0.999 || r >= 0.999) clipped++
  }
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity)
  return {
    seconds: left.length / rate,
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / Math.max(1, 2 * left.length))),
    clipped,
  }
}
