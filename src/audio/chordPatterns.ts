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

/**
 * How much of its slot a chord holds — a sliver of silence so repeats re-articulate.
 *
 * ⚠️ WHICH MEANS THE BACKING IS GENUINELY SILENT 4% OF THE TIME, and anything that SAMPLES it
 * once can land there. The keyboard's chord hint reads what is sounding, so in that sliver it
 * correctly shows nothing — and a probe taking a single reading gets a zero that looks exactly
 * like the feature being broken. It cost two false conclusions in one sitting: a hint reported
 * dead immediately after a progression was dropped, and a fader restored from zero reported as
 * not coming back. Both were fine, both were the gap.
 *
 * Sample across a window longer than one slot before believing a zero from anything downstream
 * of this number.
 */
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
  leadBack = false,
): { events: LoopEvent[]; len: number } {
  const L = scaleDegrees.length
  if (!L || !(loopLen > 0) || p.degrees.length === 0)
    return { events: [], len: Math.max(0, loopLen) }
  const events: LoopEvent[] = []
  for (const s of slotsOf(p, loopLen, L, leadBack)) {
    for (const note of triadOf(s.degree, scaleDegrees, root, BASS)) {
      events.push({ t: s.at, midi: note, on: true })
      events.push({ t: s.at + s.dur * HOLD, midi: note, on: false })
    }
  }
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}

/** the 1-based degree a pattern plays on step `i` */
const stepAt = (p: ChordPattern, i: number) => Math.round(p.degrees[i])

/**
 * A triad on a 1-based scale degree.
 *
 * ⚠️ SHARED BY THE PAD, THE BASS AND THE KEYBOARD'S HINT, which is the whole reason it is a
 * function. A bassline that worked out its own roots would be a second copy of this arithmetic,
 * free to disagree the first time either changed — and the way it would disagree is the bass
 * playing a different chord from the pad above it, which is the single most audible wrong thing a
 * backing can do. `chordToneClasses` joined them for the same reason from the other side: a
 * keyboard that lit up the wrong notes would be confidently teaching somebody the wrong answer.
 *
 * ⚠️ IT TAKES A DEGREE RATHER THAN A STEP INDEX NOW, because the turnaround's chord belongs to
 * no step of the pattern — it is a fifth above where the progression returns to, and the table
 * has no entry for it. Keyed on the index, the lead-back would have needed its own arithmetic
 * and the guarantee above would have stopped covering the one chord that was added last.
 */
function triadOf(
  degree: number,
  scaleDegrees: readonly number[],
  root: number,
  base: number,
): number[] {
  const L = scaleDegrees.length
  /* 1-based in the table because that is how musicians write them; 0-based here */
  const step = Math.max(0, degree - 1)
  const midi = base + root + Math.floor(step / L) * 12 + scaleDegrees[step % L]
  return chordNotes('triad', midi, scaleDegrees, root)
}

/**
 * The chord that leans back to the top — or null when the progression already does.
 *
 * ⚠️ A FIFTH ABOVE WHAT IT RETURNS TO, not simply the key's dominant, and the difference is the
 * whole reason this rule was chosen. A turnaround's job is to pull toward the chord that comes
 * next, and the chord that comes next is the progression's FIRST one, which is not always the
 * tonic. Worked out for all five:
 *
 *     Four chords  I V vi IV   returns to I   → V      IV then V
 *     Fifties      I vi IV V   returns to I   → V      already ends on V — nothing to add
 *     Wistful      vi IV I V   returns to vi  → iii    V then iii
 *     Simple       I IV V IV   returns to I   → V      IV then V
 *     Turnaround   ii V I I    returns to ii  → vi     I then vi
 *
 * The simpler rule — always play V — was the first idea and is worse: it leaves BOTH Fifties and
 * Wistful unchanged, because each already ends on V, and for Wistful that is the wrong answer
 * anyway. Wistful goes home to A minor, so the chord that leans into it is E minor, not G.
 *
 * ⚠️ AND NULL IS A REAL ANSWER, NOT A FAILURE. Fifties ends on its own dominant already; it IS a
 * turnaround, which is what doo-wop is. Adding a second V would repeat the chord rather than
 * lead anywhere, so the control says so and stays out of the way.
 *
 * ⚠️ FOUR SCALE STEPS, NOT SEVEN SEMITONES, so it stays inside whatever scale is loaded. In a
 * seven-note mode that is a fifth; in a scale of another size it is still "four steps up", which
 * is the same gesture expressed in the notes the room is actually offering. A chord from outside
 * the scale would be the one thing scale lock exists to prevent.
 */
export function leadBackStep(p: ChordPattern, scaleLen: number): number | null {
  const n = p.degrees.length
  if (!n || !(scaleLen > 0)) return null
  const first = Math.max(0, stepAt(p, 0) - 1)
  const lead = ((first + 4) % scaleLen) + 1
  return lead === stepAt(p, n - 1) ? null : lead
}

/** one chord's place in the lap: which degree, when it starts, how long it holds */
type Slot = { degree: number; at: number; dur: number }

/**
 * Where each chord of a progression falls.
 *
 * ⚠️ ONE LAYOUT, BECAUSE THE PAD AND THE BASS MUST AGREE ABOUT THE TURNAROUND TOO. They already
 * share `triadAt` so they cannot disagree about WHAT a chord is; splitting the last slot in two
 * is a question about WHEN, and a second copy of that arithmetic would let the bass change chord
 * half a beat away from the pad. That is the same failure in a smaller window, and harder to
 * hear as a cause.
 */
function slotsOf(p: ChordPattern, loopLen: number, scaleLen: number, leadBack: boolean): Slot[] {
  const n = p.degrees.length
  const slot = loopLen / n
  const out: Slot[] = p.degrees.map((_, i) => ({ degree: stepAt(p, i), at: i * slot, dur: slot }))
  const lead = leadBack ? leadBackStep(p, scaleLen) : null
  if (lead !== null) {
    const last = out[out.length - 1]
    last.dur = slot / 2
    out.push({ degree: lead, at: last.at + slot / 2, dur: slot / 2 })
  }
  return out
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
  leadBack = false,
): { events: LoopEvent[]; len: number } {
  if (!scaleDegrees.length || !(loopLen > 0) || p.degrees.length === 0)
    return { events: [], len: Math.max(0, loopLen) }
  const events: LoopEvent[] = []
  for (const s of slotsOf(p, loopLen, scaleDegrees.length, leadBack)) {
    const triad = triadOf(s.degree, scaleDegrees, root, BASS_LOW)
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
    /* ⚠️ HALVES OF THIS SLOT, not of a fixed one — so a turnaround's shortened last chord gets
       root-and-fifth in the time it actually has, instead of running past the lap's end */
    notes.forEach((midi, half) => {
      const t = s.at + half * (s.dur / 2)
      events.push({ t, midi, on: true })
      events.push({ t: t + (s.dur / 2) * HOLD, midi, on: false })
    })
  }
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}
