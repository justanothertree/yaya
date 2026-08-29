/**
 * One place to ask "what does the audio look like right now".
 *
 * ⚠️ A REGISTRY, NOT A SECOND AUDIO GRAPH. The call already builds analysers — one on the mic for
 * the speaking indicator, one per peer — and the ringtone has its own context. A visualiser that
 * opened its own AudioContext and re-tapped those streams would be a second graph running beside
 * the first, and on Safari a second context is a real cost rather than a bookkeeping detail.
 * Producers publish the node they already have; consumers read it. Nothing here creates audio.
 *
 * ⚠️ And nothing here KEEPS a source alive. The registry holds a reference to a node the producer
 * owns, and the producer removes it on teardown. If a consumer outlives a call it simply finds
 * nothing under that id, which is the correct answer rather than a stale buffer.
 *
 * Reads are pull-based, from whatever animation frame the consumer is already running. A
 * push-based tap would mean this module owning a loop that runs whether or not anyone is looking,
 * which is the thing every other effect on this site is careful not to do.
 */

export type TapId = 'mic' | 'peers' | 'ring' | 'local' | 'music' | 'shared' | 'instrument'

export type TapInfo = { id: TapId; label: string }

/** Every source a consumer could offer, whether or not it is live right now. */
export const TAPS: TapInfo[] = [
  { id: 'mic', label: 'Your mic' },
  { id: 'peers', label: 'Everyone else' },
  { id: 'ring', label: 'Ringtone' },
  // Separate from 'mic' on purpose: that one is the call's own analyser and disappears when the
  // call ends. This is a mic opened by whoever wanted to watch it, and it must not be torn down
  // by somebody else hanging up.
  { id: 'local', label: 'This mic' },
  // A file you picked, played here. Never uploaded — see musicSource.ts.
  { id: 'music', label: 'Music' },
  // Whatever another tab or window is playing, via screen share with audio ticked.
  { id: 'shared', label: 'Tab audio' },
  // The instrument room's synth — registers itself the moment a note is played.
  { id: 'instrument', label: 'Instrument' },
]

const sources = new Map<TapId, AnalyserNode>()
const listeners = new Set<() => void>()

function publish() {
  for (const fn of listeners) fn()
}

/** Producers call this with a node they already own. Passing null removes it. */
export function registerTap(id: TapId, node: AnalyserNode | null) {
  if (node) sources.set(id, node)
  else sources.delete(id)
  publish()
}

export function hasTap(id: TapId): boolean {
  return sources.has(id)
}

/** Which sources are live, so a picker can say so rather than offering a dead option. */
export function liveTaps(): TapId[] {
  return TAPS.map((t) => t.id).filter((id) => sources.has(id))
}

export function subscribeTaps(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Frequency bins, 0–255, or null when that source is not live.
 *
 * ⚠️ The caller passes its own array and we fill it. Allocating a Uint8Array per frame is the
 * classic way a visualiser becomes a garbage-collection stutter — 60 allocations a second of a
 * few hundred bytes each is not free, and the pauses land exactly when something is moving.
 */
export function readSpectrum(id: TapId, into: Uint8Array): boolean {
  const node = sources.get(id)
  if (!node) return false
  // an analyser's bin count can change if fftSize is retuned under us; a short read is better
  // than an exception, and the consumer redraws next frame anyway
  if (into.length < node.frequencyBinCount) return false
  node.getByteFrequencyData(into as Uint8Array<ArrayBuffer>)
  return true
}

/** The waveform itself, 0–255 centred on 128, for anything drawing a scope rather than bars. */
export function readWaveform(id: TapId, into: Uint8Array): boolean {
  const node = sources.get(id)
  if (!node) return false
  if (into.length < node.fftSize) return false
  node.getByteTimeDomainData(into as Uint8Array<ArrayBuffer>)
  return true
}

/**
 * Every live source at once.
 *
 * ⚠️ The PEAK per bin, not the sum. Summing dB-scaled bytes is not physically meaningful —
 * two sources at 200 do not make 400, they make something closer to 206 — and it saturates to a
 * flat white wall the moment more than one thing plays. Taking the loudest source in each bin
 * keeps every source visible without any of them washing the others out, which is what somebody
 * watching a jam actually wants to see.
 *
 * Returns false when nothing at all is live, so the caller can say so rather than draw silence.
 */
export function readSpectrumAll(into: Uint8Array, scratch: Uint8Array): boolean {
  let any = false
  into.fill(0)
  for (const [, node] of sources) {
    if (scratch.length < node.frequencyBinCount) continue
    node.getByteFrequencyData(scratch as Uint8Array<ArrayBuffer>)
    const n = Math.min(into.length, node.frequencyBinCount)
    for (let i = 0; i < n; i++) if (scratch[i] > into[i]) into[i] = scratch[i]
    any = true
  }
  return any
}

/**
 * The combined waveform — summed, unlike the spectrum, because that IS what mixing does.
 *
 * Deviations from the 128 centre add and are clamped at the ends, which is exactly what a mixer
 * hitting its ceiling sounds like. Summing here is correct where summing the spectrum was not.
 */
export function readWaveformAll(into: Uint8Array, scratch: Uint8Array): boolean {
  let any = false
  into.fill(128)
  for (const [, node] of sources) {
    if (scratch.length < node.fftSize) continue
    node.getByteTimeDomainData(scratch as Uint8Array<ArrayBuffer>)
    const n = Math.min(into.length, node.fftSize)
    for (let i = 0; i < n; i++) {
      into[i] = Math.max(0, Math.min(255, into[i] + (scratch[i] - 128)))
    }
    any = true
  }
  return any
}

/** The widest bin count among live sources, so a consumer can size its buffers for the mix. */
export function binCountAll(): number {
  let n = 0
  for (const [, node] of sources) n = Math.max(n, node.frequencyBinCount)
  return n
}

export function fftSizeAll(): number {
  let n = 0
  for (const [, node] of sources) n = Math.max(n, node.fftSize)
  return n
}

/** How many bins a source produces, so a consumer can size its buffer once. */
export function binCount(id: TapId): number {
  return sources.get(id)?.frequencyBinCount ?? 0
}

export function fftSize(id: TapId): number {
  return sources.get(id)?.fftSize ?? 0
}

/**
 * A single 0–1 loudness figure, for anything that wants one number rather than a spectrum.
 *
 * Root-mean-square over the waveform rather than an average of the frequency bins: RMS tracks
 * perceived loudness, while a bin average is dominated by whichever band happens to be busy and
 * reads as jittery on speech.
 */
export function readLevel(id: TapId, scratch: Uint8Array): number {
  if (!readWaveform(id, scratch)) return 0
  const n = Math.min(scratch.length, fftSize(id))
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = (scratch[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 2.5)
}
