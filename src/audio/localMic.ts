import { registerTap } from './audioTap'

/**
 * A microphone opened for LOOKING at, not for sending anywhere.
 *
 * ⚠️ Nothing captured here leaves the machine, and nothing is recorded. The stream goes to an
 * analyser and stops — the analyser's output is deliberately not connected, so the audio has no
 * route to the speakers either (connecting it would be an instant feedback howl on a laptop).
 *
 * Separate from the call's mic for a reason that is easy to get wrong: the call owns its analyser
 * and destroys it on hang-up. If a visualiser borrowed that node it would go blind the moment
 * someone left, and if it registered under the same id it would be quietly unregistered by the
 * call's teardown. Two sources, two ids, two lifetimes.
 *
 * The browser shows a recording indicator the whole time this is on. That is correct and it is
 * why stop() must actually stop the tracks rather than just disconnect the node — a muted-but-
 * live track leaves the indicator burning, which reads as a site listening after you told it not
 * to.
 */

let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let node: AnalyserNode | null = null

export function localMicOn(): boolean {
  return node != null
}

/** Must be called from a gesture — getUserMedia prompts, and a prompt with no cause is hostile. */
export async function startLocalMic(): Promise<boolean> {
  if (node) return true
  try {
    // No processing flags set either way: this is for watching a waveform, and echoCancellation
    // or noise suppression would show you a cleaned-up signal rather than the room.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    node = ctx.createAnalyser()
    node.fftSize = 2048
    // smoothing is the difference between bars that dance and bars that flicker
    node.smoothingTimeConstant = 0.75
    src.connect(node)
    registerTap('local', node)
    return true
  } catch {
    // Denied, or no device. Both are ordinary answers, and the caller shows the same message.
    stopLocalMic()
    return false
  }
}

export function stopLocalMic() {
  registerTap('local', null)
  node = null
  // the tracks first: this is what turns the browser's recording indicator off
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void ctx?.close().catch(() => {})
  ctx = null
}
