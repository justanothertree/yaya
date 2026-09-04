import { sharedCtx } from './context'
import { readWaveform } from './audioTap'

/**
 * Is the sound actually broken, and in which of the two ways?
 *
 * ⚠️ THIS EXISTS BECAUSE CRACKLING CANNOT BE DEBUGGED BY DESCRIPTION. "Crackling" and "popping"
 * name a symptom with two completely different causes, and the fix for one does nothing for the
 * other:
 *
 *   CLIPPING   the signal goes past what the output can represent and the peaks are flattened.
 *              Shows up as `clipped` climbing while `peak` sits at 1. A mixing problem.
 *   DROPOUTS   the audio thread misses its deadline and the buffer it was filling goes out
 *              half-written. Shows up as `dropped` climbing, with peak nowhere near 1. A
 *              machine-is-too-busy problem, and no amount of envelope work will touch it.
 *
 * Both were measured to zero on the development machine while the fault was plainly audible on a
 * phone — which is the whole reason this is in the page rather than in a test. The device that has
 * the problem has to be the device that does the measuring.
 *
 * Behind a flag and off by default: localStorage.audio_debug = '1'. Nothing here is created,
 * and no worklet is compiled, unless somebody asks for it.
 */

export type AudioHealth = {
  /** how far ahead the hardware buffer runs, in ms — the headroom the audio thread has */
  bufferMs: number
  bufferFrames: number
  sampleRate: number
  /** render quanta the audio thread failed to deliver on time since the last read */
  dropped: number
  /** times the gap between quanta was more than a quantum and a half */
  gaps: number
  /** loudest sample seen since the last read, 0..1 */
  peak: number
  /** samples at or above 0.985 — the flattened tops of a clipped waveform */
  clipped: number
}

let node: AudioWorkletNode | null = null
let expectedFrom = 0
let counted = 0
let gapCount = 0
let peak = 0
let clipped = 0
let scratch: Uint8Array | null = null

/**
 * ⚠️ Counts its OWN calls rather than timing them from the main thread. process() runs once per
 * 128 frames on the audio thread; comparing how many actually happened against how many the clock
 * says should have is the only honest measure of a missed deadline, and it cannot be faked by a
 * main thread that is itself stuttering.
 */
const WORKLET = `
class H extends AudioWorkletProcessor {
  constructor () { super(); this.n = 0; this.t0 = currentTime; this.gaps = 0; this.last = currentTime
    this.port.onmessage = () => {
      this.port.postMessage({ n: this.n, elapsed: currentTime - this.t0, gaps: this.gaps })
      this.n = 0; this.gaps = 0; this.t0 = currentTime
    } }
  process () {
    const dt = currentTime - this.last; this.last = currentTime
    if (this.n > 0 && dt > (128 / sampleRate) * 1.5) this.gaps++
    this.n++; return true
  }
}
registerProcessor('audio-health', H)
`

export function healthOn(): boolean {
  try {
    return localStorage.getItem('audio_debug') === '1'
  } catch {
    return false
  }
}

/** Start measuring. Safe to call twice; does nothing unless the flag is on. */
export async function startHealth(): Promise<boolean> {
  if (node || !healthOn()) return !!node
  const ctx = sharedCtx()
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    node = new AudioWorkletNode(ctx, 'audio-health')
    /**
     * ⚠️ Connected to the destination through a SILENT gain, because a node whose output reaches
     * nothing is never pulled and its process() is never called — the first version of this
     * measured a flat zero for exactly that reason and looked like perfect health.
     */
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { n: number; elapsed: number; gaps: number }
      const should = Math.round((d.elapsed * ctx.sampleRate) / 128)
      counted = d.n
      expectedFrom = should
      gapCount = d.gaps
    }
    return true
  } catch {
    node = null
    return false
  }
}

export function stopHealth() {
  try {
    node?.disconnect()
  } catch {
    /* already gone */
  }
  node = null
}

/**
 * Take a reading. Ask about once a second — each call resets the worklet's counters, so a faster
 * poll measures a shorter window and a slower one a longer.
 */
export function readHealth(): AudioHealth {
  const ctx = sharedCtx()
  if (!scratch) scratch = new Uint8Array(2048)
  // the tap is post-limiter, so this is what the speakers are actually being asked for
  if (readWaveform('instrument', scratch)) {
    for (let i = 0; i < scratch.length; i++) {
      const v = Math.abs((scratch[i] - 128) / 128)
      if (v > peak) peak = v
      if (v >= 0.985) clipped++
    }
  }
  const out: AudioHealth = {
    bufferMs: +(ctx.baseLatency * 1000).toFixed(1),
    bufferFrames: Math.round(ctx.baseLatency * ctx.sampleRate),
    sampleRate: ctx.sampleRate,
    dropped: Math.max(0, expectedFrom - counted),
    gaps: gapCount,
    peak: +peak.toFixed(3),
    clipped,
  }
  node?.port.postMessage('read')
  peak = 0
  clipped = 0
  return out
}
