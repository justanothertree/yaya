import { registerTap } from './audioTap'
import { makeGain, releaseGain } from './mixer'
import { sharedCtx } from './context'

/**
 * Something to actually watch — a file you picked, or whatever another tab is playing.
 *
 * ⚠️ NOTHING HERE UPLOADS ANYTHING. A dropped file is read by the browser into an object URL and
 * played locally; it never touches the network, never reaches Supabase, and is not stored. The
 * whole path is: your disk → an <audio> element on this page → an analyser → your speakers. When
 * you stop, the object URL is revoked and the memory goes with it.
 *
 * An <audio> element rather than decodeAudioData into a buffer, deliberately. Decoding a whole
 * file to a buffer means holding an entire album in memory and writing play, pause, seek and loop
 * by hand; an element streams, and the browser already has all four. The only thing Web Audio is
 * used for is the tap.
 *
 * ⚠️ createMediaElementSource REROUTES the element. Once an element is connected to a graph its
 * sound no longer reaches the speakers on its own — it comes out of wherever you connect it. So
 * there must always be a path to the destination, or the file plays in total silence behind a
 * moving visualiser, which is a genuinely baffling bug to look at.
 *
 * ⚠️ That path FORKS away from the analyser rather than running through it:
 *
 *     element ─┬► analyser          (measure: the full signal)
 *              └► gain ─► speakers  (hear: whatever the mixer says)
 *
 * Chaining them instead — element → gain → analyser → speakers — would look identical and be
 * subtly wrong: turning the music down would shrink the bars too, and the visualiser would fade
 * out as you made the room comfortable. See mixer.ts.
 */

let ctx: AudioContext | null = null
let el: HTMLAudioElement | null = null
let url: string | null = null
let node: AnalyserNode | null = null
let gain: GainNode | null = null
let name = ''

/** Screen/tab capture is a separate lifetime — it can be running with no file loaded. */
let shareStream: MediaStream | null = null
let shareCtx: AudioContext | null = null
let shareNode: AnalyserNode | null = null

function audioCtx(): AudioContext {
  ctx ??= sharedCtx()
  return ctx
}

export function musicName(): string {
  return name
}

export function musicEl(): HTMLAudioElement | null {
  return el
}

/**
 * Load a local file and start playing it.
 *
 * Called from a drop or a file picker, both of which are gestures, so the context is allowed to
 * start. Returns the failure as a string rather than throwing: an unplayable file is an ordinary
 * thing to hand a music player, not an exception.
 */
export async function playFile(file: File): Promise<string | null> {
  try {
    stopMusic()
    const a = new Audio()
    url = URL.createObjectURL(file)
    a.src = url
    a.loop = true
    a.crossOrigin = 'anonymous'
    const c = audioCtx()
    const srcNode = c.createMediaElementSource(a)
    node = c.createAnalyser()
    node.fftSize = 2048
    // smoothing is the difference between bars that dance and bars that strobe
    node.smoothingTimeConstant = 0.8
    // measure the full signal — this branch ends here, deliberately
    srcNode.connect(node)
    // and hear it through the mixer — the branch that keeps it audible, see the note above
    gain = makeGain(c, 'music')
    srcNode.connect(gain)
    gain.connect(c.destination)
    el = a
    name = file.name
    registerTap('music', node)
    await c.resume().catch(() => {})
    await a.play()
    return null
  } catch (e) {
    stopMusic()
    return e instanceof Error && e.name === 'NotSupportedError'
      ? 'That file type will not play in this browser.'
      : 'That file would not play.'
  }
}

export function stopMusic() {
  registerTap('music', null)
  releaseGain('music')
  try {
    gain?.disconnect()
  } catch {
    /* context already gone */
  }
  gain = null
  node = null
  if (el) {
    el.pause()
    el.src = ''
  }
  el = null
  name = ''
  if (url) URL.revokeObjectURL(url)
  url = null
}

/**
 * Watch whatever another tab or window is playing.
 *
 * ⚠️ THE ONE WAY TO SEE SPOTIFY OR YOUTUBE. A page cannot read another origin's audio — that
 * would be a monstrous privacy hole — so the only legitimate route is screen capture, where the
 * BROWSER asks permission and the person chooses what to hand over.
 *
 * Asking is not getting. getDisplayMedia has no audio-only mode, so video must be requested and
 * is thrown away immediately below. And the browser decides what audio a source may carry: on
 * Windows Chrome, "Entire screen" and a Tab both offer a "share audio" tick-box, while a single
 * WINDOW offers none — so sharing a window silently yields no sound, and the fix is to share the
 * tab instead. Same trap the call's screen share documents.
 */
export async function shareTabAudio(): Promise<string | null> {
  try {
    stopShared()
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
    // the picture is not wanted and holding it would keep a capture indicator burning for nothing
    stream.getVideoTracks().forEach((t) => t.stop())
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop())
      return 'No audio came through — pick a Tab or Entire screen and tick “share audio”.'
    }
    shareStream = stream
    shareCtx = sharedCtx()
    const src = shareCtx.createMediaStreamSource(stream)
    shareNode = shareCtx.createAnalyser()
    shareNode.fftSize = 2048
    shareNode.smoothingTimeConstant = 0.8
    src.connect(shareNode)
    // ⚠️ NOT connected to the destination, unlike the file above: this audio is already coming
    // out of the other tab's speakers. Wiring it on would play everything twice, slightly out of
    // step with itself — which sounds like a broken echo.
    registerTap('shared', shareNode)
    // the person can also stop the share from the browser's own bar, which fires this
    stream.getAudioTracks()[0]?.addEventListener('ended', () => stopShared())
    return null
  } catch {
    // they cancelled the picker, or the browser refused. Both are ordinary answers.
    stopShared()
    return null
  }
}

export function sharedOn(): boolean {
  return shareNode != null
}

export function stopShared() {
  registerTap('shared', null)
  try {
    shareNode?.disconnect()
  } catch {
    /* already gone */
  }
  shareNode = null
  shareStream?.getTracks().forEach((t) => t.stop())
  shareStream = null
  // ⚠️ the context is shared now — stopping the capture must not close it out from under the
  // call, the instrument and the music player. Dropping the reference is the whole teardown.
  shareCtx = null
}
