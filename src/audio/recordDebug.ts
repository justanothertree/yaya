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
/** Hand a captured buffer over as a WAV download, so a caught fault can be analysed off-machine. */
export function downloadSamples(x: Float32Array, name: string) {
  const url = URL.createObjectURL(toWav(x, sharedCtx().sampleRate))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

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
    /**
     * ⚠️ A NOTE ONSET IS ALSO A BURST OF HIGH FREQUENCY, and without this the detector cannot
     * tell one from a click. It reported 193 "ticks" in fifteen seconds of real playing — about
     * thirteen a second, which is simply the note rate — and every waveform printed at those
     * instants was a smooth curve, with steps of one to five percent of the local amplitude.
     *
     * The difference is CONCENTRATION. A click is one bad sample: nearly all of the frame's
     * second-difference energy sits in it, so the crest factor is enormous. An onset is a fast
     * but continuous swell, spread across hundreds of samples, so its crest factor is ordinary.
     * Requiring a high crest keeps the thing that is a discontinuity and drops the thing that is
     * merely loud and sudden.
     */
    let step = 0
    let sum = 0
    let cnt = 0
    for (let i = i0; i < i0 + F && i < x.length; i++) {
      const ad = Math.abs(d[i])
      if (ad > step) step = ad
      sum += d[i] * d[i]
      cnt++
    }
    const rms = Math.sqrt(sum / Math.max(cnt, 1))
    /* 4.5 chosen by sweep against this exact recording and an injected step: at 5.0 real
       steps start being missed, at 4.0 sixty-one onsets get through. Here, 196 -> 2. */
    if (step < rms * 4.5) {
      k += 2
      continue
    }
    let jump = 0
    for (let i = i0 + 1; i < i0 + F && i < x.length; i++)
      jump = Math.max(jump, Math.abs(x[i] - x[i - 1]))
    out.push({ atMs: k, ratio: +ratio.toFixed(1), peakStep: +jump.toFixed(5) })
    k += 10 // one report per event, not per frame of it
  }
  return out
}

/**
 * The simplest note this browser can make, for bisecting the click.
 *
 * ⚠️ IT BYPASSES EVERYTHING THE INSTRUMENT DOES. One oscillator, one gain, straight to the
 * destination: no per-part bus, no filter, no limiter, no reverb, no polyphony gain, no
 * partials, no cancelScheduledValues, and an envelope of two straight lines that ends at exactly
 * zero. There is nothing here that could click except the engine itself.
 *
 * That makes it a bisection rather than another guess. If this crackles on rapid presses, the
 * fault is below everything we wrote and no amount of envelope work will touch it. If it is
 * clean while the instrument is not, the fault is ours, and the pieces can be added back one at
 * a time until it appears — which is a search that terminates.
 *
 * ⚠️ BOTH TEST TONES SCHEDULE AHEAD AND COMPUTE THEIR OWN LEVEL, and the first versions did
 * neither — which made them useless as a test and very nearly produced a wrong conclusion.
 *
 * They scheduled at `ctx.currentTime`, which is BEHIND the render head: the engine is already
 * some way into the next block, so an event stamped now is dated in the past and gets applied
 * with whatever discontinuity that implies. The real synth has guarded against this since long
 * before I arrived — that is what SAFE_START is for — and my bisection tools threw the guard
 * away. They also read `gain.value` during an active ramp to anchor the release, which is the
 * precise trap the note above cancelAndHoldAtTime describes: asking the engine for a level
 * instead of working it out.
 *
 * So a tone that clicked told us nothing about the engine; it may only have been repeating the
 * bug the instrument itself already avoids. Now both schedule at now + SAFE, and the release
 * anchor is computed from the ramp we ourselves wrote.
 */
const TONE_SAFE = 0.006
const TONE_ATTACK = 0.01
const TONE_PEAK = 0.2
const TONE_FADE = 0.08

/** Where our own attack ramp has got to at time t — arithmetic, not asked of the engine. */
function toneLevelAt(onAt: number, t: number): number {
  if (t <= onAt) return 0
  if (t >= onAt + TONE_ATTACK) return TONE_PEAK
  return (TONE_PEAK * (t - onAt)) / TONE_ATTACK
}

let plainOsc: OscillatorNode | null = null
let plainGain: GainNode | null = null
let plainOnAt = 0

export function plainToneOn(freq = 440) {
  const ctx = sharedCtx()
  plainToneOff(true)
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.value = freq
  o.connect(g).connect(ctx.destination)
  const t = ctx.currentTime + TONE_SAFE
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(TONE_PEAK, t + TONE_ATTACK)
  o.start(t)
  plainOnAt = t
  plainOsc = o
  plainGain = g
}

export function plainToneOff(immediate = false) {
  const o = plainOsc
  const g = plainGain
  plainOsc = null
  plainGain = null
  if (!o || !g) return
  const ctx = sharedCtx()
  const t = ctx.currentTime + TONE_SAFE
  const fade = immediate ? 0.005 : TONE_FADE
  try {
    g.gain.cancelScheduledValues(t)
    /* re-ramp onto the surviving setValueAtTime(0, onAt) when the release lands inside the
       attack, rather than inserting an anchor — otherwise the cancel deletes the attack ramp,
       the value falls back to 0, and it jumps to full level. See the same note in synth.ts. */
    if (t < plainOnAt + TONE_ATTACK) g.gain.linearRampToValueAtTime(toneLevelAt(plainOnAt, t), t)
    else g.gain.setValueAtTime(toneLevelAt(plainOnAt, t), t)
    g.gain.linearRampToValueAtTime(0, t + fade)
    o.stop(t + fade + 0.01)
    o.onended = () => {
      try {
        g.disconnect()
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* context went away */
  }
}

/**
 * The same bare tone with NO NODES CREATED OR DESTROYED per press — the oscillator is made once
 * and never stopped, so a press only moves a gain. Zero allocation, zero connection, zero
 * teardown, and the only difference from the plain tone above is graph churn.
 */
let poolOsc: OscillatorNode | null = null
let poolGain: GainNode | null = null
let poolOnAt = 0

export function pooledToneOn(freq = 440) {
  const ctx = sharedCtx()
  if (!poolOsc || !poolGain) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    g.gain.value = 0
    o.connect(g).connect(ctx.destination)
    o.start()
    poolOsc = o
    poolGain = g
  }
  const t = ctx.currentTime + TONE_SAFE
  poolOsc.frequency.setValueAtTime(freq, t)
  poolGain.gain.cancelScheduledValues(t)
  poolGain.gain.setValueAtTime(0, t)
  poolGain.gain.linearRampToValueAtTime(TONE_PEAK, t + TONE_ATTACK)
  poolOnAt = t
}

export function pooledToneOff() {
  if (!poolGain) return
  const t = sharedCtx().currentTime + TONE_SAFE
  poolGain.gain.cancelScheduledValues(t)
  if (t < poolOnAt + TONE_ATTACK) poolGain.gain.linearRampToValueAtTime(toneLevelAt(poolOnAt, t), t)
  else poolGain.gain.setValueAtTime(toneLevelAt(poolOnAt, t), t)
  poolGain.gain.linearRampToValueAtTime(0, t + TONE_FADE)
}
