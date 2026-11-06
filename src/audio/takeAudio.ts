import { sharedCtx } from './context'
import { editLen, editFrames, renderSamples, type Edit } from './takeEdit'

/**
 * The edited audio of a take, as one buffer.
 *
 * ⚠️ ONE FUNCTION, ASKED BY EVERY SURFACE, and that is the whole reason it is not three lines
 * inlined in each. The editor's preview, the list's play button, the loop's scheduler and the
 * WAV export all have to agree about what a take sounds like after an edit — and the first
 * pass of this editor shipped with the list disagreeing with the other two, found only by
 * reloading the page and looking. Four readings of one list is four chances to drift; one
 * function is none.
 *
 * ⚠️ A COPY, NOT A VIEW. Web Audio can play part of a buffer — `start(when, offset, duration)`
 * — but it cannot play two parts, and an edit with a cut in it is exactly two parts. Scheduling
 * a source per span would work and would put the gap arithmetic on every call site, including
 * the looper's, which already has a boundary cut and a chop envelope reading `buf.duration`.
 * Rendering once means everything downstream sees ordinary contiguous audio and needs to know
 * nothing about editing at all.
 *
 * ⚠️ AND THE ORIGINAL IS NEVER TOUCHED. This reads the decoded source and writes a new buffer;
 * the blob in IndexedDB is not involved. See takeEdit.ts on why that matters more here than it
 * looks.
 */
export function editedBuffer(source: AudioBuffer, edit: Edit): AudioBuffer {
  const plan = editFrames(edit, source.duration, source.sampleRate)
  const frames = plan.reduce((n, p) => n + p.frames, 0)
  /* nothing to play is still a buffer — a zero-length one throws, so one frame of silence */
  if (!frames) return sharedCtx().createBuffer(source.numberOfChannels, 1, source.sampleRate)
  /* ⚠️ unedited audio is handed back as-is rather than copied. A ten-minute take is over a
     hundred megabytes of Float32 and the common case — a take nobody has edited — would
     otherwise pay for a second copy of all of it on every play. */
  if (plan.length === 1 && plan[0].offset === 0 && plan[0].frames >= source.length) return source

  const chans: Float32Array[] = []
  for (let c = 0; c < source.numberOfChannels; c++) chans.push(source.getChannelData(c))
  const cut = renderSamples(chans, edit, source.duration, source.sampleRate)
  const out = sharedCtx().createBuffer(source.numberOfChannels, frames, source.sampleRate)
  for (let c = 0; c < cut.length; c++) out.copyToChannel(cut[c] as Float32Array<ArrayBuffer>, c)
  return out
}

/**
 * How long the edited take plays, in seconds — the one figure every label should show.
 *
 * It is `editLen` rather than the rendered buffer's duration on purpose: a label must not have
 * to build a hundred megabytes of audio to say "0:08".
 */
export const editedSeconds = (edit: Edit): number => editLen(edit)
