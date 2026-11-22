import { sharedCtx } from '../audio/context'
import {
  endPassAt,
  loopLength,
  loopOrigin,
  loopState,
  setMetronome,
  startLoop,
  stopLoop,
} from '../audio/looper'
import {
  endOfSound,
  fadeOut,
  fromMarker,
  measure,
  underCeiling,
  type Captured,
  type MixStats,
} from '../audio/mixdown'
import { tapAll } from '../audio/stems'
import { toWav } from '../audio/wav'
import { singOneLap } from './singAlong'

/**
 * The whole song as one file: every part, every take, the beats, the effects and the sung words,
 * played once from the top and recorded off the room's own output.
 *
 * ⚠️ IN REAL TIME, NOT OFFLINE, and not by choice. Evan asked for an OfflineAudioContext where
 * possible, which renders faster than the song plays. It is not possible here without rebuilding
 * the synth: synth.ts builds one graph on one context the first time a note plays (its buses, its
 * limiter, its shared reverb), and the looper schedules notes against that context's clock a few
 * hundred milliseconds ahead. Rendering offline would mean a second synth and a second scheduler
 * — a second copy of the way the song is played, which is the bug class stems.ts was written to
 * avoid. So this takes the fallback he named: the song plays once, the bar says how far it has
 * got, and the file is the signal the speakers were sent. It can only differ from what plays by
 * what differs between two plays (the voice's own small unevenness), never by a second path.
 *
 * ⚠️ THREE THINGS MAKE ONE PASS INTO A FILE THAT STARTS AND ENDS WHERE THE SONG DOES.
 * - A marker. A constant 1 on a third channel, started on the audio clock at the loop's own top
 *   and stopped at its end, recorded in the same blocks as the mix, so the file starts on the
 *   song's first sample (see mixdown.fromMarker).
 * - One pass. The looper schedules 140ms ahead, so by the song's last beat the next pass's first
 *   is already on the audio clock; `endPassAt` stops it scheduling anything past the song's end,
 *   and the loop is stopped just after it to let go of anything still held.
 * - A tail. Three seconds more are recorded for the room, the echo and the last word, then cut
 *   where the sound has fallen 60dB, never before the song's own end.
 *
 * The words are sung for exactly one lap, from the same top: the voice's own sound and choices,
 * through its own part's bus, so it is in the mix the way it is when you press ▶ Sing.
 */

export type SongExport = {
  wav: Blob
  /** the same recording, compressed by the browser, when it can: m4a, webm or ogg */
  small: { blob: Blob; ext: string } | null
  stats: MixStats
}

export type ExportProgress = { at: number; of: number }

/** how far ahead of the song the recording starts, for the recorders to be running */
const LEAD = 0.12
/** how long after the song the room and the last word may ring */
const TAIL = 3
/** the loop is stopped this long after the song, to let go of anything still held */
const AFTER = 0.02
/** the loudest a file is let reach: 0.3dB under full scale */
const CEILING = 10 ** (-0.3 / 20)
/**
 * ⚠️ THE COMPRESSED COPY IS RECORDED 1dB DOWN, measured 16 Nov 2026. It cannot be brought under
 * the ceiling afterwards as the WAV is — it is encoded as it plays — and it peaked at +0.08dB: the
 * limiter's overshoot, and AAC's own on top. A decibel is room for both.
 */
const SMALL_GAIN = 10 ** (-1 / 20)

/**
 * What the browser can compress to, best for a phone first: Safari records mp4 (AAC), which an
 * iPhone plays and shares anywhere; Chrome and Firefox record Opus in webm or ogg.
 */
export const SMALL: readonly [string, string][] = [
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
  ['audio/mp4', 'm4a'],
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/webm', 'webm'],
]

export function smallFormat(): { type: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const [type, ext] of SMALL) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return { type, ext }
    } catch {
      /* some builds throw rather than answer; try the next */
    }
  }
  return null
}

const pause = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/** wait for the audio clock to reach `t`, saying how far along it is; false when cancelled */
async function until(c: AudioContext, t: number, tick: () => void, signal?: AbortSignal) {
  while (c.currentTime < t) {
    if (signal?.aborted) return false
    tick()
    await pause(10)
  }
  return true
}

/**
 * Play the song once and record it. Null when there is nothing to play, when it was cancelled,
 * or when the recording never saw the song start.
 *
 * ⚠️ AND EVERYTHING IS PUT BACK, as stems.ts does: the click, and the loop if it was running.
 */
