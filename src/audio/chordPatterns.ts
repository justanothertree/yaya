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
  p.degrees.forEach((_, i) => {
    const t = i * slot
    for (const note of triadAt(p, i, scaleDegrees, root, BASS)) {
      events.push({ t, midi: note, on: true })
      events.push({ t: t + slot * HOLD, midi: note, on: false })
    }
  })
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}

/**
 * The chord on step `i`, from `base`.
 *
 * ⚠️ SHARED BY THE PAD, THE BASS AND THE KEYBOARD'S HINT, which is the whole reason it is a
 * function. A bassline that worked out its own roots would be a second copy of this arithmetic,
 * free to disagree the first time either changed — and the way it would disagree is the bass
 * playing a different chord from the pad above it, which is the single most audible wrong thing a
 * backing can do. `chordToneClasses` joined them for the same reason from the other side: a
 * keyboard that lit up the wrong notes would be confidently teaching somebody the wrong answer.
 */
function triadAt(
  p: ChordPattern,
  i: number,
  scaleDegrees: readonly number[],
  root: number,
  base: number,
): number[] {
  const L = scaleDegrees.length
  /* 1-based in the table because that is how musicians write them; 0-based here */
  const step = Math.max(0, Math.round(p.degrees[i]) - 1)
  const midi = base + root + Math.floor(step / L) * 12 + scaleDegrees[step % L]
  return chordNotes('triad', midi, scaleDegrees, root)
}

/** Where a bassline sits — an octave below the pad, which is where a bass is. */
const BASS_LOW = 36

/**
 * A bassline that follows the same progression.
 *
 * ⚠️ IT TAKES THE PATTERN, NOT THE LAYER, so it cannot disagree with the chords: the room looks
 * up which progression is currently loaded and hands the same one here. The alternative — a
 * second picker letting somebody choose Fifties for the bass and Wistful for the pad — is a
 * backing track at war with itself, and nothing on screen would explain why it sounded wrong.
 *
 * ⚠️ ROOT THEN FIFTH, which is the oldest bassline there is and the reason it is not just the
 * pad's bottom note an octave down. A held root doubles what the pad already says; moving to
 * the fifth halfway through the bar is what makes it a PART — and it lands on the chord changes
 * at any tempo, because it is measured in the slot rather than in beats.
 */
export function basslineEvents(
  p: ChordPattern,
  loopLen: number,
  scaleDegrees: readonly number[],
  root: number,
): { events: LoopEvent[]; len: number } {
  if (!scaleDegrees.length || !(loopLen > 0) || p.degrees.length === 0)
    return { events: [], len: Math.max(0, loopLen) }
  const slot = loopLen / p.degrees.length
  const events: LoopEvent[] = []
  p.degrees.forEach((_, i) => {
    const triad = triadAt(p, i, scaleDegrees, root, BASS_LOW)
    /**
     * The root, then the chord's top note dropped an octave — its fifth in a plain triad, and
     * whatever the scale made of that otherwise, so the bass is always inside the harmony.
     *
     * ⚠️ THE `- 12` IS NOT TIDINESS. Without it the second note is the fifth ABOVE the root,
     * which for the sixth degree lands at 52 while the pad's lowest note is 48 — the bass
     * crossing above the chords it is supposed to sit under. Caught by a test asserting
     * exactly that and failing with `expected 52 to be less than 48`. Dropping the octave is
     * also the more idiomatic line: root, then the fifth below it, which is what a bass player
     * does without thinking.
     */
    const notes = [triad[0], triad[triad.length - 1] - 12]
    notes.forEach((midi, half) => {
      const t = i * slot + half * (slot / 2)
      events.push({ t, midi, on: true })
      events.push({ t: t + (slot / 2) * HOLD, midi, on: false })
    })
  })
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}

/**
 * Which chord of the progression is sounding, `lap` of the way through the loop.
 *
 * ⚠️ THE SAME DIVISION `progressionEvents` MAKES, and that is the only property worth having. It
 * lays the chords out by `loopLen / degrees.length`, so the slot at a given point in the lap is
 * `floor(lap * degrees.length)` — anything else is a second opinion about where the chord
 * changes, and a hint that disagrees with what you can hear is worse than no hint at all.
 *
 * Clamped at both ends because `lap` comes from a clock: a position of exactly 1 is the top of
 * the next lap rather than a fifth chord in a four-chord progression.
 */
export function slotAt(p: ChordPattern, lap: number): number {
  const n = p.degrees.length
  if (n === 0) return 0
  if (!Number.isFinite(lap)) return 0
  return Math.min(n - 1, Math.max(0, Math.floor(lap * n)))
}

/**
 * The pitch classes of that chord — 0..11, no octave.
 *
 * ⚠️ CLASSES RATHER THAN NOTES, because the question is about a KEYBOARD. "Is this key one of
 * the notes in the chord playing right now" is asked of every key on screen across two octaves,
 * and the pad sounds in one of them. Comparing MIDI numbers would light up a third of the
 * answers and read as a broken hint; `% 12` is what makes the question the one being asked.
 *
 * ⚠️ AND IT IS WHAT THE PAD IS ACTUALLY PLAYING, not a chord worked out beside it. It goes
 * through `triadAt`, so the lit keys are the pad's own notes by construction — see the note
 * there. A hint built from its own arithmetic would be right until the day either changed.
 */
export function chordToneClasses(
  p: ChordPattern,
  slot: number,
  scaleDegrees: readonly number[],
  root: number,
): number[] {
  const seen = new Set<number>()
  for (const midi of chordAt(p, slot, scaleDegrees, root)) seen.add(((midi % 12) + 12) % 12)
  return [...seen].sort((a, b) => a - b)
}

/**
 * The notes the pad is holding in that slot — the chord itself, at the pitch it sounds.
 *
 * ⚠️ THE ONE PLACE EVERYTHING ELSE ASKS. The keyboard's dots want pitch classes and the readout
 * wants something `nameChord` can read, and those are two views of one chord rather than two
 * chords. Splitting them would be a third copy of `triadAt`'s arithmetic — see the note there,
 * which already has the pad and the bass hanging off it for exactly this reason.
 */
export function chordAt(
  p: ChordPattern,
  slot: number,
  scaleDegrees: readonly number[],
  root: number,
): number[] {
  if (!scaleDegrees.length || p.degrees.length === 0) return []
  const i = Math.min(p.degrees.length - 1, Math.max(0, Math.floor(slot)))
  return triadAt(p, i, scaleDegrees, root, BASS)
}
