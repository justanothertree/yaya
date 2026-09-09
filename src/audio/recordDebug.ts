/**
 * Record what the instrument actually sounded like, and hand it over as a WAV.
 *
 * ⚠️ THIS EXISTS BECAUSE EVERY NUMBER SAYS THE SIGNAL IS FINE AND IT AUDIBLY IS NOT. The health
 * strip reports no dropouts, no clipping and no limiter activity on flute and whistle, and every
 * offline reconstruction of a voice — envelope, filter sweep, release, oscillator stop, at three
 * playing speeds — comes back at exactly zero distortion and zero slew violations. When the
 * measurements and the ears disagree that completely, the measurements are looking in the wrong
 * place, and the way out is to stop reconstructing the sound and capture the real one.
 *
 * ⚠️ RAW PCM, NOT MediaRecorder. MediaRecorder gives Opus, a lossy codec that both removes quiet
 * detail and adds artefacts of its own — so a recording made to diagnose a faint crackle would
 * arrive with the crackle possibly gone and possibly invented. A WAV of the exact Float32 the
 * engine produced is the only recording worth analysing.
 *
 * ⚠️ Tapped POST-LIMITER, at the same fork the visualiser draws from, because that is the signal
 * the speakers are asked for. A tap before the limiter would show a clean waveform and prove
 * nothing about what you heard.
 *
 * Debug-only, behind the same flag as the health strip, and it never leaves the machine except
 * by the person recording it choosing to send the file.
 */
import { sharedCtx } from './context'

let rec: ScriptProcessorNode | null = null
let chunks: Float32Array[] = []
let source: AudioNode | null = null