export async function exportSong(
  say?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<SongExport | null> {
  const st = loopState()
  if (!st.layers.length && !st.takes.length) return null
  const c = sharedCtx()
  const len = loopLength()
  if (!(len > 0)) return null
  const wasPlaying = st.playing
  const wasMetronome = st.metronome
  stopLoop()
  if (wasMetronome) setMetronome(false)

  /* the mix, two channels whatever comes in, beside the marker */
  const sum = tapAll(c)
  sum.channelCount = 2
  sum.channelCountMode = 'explicit'
  sum.channelInterpretation = 'speakers'
  const split = c.createChannelSplitter(2)
  const merge = c.createChannelMerger(3)
  const mark = c.createConstantSource()
  /* ⚠️ a ScriptProcessor whose output reaches nothing is never pulled — through a silent gain, as
     stems.ts does, so it runs and adds nothing */
  const proc = c.createScriptProcessor(4096, 3, 1)
  const quiet = c.createGain()
  quiet.gain.value = 0
  sum.connect(split)
  split.connect(merge, 0, 0)
  split.connect(merge, 1, 1)
  mark.connect(merge, 0, 2)
  merge.connect(proc)
  proc.connect(quiet)
  quiet.connect(c.destination)
  const got: Captured = { left: [], right: [], mark: [] }
  proc.onaudioprocess = (e) => {
    got.left.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    got.right.push(new Float32Array(e.inputBuffer.getChannelData(1)))
    got.mark.push(new Float32Array(e.inputBuffer.getChannelData(2)))
  }

  /* the compressed copy, recorded in the same pass */
  const fmt = smallFormat()
  const fade = c.createGain()
  fade.gain.value = SMALL_GAIN
  let rec: MediaRecorder | null = null
  const bits: Blob[] = []
  if (fmt)
    try {
      const dest = c.createMediaStreamDestination()
      sum.connect(fade)
      fade.connect(dest)
      rec = new MediaRecorder(dest.stream, { mimeType: fmt.type, audioBitsPerSecond: 128_000 })
      rec.ondataavailable = (e) => {
        if (e.data.size) bits.push(e.data)
      }
      rec.start()
    } catch {
      rec = null
    }
  const stopped = () =>
    new Promise<void>((done) => {
      if (!rec || rec.state === 'inactive') return done()
      rec.onstop = () => done()
      rec.stop()
    })

  let hush: (() => void) | null = null
  let finished = false
  try {
    startLoop(LEAD)
    const top = loopOrigin()
    mark.start(top)
    mark.stop(top + len)
    endPassAt(top + len)
    hush = singOneLap(top)
    const of = len + TAIL
    const tick = () => say?.({ at: Math.min(of, Math.max(0, c.currentTime - top)), of })
    if (!(await until(c, top + len + AFTER, tick, signal))) return null
    stopLoop()
    if (!(await until(c, top + len + TAIL, tick, signal))) return null
    /* the compressed copy fades out rather than stopping mid-ring */
    const now = c.currentTime
    fade.gain.setValueAtTime(SMALL_GAIN, now)
    fade.gain.linearRampToValueAtTime(0, now + 0.3)
    await pause(350)
    finished = true
  } finally {
    proc.onaudioprocess = null
    await stopped()
    /* the marker's own stop is already on the clock; apart, every node here is let go */
    for (const n of [sum, split, merge, mark, proc, quiet, fade])
      try {
        n.disconnect()
      } catch {
        /* already apart */
      }
    hush?.()
    stopLoop()
    if (wasMetronome) setMetronome(true)
    if (wasPlaying) startLoop()
  }
  if (!finished) return null

  const mix = fromMarker(got)
  if (!mix) return null
  const rate = c.sampleRate
  const end = endOfSound(mix.left, mix.right, Math.round(len * rate), rate)
  const left = mix.left.slice(0, end)
  const right = mix.right.slice(0, end)
  /* a long ring that outlasted the tail fades over its last 0.3s; a cut at the floor over 20ms */
  fadeOut(left, right, Math.round((end >= mix.left.length ? 0.3 : 0.02) * rate))
  /* ⚠️ UNDER FULL SCALE, MEASURED 16 Nov 2026. The room's limiter lets the front of a hit through
     a little past 1 — the first kick of a test song peaked at +0.1dB, and a WAV holds nothing past
     1, so eight samples were flattened. The whole file comes down just enough instead, the same
     amount everywhere, so nothing in it changes but how loud it is at its very loudest. */
  underCeiling(left, right, CEILING)
  return {
    wav: toWav([left, right], rate),
    small:
      rec && bits.length && fmt ? { blob: new Blob(bits, { type: fmt.type }), ext: fmt.ext } : null,
    stats: measure(left, right, rate),
  }
}
