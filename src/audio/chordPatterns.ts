import { chordNotes } from './chords'
import type { LoopEvent } from './looper'

/**
 * Chords to start from.
 *
 * ⚠️ THE SAME BLANK-PAGE PROBLEM `drumPatterns.ts` NAMES, one floor up. Its header puts it
 * exactly: "somebody who does not play an instrument needs a bar of something in front of them
 * before any of the rest of it means anything". Beats solved that for rhythm and left harmony
 * where it was — so a person who cannot play could get a groove going and still had nothing to
 * play OVER. Scale lock means every key they press is a right note; a progression underneath is
 * what makes those right notes sound like music rather than like scales.
 *
 * ⚠️ WRITTEN AS SCALE DEGREES, NOT AS CHORDS, and that is the whole design. `[1, 5, 6, 4]` is
 * the four-chord song in any key and any mode: in C major it is C–G–Am–F, in A minor it is
 * Am–Em–F–Dm, and nobody had to type either. It transposes with the room's Key picker and
 * re-colours with its Scale picker for free, because the notes come from `chordNotes` — the
 * same function the Chord picker uses, so a dropped progression and a chord you play by hand
 * are built by one piece of code and cannot disagree.
 *
 * ⚠️ AND THEY ARE ORDINARY LAYERS once inserted — the rule drumPatterns sets and the reason not
 * to build a mechanism. No progression player, no chord track: these are the same events a
 * recorded take has, so mute, re-voice, drag the bars, open the notes and edit them all work the
 * moment one lands. A progression you cannot edit is a toy; one that is a take you did not have
 * to play is a starting point.
 */

export type ChordPattern = {
  id: string
  name: string
  /** 1-based scale degrees, one per chord, in order. */
  degrees: number[]
  /** what it is for, in the picker's title */
  hint: string
}

/**
 * ⚠️ FIVE, AND EACH ONE HAS TO SOUND DIFFERENT. drumPatterns' rule applies unchanged: "ten
 * variations on a backbeat with different labels is a longer list that helps nobody choose".
 * These differ in where they start and where they resolve, which is what you actually hear.
 */
export const CHORD_PATTERNS: ChordPattern[] = [
  { id: 'four', name: 'Four chords', degrees: [1, 5, 6, 4], hint: 'The one most songs use' },
  { id: 'fifties', name: 'Fifties', degrees: [1, 6, 4, 5], hint: 'Doo-wop — warm and circular' },
  {
    id: 'sad',
    name: 'Wistful',
    degrees: [6, 4, 1, 5],
    hint: 'The same four, started on the sad one',
  },
  { id: 'simple', name: 'Simple', degrees: [1, 4, 5, 4], hint: 'Three chords, nothing clever' },
  { id: 'turnaround', name: 'Turnaround', degrees: [2, 5, 1, 1], hint: 'Leans home, then rests' },
]

/**
 * Where the progression sits.
 *
 * ⚠️ AN OCTAVE BELOW THE KEYBOARD'S DEFAULT, which is 60. A backing part voiced in the same
 * register as the hand playing over it is not a backing part, it is a second melody competing
 * for the same notes — and the most likely thing somebody does right after dropping one of
 * these is play on top of it.
 */
const BASS = 48

/** How much of its slot a chord holds — a sliver of silence so repeats re-articulate. */
const HOLD = 0.96

/**
 * A progression as loop events, filling exactly one lap.
 *
 * ⚠️ THE LENGTH IS THE LOOP'S, NOT THE PATTERN'S, which is the opposite of what drumPatterns
 * does and is right for the opposite reason. A beat is a bar of rhythm that TILES — the
 * scheduler repeats any take shorter than the loop, so a one-bar beat works in a sixteen-bar
 * song. Harmony does not tile that way: four chords squeezed into the first bar of a four-bar
 * loop and then three bars of silence is not the progression anybody meant. Dividing the lap
 * between the chords means it fits whatever the Bars control says, and each chord simply gets
 * longer in a longer song.
 *
 * @param scaleDegrees the active scale's degrees — Chromatic has none that answer "the fifth
 *   degree", so the room passes the major degrees, exactly as the Chord picker does
 * @param root the key, as a pitch class
 */
export function progressionEvents(
  p: ChordPattern,
  loopLen: number,
  scaleDegrees: readonly number[],
  root: number,
): { events: LoopEvent[]; len: number } {
  const L = scaleDegrees.length
  if (!L || !(loopLen > 0) || p.degrees.length === 0)
    return { events: [], len: Math.max(0, loopLen) }
  const slot = loopLen / p.degrees.length
  const events: LoopEvent[] = []
  p.degrees.forEach((degree, i) => {
    /* 1-based in the table because that is how musicians write them; 0-based here */
    const step = Math.max(0, Math.round(degree) - 1)
    const midi = BASS + root + Math.floor(step / L) * 12 + scaleDegrees[step % L]
    const t = i * slot
    for (const note of chordNotes('triad', midi, scaleDegrees, root)) {
      events.push({ t, midi: note, on: true })
      events.push({ t: t + slot * HOLD, midi: note, on: false })
    }
  })
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}
