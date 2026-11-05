import {
  binCountAll,
  fftSizeAll,
  liveTaps,
  readSpectrumAll,
  readWaveformAll,
  tapFormat,
} from '../audio/audioTap'
import {
  BANDS,
  BASS_BANDS,
  QUIET,
  WAVE,
  bandEdges,
  beat,
  ease,
  foldBands,
  foldWave,
  type BeatState,
} from './music'

/** larger than any analyser here (2048-point FFTs); a short buffer is skipped, not an error */
const SCRATCH = 16384

export type Ear = {
  /**
   * Listen for one frame: fold whatever the site is playing into eased bands and a waveform
   * (written into `data`), and say how loud it is and whether a beat just landed.
   */
  hear(dt: number): { level: number; hit: boolean }
  /** BANDS eased band levels (0..1), then WAVE waveform samples (-1..1) */
  data: Float32Array
}

/**
 * What a Lab demo hears: the same analysers the Visualiser reads (audioTap), so it follows the
 * mic, a file, the instrument or a call, whichever is playing — and silence when none is.
 * Shared by Music and by the Swarm's Listen, so the two cannot come to disagree about a beat.
 */
export function createEar(data: Float32Array = new Float32Array(BANDS + WAVE)): Ear {
  const edges = bandEdges(BANDS)
  const spectrum = new Uint8Array(SCRATCH)
  const waveform = new Uint8Array(SCRATCH)
  const scratch = new Uint8Array(SCRATCH)
  const target = new Float32Array(BANDS)
  const bands = data.subarray(0, BANDS)
  const wave = data.subarray(BANDS)
  let beats: BeatState = QUIET

  return {
    data,
    hear(dt) {
      const bins = binCountAll()
      const fft = fftSizeAll()
      const first = liveTaps()[0]
      const rate = first ? (tapFormat(first)?.rate ?? 48000) : 48000
      if (bins > 0 && readSpectrumAll(spectrum.subarray(0, bins), scratch)) {
        foldBands(spectrum.subarray(0, bins), rate, fft, edges, target)
        readWaveformAll(waveform.subarray(0, fft), scratch)
        foldWave(waveform.subarray(0, fft), WAVE, wave)
      } else {
        target.fill(0)
        wave.fill(0)
      }
      let sum = 0
      for (let i = 0; i < BANDS; i++) {
        bands[i] = ease(bands[i], target[i], dt)
        sum += bands[i]
      }
      /* the beat reads the RAW bass, not the eased bands: easing is what makes the bars look
         smooth, and it is also a delay a kick drum should not have to wait out */
      let hit = false
      if (dt > 0) {
        let bass = 0
        for (let i = 0; i < BASS_BANDS; i++) bass += target[i]
        const b = beat(beats, bass / BASS_BANDS, dt)
        beats = b.state
        hit = b.hit
      }
      return { level: sum / BANDS, hit }
    },
  }
}