/** WAV is a 44-byte header and then the samples — no library needed for one debug button. */
function toWav(data: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + data.length * 2)
  const v = new DataView(buf)
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + data.length * 2, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) {
    // clamp before converting, so a sample past full scale wraps to silence rather than to
    // the opposite polarity — which would write a click that was never in the audio
    const s = Math.max(-1, Math.min(1, data[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function recordingNow(): boolean {
  return !!rec
}

/**
 * Start capturing from `from` for `seconds`, then download it.
 *
 * ScriptProcessorNode is deprecated and is still the right tool here: it is three lines, it is
 * supported everywhere, and a debug capture that runs for four seconds has no business owning a
 * worklet module. Its own latency does not matter — we are keeping the samples, not playing them.
 */
export function recordOutput(from: AudioNode, seconds = 5): Promise<void> {
  const ctx = sharedCtx()
  if (rec) return Promise.resolve()
  chunks = []
  source = from
  const node = ctx.createScriptProcessor(4096, 1, 1)
  rec = node
  node.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  from.connect(node)
  /* ⚠️ a ScriptProcessor whose output reaches nothing is never pulled, so process never runs —
     the same trap the health worklet documents. Through a silent gain so it is driven but adds
     nothing to what you hear. */
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(ctx.destination)

  return new Promise((resolve) => {
    window.setTimeout(() => {
      try {
        source?.disconnect(node)
        node.disconnect()
      } catch {
        /* already torn down */
      }
      node.onaudioprocess = null
      rec = null
      source = null
      let n = 0
      for (const c of chunks) n += c.length
      const all = new Float32Array(n)
      let o = 0
      for (const c of chunks) {
        all.set(c, o)
        o += c.length
      }
      chunks = []
      const url = URL.createObjectURL(toWav(all, ctx.sampleRate))
      const a = document.createElement('a')
      a.href = url
      a.download = `instrument-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.wav`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      resolve()
    }, seconds * 1000)
  })
}

/**
 * Capture the real graph's output into an array, rather than a file.
 *
 * ⚠️ FOR DRIVING THE REAL SYNTH FROM A CONSOLE, which is the only thing that has not been tried
 * on this bug. Every offline reconstruction of a voice comes back clean, which means the
 * reconstruction is missing whatever the fault is — so the reconstruction is the wrong tool. This
 * plays a note through the actual code path, with the actual bus, filter, limiter and poly gain
 * in place, and hands back the samples.
 */
export function captureSamples(from: AudioNode, seconds: number): Promise<Float32Array> {
  const ctx = sharedCtx()
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const got: Float32Array[] = []
  node.onaudioprocess = (e) => {
    got.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  from.connect(node)
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(ctx.destination)
  return new Promise((resolve) => {
    window.setTimeout(() => {
      try {
        from.disconnect(node)
        node.disconnect()
      } catch {
        /* already gone */
      }
      node.onaudioprocess = null
      let n = 0
      for (const c of got) n += c.length
      const all = new Float32Array(n)
      let o = 0
      for (const c of got) {
        all.set(c, o)
        o += c.length
      }
      resolve(all)
    }, seconds * 1000)
  })
}

/**
 * A tick, as the analysis that finds one.
 *
 * ⚠️ THE FAULT IS RARE AND THE PLAYER IS NOT. Driving notes from a script produces
 * metronome-regular timing and, across nearly a hundred presses, caught the artefact twice —
 * where the person actually playing hits it constantly. So the tool has to go where the hands
 * are: record while somebody plays, then say exactly where the ticks were.
 *
 * A tick is a millisecond whose HIGH-FREQUENCY content stands far above its own neighbourhood.
 * Second-differencing emphasises high frequencies, and comparing each frame against the MEDIAN of
 * the 30 frames around it means a note's own onset — which is broadband but gradual over several
 * frames — does not register, while a single-sample edge does.
 */
/**
 * ⚠️ TRUSTWORTHY ON SMOOTH PATCHES, NOISY ON BUZZY ONES. It looks for a steep edge, and a
 * sawtooth or square wave is made of steep edges — a pad note reports about twenty "ticks" that
 * are simply its own waveform. Verified that this is not the quiet-fade artefact: it survives the
 * absolute floor above.
 *
 * That is a limit worth stating rather than papering over, and it happens not to matter here:
 * every patch this was built for — organ, flute, whistle, bell — is sine-based, where the only
 * steep edge in the signal is one that should not be there. Read a count on sawtooth, square or
 * triangle patches (pad, strings, cello, lead, reed, bass, keys) as meaningless.
 */
export type Tick = { atMs: number; ratio: number; peakStep: number }

export function findTicks(x: Float32Array, rate: number, threshold = 6): Tick[] {
  const F = Math.round(rate / 1000)
  const n = Math.floor(x.length / F)
  /**
   * ⚠️ THE SECOND DIFFERENCE IS TAKEN OVER THE WHOLE SIGNAL FIRST, then binned — not computed
   * per frame. Framing it first left a two-sample hole at every boundary, because d[i] needs
   * x[i-1] and x[i-2] and the loop could not reach back across the edge. That is four percent of
   * all sample positions where a discontinuity was INVISIBLE, and a scheduled envelope event
   * lands at an arbitrary offset, so it is a coin toss whether the detector sees it.
   *
   * Caught by feeding it a step of known size at a known instant: it reported nothing, and the
   * step had landed at offset 0 of its frame. A detector that misses the thing it was built to
   * find is worse than none, and this is the fifth time in this investigation that a meter has
   * had a blind spot exactly where the fault lives.
   */
  const d = new Float64Array(x.length)
  for (let i = 2; i < x.length; i++) d[i] = x[i] - 2 * x[i - 1] + x[i - 2]
  const hf = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const i0 = k * F
    let s = 0
    let c = 0
    for (let i = i0; i < i0 + F && i < x.length; i++) {
      s += d[i] * d[i]
      c++
    }
    hf[k] = c ? Math.sqrt(s / c) : 0
  }
  /**
   * ⚠️ A RATIO ALONE FIRES ON SILENCE. Dividing by the median of the neighbourhood makes the test
   * scale-free, which is what lets it work at any volume — and also means that in a very quiet
   * passage the median is near zero and any wobble reads as an enormous ratio. Measured: a pad
   * note released 200ms into its 500ms attack reported twenty-one "ticks", every one of them the
   * quiet onset rather than an edge.
   *
   * So a frame must ALSO carry real high-frequency energy, relative to the loudest in the take.
   * A genuine click is a large event; nothing in a fade is.
   */
  let loudest = 0
  for (let k = 0; k < n; k++) if (hf[k] > loudest) loudest = hf[k]
  const floor = loudest * 0.02

  const out: Tick[] = []
  const win: number[] = []
  for (let k = 20; k < n - 20; k++) {
    win.length = 0
    for (let j = k - 15; j <= k + 15; j++) win.push(hf[j])
    win.sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const ratio = hf[k] / Math.max(med, 1e-12)
    if (ratio < threshold || hf[k] < floor) continue
    const i0 = k * F
    let step = 0
    for (let i = i0 + 1; i < i0 + F && i < x.length; i++)
      step = Math.max(step, Math.abs(x[i] - x[i - 1]))
    out.push({ atMs: k, ratio: +ratio.toFixed(1), peakStep: +step.toFixed(5) })
    k += 10 // one report per event, not per frame of it
  }
  return out
}
