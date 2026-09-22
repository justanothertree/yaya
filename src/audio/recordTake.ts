import { sharedCtx } from './context'

/**
 * Catching a voice.
 *
 * ⚠️ ITS OWN MICROPHONE, AND ITS OWN LIFETIME. localMic already opens one and says why it is
 * separate from the call's: two things that want a microphone for different lengths of time
 * must not share a node, or whichever finishes first blinds the other. A recorder is the third
 * of those and follows the same rule — it opens a stream when you start, and closes it the
 * moment you stop, so the browser's recording dot is on for exactly as long as something is
 * being recorded and not a second more.
 *
 * ⚠️ AND localMic IS EXPLICITLY NOT THIS. Its header says "opened for LOOKING at, not for
 * sending anywhere" and "nothing is recorded" — that promise is about the visualiser's mic and
 * this does not weaken it. Recording happens here, only when asked, and the thing it produces
 * goes to IndexedDB on this machine. See takes.ts.
 */

export type Recording = {
  /** ms since epoch, so a caller can show how long it has been going */
  from: number
  /** what it caught, or null if nothing usable arrived */
  stop: () => Promise<{ blob: Blob; len: number } | null>
  /** throw it away and let the microphone go */
  drop: () => void
}

/**
 * What the browser will actually give us.
 *
 * ⚠️ ASKED FOR IN ORDER, BECAUSE NOBODY SUPPORTS ALL OF IT. Chrome and Firefox record webm with
 * opus in it; Safari records mp4. `isTypeSupported` is the only honest way to find out, and
 * passing an unsupported type to MediaRecorder throws rather than falling back.
 */
const WANTED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export function takeFormat(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of WANTED) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      /* some builds throw rather than answer; try the next */
    }
  }
  return ''
}

export const canRecord = (): boolean =>
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

/**
 * Start recording.
 *
 * ⚠️ ECHO CANCELLATION ON, WHICH IS A TRADE AND NOT AN OVERSIGHT. With it off, a phone held
 * near its own speaker records the backing track along with the voice, and you get a take that
 * fights the song it was sung over — unusable, and not obviously so until you play it back.
 * With it on, a singer wearing headphones loses a little of the top of their voice. Most people
 * will not have headphones, and one of those two failures is recoverable by plugging some in.
 *
 * Returns null if the browser cannot record or the person says no to the microphone.
 */
export async function recordTake(): Promise<Recording | null> {
  if (!canRecord()) return null
  const type = takeFormat()
  if (type === null) return null

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    /* refused, or no microphone on this machine */
    return null
  }

  const bits: Blob[] = []
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    return null
  }
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) bits.push(e.data)
  }

  /**
   * ⚠️ THE AUDIO CLOCK, NOT THE WALL CLOCK. How long a take is decides where it sits in a loop,
   * and Date.now can be dragged sideways by the machine adjusting its time — the same clock
   * every note in the looper is already scheduled against is the one that cannot disagree with
   * them. See the scheduling note in looper.ts.
   */
  const ctx = sharedCtx()
  const began = ctx.currentTime
  rec.start()
  const from = Date.now()

  let done = false
  const release = () => {
    done = true
    stream.getTracks().forEach((t) => t.stop())
  }

  return {
    from,
    drop: () => {
      if (done) return
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
      release()
    },
    stop: () =>
      new Promise((give) => {
        if (done) return give(null)
        const len = Math.max(0, ctx.currentTime - began)
        rec.onstop = () => {
          release()
          if (!bits.length) return give(null)
          give({ blob: new Blob(bits, { type: bits[0].type || type || 'audio/webm' }), len })
        }
        try {
          rec.stop()
        } catch {
          release()
          give(null)
        }
      }),
  }
}

/**
 * Turn a stored take back into something that can be played.
 *
 * ⚠️ decodeAudioData IS DESTRUCTIVE TO ITS INPUT in some browsers — it detaches the ArrayBuffer
 * it is handed. The blob is the thing being kept, so this decodes a COPY of its bytes and never
 * the bytes themselves, or playing a take once would empty it.
 */
export async function decodeTake(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const bytes = await blob.arrayBuffer()
    return await sharedCtx().decodeAudioData(bytes.slice(0))
  } catch {
    return null
  }
}
