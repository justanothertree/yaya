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
