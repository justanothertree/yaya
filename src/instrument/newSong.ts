import { FRESH_BARS, FRESH_BPM, liftTake, loadSong, loopState, type Layer } from '../audio/looper'
import { readSong, toSong, type Song } from '../audio/songFile'
import type { LibraryItem } from '../audio/library'
import { setSongName } from './songName'

/**
 * ✚ New song: start again from an empty song, without anybody losing work by accident.
 *
 * Evan, 25 Nov 2026: "there's no way to start a fresh song. Add a clear 'New song' action that
 * resets the pattern, tempo and tracks to defaults. If the current song has unsaved changes,
 * confirm before wiping it so nobody loses work by accident."
 *
 * WHAT A NEW SONG IS — the looper's own starting state, never a second copy of it:
 *   - no parts. The beat, the chords and the bass are parts too (marked ones, see backing.ts),
 *     so the pattern goes with them, and so do the words, which belong to the part that sings them;
 *   - the starting tempo and length, FRESH_BPM and FRESH_BARS, which the looper starts with;
 *   - no recordings ON THE LOOP. ⚠️ Taken off, not deleted: a take is a file in 🎤 Voice and
 *     stays there, the same line "Clear all parts" draws (Evan, 9 Nov 2026);
 *   - no name, so an export of the new song is not called after the old one.
 * What it is NOT: your instrument, octave, scale, metronome, snapping and the beat panel's picks
 * are how you play, not what you made, and they stay as you left them.
 *
 * ⚠️ "UNSAVED" IS MEASURED AGAINST THE LIBRARY, NOT REMEMBERED. Nothing here records "kept at
 * 3:02 PM, changed since": that would be a flag every one of twenty-odd edits has to set, and it
 * would not survive a reload, which brings the song back from the bench (workbench.ts) with no
 * memory of having been kept. Instead the song is compared with what you kept, read back the way
 * the library holds it: if it is exactly one of your kept songs — name aside — there is nothing
 * to lose. That is the one question that matters, and it answers itself after a reload, after
 * changing something and changing it back, and after keeping the same song under a new name.
 *
 * ⚠️ AND IT IS UNDOABLE as well as asked. The room's history (history.ts) records parts and the
 * tempo, so ↶ Undo brings the old song back; it does not hold where recordings were placed, which
 * is one reason a placed recording always asks first.
 */

type Loop = Pick<ReturnType<typeof loopState>, 'layers' | 'takes' | 'bpm' | 'bars'>

/** Nothing in it and the starting tempo: a new song would change nothing. */
export function isFresh(loop: Loop): boolean {
  return (
    !loop.layers.length && !loop.takes.length && loop.bpm === FRESH_BPM && loop.bars === FRESH_BARS
  )
}

/**
 * A song as the library would hold it, for comparing — name aside.
 *
 * ⚠️ READ BACK THROUGH `readSong`, BECAUSE THAT IS WHAT A KEPT COPY IS. `saveToLibrary` stores
 * `readSong(song)`, which tidies on the way in (lyrics trimmed, out-of-range values clamped), so
 * comparing the room's raw state with a kept copy would call a song that was kept a moment ago
 * "changed" — a question asked for nothing, every time.
 */
export function printOf(song: Song): string {
  const clean = readSong(song)
  return clean ? JSON.stringify([clean.bpm, clean.bars, clean.layers]) : ''
}

/** Whether what you have is exactly one of the songs you kept. */
export function keptAlready(loop: Loop, saved: readonly LibraryItem[]): boolean {
  if (!loop.layers.length) return false
  const now = printOf(toSong('', loop.bpm, loop.bars, loop.layers as Layer[]))
  return saved.some((it) => it.kind === 'song' && printOf(it.song) === now)
}

/**
 * Whether starting over would lose something you have not kept.
 *
 * Parts that are not exactly a kept song, or any recording placed on the loop — a kept song never
 * holds where recordings sat, so that can only be kept by not starting over. A tempo changed on
 * an empty song is not work: there is nothing to keep, and Keep itself is not offered for it.
 */
export function wouldLose(loop: Loop, saved: readonly LibraryItem[]): boolean {
  if (loop.takes.length) return true
  return loop.layers.length > 0 && !keptAlready(loop, saved)
}

/** What the room asks first. Short, and true about the recordings, which are not lost. */
export function askFirst(loop: Loop): string {
  return loop.takes.length
    ? 'Start a new song? Anything you haven’t kept will be lost. Your recordings stay in 🎤 Voice.'
    : 'Start a new song? Anything you haven’t kept will be lost.'
}

/**
 * Start a new song, asking first when that would lose something.
 *
 * @returns true when it started one; false when it was declined or there was nothing to do.
 * @param lift takes one placed recording off the loop — `liftTake`, passed in so a test can see
 *   every placed recording taken off without a browser to decode one
 */
export function startNewSong(opts: {
  saved: readonly LibraryItem[]
  confirm: (question: string) => boolean
  lift?: (takeId: string) => void
}): boolean {
  const loop = loopState()
  if (isFresh(loop)) return false
  if (wouldLose(loop, opts.saved) && !opts.confirm(askFirst(loop))) return false
  const lift = opts.lift ?? liftTake
  for (const t of [...loop.takes]) lift(t.id)
  /* stops, lets go of everything sounding, and replaces parts and tempo in one change — one step
     in the undo history, the same step opening a kept song is */
  loadSong(FRESH_BPM, FRESH_BARS, [])
  setSongName(null)
  return true
}
