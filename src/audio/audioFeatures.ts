/**
 * Turning a spectrum into things worth drawing.
 *
 * ⚠️ THIS IS WHY THE FIRST MODES LOOKED BASIC. They were handed 512 raw FFT bins and nothing
 * else, so the only honest thing any of them could do was draw the bins — which is a bar chart,
 * or a bar chart in a circle. Everything that makes a visualiser feel alive rather than
 * instrumental comes from a layer above the bins: is that a kick drum, is the bass carrying this
 * moment, has anything changed since last frame. None of that existed, so none of it could be
 * drawn.
 *
 * Computed ONCE per frame and shared by whichever mode is running, rather than each mode doing
 * its own arithmetic over the same array. Sixteen modes doing sixteen private beat detectors
 * would be sixteen slightly different answers to the same question.
 */

export type Features = {
  /** 0–1 energy in three musical ranges, smoothed */
  bass: number
  mid: number
  treble: number
  /** overall loudness, 0–1, smoothed */
  level: number
  /** true only on the frame an onset is detected */
  beat: boolean
  /** seconds since the last beat — the thing most modes actually want */
  sinceBeat: number
  /** 0–1, how much this beat stood out from the recent average */
  beatStrength: number
  /** seconds since the reader was made, for anything time-driven */
  t: number
}

/**
 * Where each band starts and ends, as a FRACTION of the bins rather than a bin index.
 *
 * ⚠️ Fractions because the bin count depends on the analyser, and a hard-coded "bins 0 to 6"
 * means something different at fftSize 512 than at 2048 — the local mic and the call use
 * different sizes, so a fixed index would silently change what "bass" meant when you switched
 * source. These are roughly 0–250Hz, 250Hz–2kHz, 2k–10kHz at typical rates: kick and bassline,
 * the range voices and most instruments live in, then cymbals and air.
 */
const BANDS = {
  bass: [0, 0.04],
  mid: [0.04, 0.22],
  treble: [0.22, 0.6],
} as const

/** One-pole smoothing. Values near 1 follow instantly; near 0 they crawl. */
const approach = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * Math.min(1, rate * dt)

export function makeFeatureReader() {
  let bass = 0
  let mid = 0
  let treble = 0
  let level = 0
  let t = 0
  let sinceBeat = 10
  let beatStrength = 0

  // spectral flux needs last frame's spectrum to diff against
  let prev: Float32Array | null = null
  // a rolling mean of recent flux — the threshold has to ADAPT, or a quiet passage never beats
  // and a loud one beats on every frame
  const history: number[] = []

  const bandEnergy = (spec: Uint8Array, bins: number, range: readonly [number, number]) => {
    const lo = Math.floor(range[0] * bins)
    const hi = Math.max(lo + 1, Math.floor(range[1] * bins))
    let sum = 0
    for (let i = lo; i < hi; i++) sum += spec[i]
    return sum / (hi - lo) / 255
  }

  return {
    read(spec: Uint8Array, bins: number, rms: number, dt: number): Features {
      t += dt
      sinceBeat += dt

      const n = Math.max(1, bins)
      // Bands are smoothed at different rates on purpose. Bass carries the pulse and wants to
      // move fast enough to feel like the kick; treble is hiss and sparkle and reads as noise
      // unless it is slowed down.
      bass = approach(bass, bandEnergy(spec, n, BANDS.bass), 14, dt)
      mid = approach(mid, bandEnergy(spec, n, BANDS.mid), 10, dt)
      treble = approach(treble, bandEnergy(spec, n, BANDS.treble), 7, dt)
      level = approach(level, Math.min(1, rms), 9, dt)

      /**
       * Onset detection by SPECTRAL FLUX: how much the spectrum grew since last frame.
       *
       * ⚠️ Only INCREASES count. Summing the absolute difference would fire just as hard when a
       * note stops as when one starts, and a visualiser that flashes on silence looks broken.
       * The threshold is a rolling mean of recent flux rather than a constant, so the same music
       * played quietly still beats.
       */
      let flux = 0
      if (prev && prev.length >= n) {
        for (let i = 0; i < n; i++) {
          const d = spec[i] / 255 - prev[i]
          if (d > 0) flux += d
        }
        flux /= n
      }
      if (!prev || prev.length < n) prev = new Float32Array(Math.max(n, 2048))
      for (let i = 0; i < n; i++) prev[i] = spec[i] / 255

      history.push(flux)
      if (history.length > 43) history.shift() // ~0.7s at 60fps
      const mean = history.reduce((a, b) => a + b, 0) / Math.max(1, history.length)

      // 1.4x the recent average, a floor so silence never beats, and a refractory gap so one
      // drum hit is one beat rather than three frames of one
      const beat = flux > mean * 1.4 && flux > 0.004 && sinceBeat > 0.11
      if (beat) {
        beatStrength = Math.min(1, mean > 0 ? flux / (mean * 3) : 1)
        sinceBeat = 0
      }

      return { bass, mid, treble, level, beat, sinceBeat, beatStrength, t }
    },
  }
}
