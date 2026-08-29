import { registerTap } from './audioTap'
import { makeGain, releaseGain, volume } from './mixer'
import { sharedCtx } from './context'

/**
 * A microphone opened for LOOKING at, not for sending anywhere.
 *
 * ⚠️ Nothing captured here leaves the machine, and nothing is recorded. The stream goes to an
 * analyser and stops. The analyser's output is deliberately not connected, so by default the
 * audio has no route to the speakers at all — see setMonitor for the one case where it does, and
 * why that route is built separately rather than by wiring this one through.
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
let source: MediaStreamAudioSourceNode | null = null
let monitor: GainNode | null = null

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
    ctx = sharedCtx()
    const src = ctx.createMediaStreamSource(stream)
    node = ctx.createAnalyser()
    node.fftSize = 2048
    // smoothing is the difference between bars that dance and bars that flicker
    node.smoothingTimeConstant = 0.75
    src.connect(node)
    source = src
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
  setMonitor(false)
  node = null
  source = null
  monitor = null
  // the tracks first: this is what turns the browser's recording indicator off
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  // shared context — dropped, never closed. See context.ts.
  ctx = null
}

/** Is the mic currently being played back to the speakers? */
export function monitorOn(): boolean {
  return monitor != null
}

/**
 * Hear yourself — the "am I actually being picked up, and how do I sound" check.
 *
 * ⚠️ FEEDBACK IS THE WHOLE DESIGN PROBLEM. Speakers playing what a microphone is hearing is a
 * loop, and a loop with gain above one is a howl that gets louder until something clips. Three
 * things keep that in hand, and none of them is optional:
 *
 *   1. It is off until asked for, every time. Never remembered across visits — a setting that
 *      restores itself into a howl the moment a page loads is a genuinely nasty surprise.
 *   2. Gain sits below unity. Headphones make this safe outright; on speakers it is the
 *      difference between a room that rings and a room that doesn't.
 *   3. The ramp. Connecting a live gain node at full value is a step change in the waveform,
 *      which is a click straight into the ears of somebody wearing headphones. 60ms of ramp
 *      costs nothing and removes it.
 *
 * A separate node from the analyser rather than connecting that one onward, so the thing that
 * MEASURES and the thing that makes NOISE can never be confused for one another — a stray
 * connect() on the analyser would otherwise turn every visualiser into a speaker.
 */
export function setMonitor(on: boolean) {
  if (!on) {
    if (monitor && ctx) {
      // ramp down before disconnecting, for the same reason we ramp up
      const g = monitor
      try {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.02)
        setTimeout(() => {
          try {
            g.disconnect()
          } catch {
            /* context already gone */
          }
        }, 120)
      } catch {
        /* nothing playing */
      }
    }
    releaseGain('monitor')
    monitor = null
    return
  }
  if (!ctx || !source || monitor) return
  try {
    // the mixer owns the level, so the slider reaches it while it is running
    const g = makeGain(ctx, 'monitor')
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, volume('monitor')), ctx.currentTime + 0.06)
    source.connect(g)
    g.connect(ctx.destination)
    monitor = g
    // a context built before any gesture starts suspended; the button press was the gesture
    void ctx.resume().catch(() => {})
  } catch {
    monitor = null
  }
}
