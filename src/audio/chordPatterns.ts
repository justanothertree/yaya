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
 * ⚠️ TEN, AND EACH ONE HAS TO SOUND DIFFERENT. drumPatterns' rule applies unchanged: "ten
 * variations on a backbeat with different labels is a longer list that helps nobody choose".
 * These differ in where they start and where they resolve, which is what you actually hear.
 *
 * ⚠️ FIVE MORE ON 9 NOV 2026, at Evan's ask ("around ten common ones — I'll judge by ear"), against
 * thirty drum patterns. Chosen for being everywhere AND unlike the five already here, which are
 * mostly the same four chords turned round: a long walk (Canon), a climb that lands somewhere
 * else (Rising, the "royal road" of Japanese pop), a descent (Spanish, the Andalusian cadence),
 * the circle of fifths (Circle), and a two-chord vamp to play over. All are written in major
 * degrees like the rest, so in a minor room they become the minor versions of themselves.
 *
 * ⚠️ AND NOT THE TWELVE-BAR BLUES, which is the obvious sixth. Its twelve chords are a bar each by
 * definition, and this module divides the LOOP between the chords — so in the room's default two
 * bars it would change chord six times a bar. It wants a loop that knows its own length first.
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
  {
    id: 'canon',
    name: 'Canon',
    degrees: [1, 5, 6, 3, 4, 1, 4, 5],
    hint: 'Pachelbel’s eight chords — the wedding one',
  },
  {
    id: 'rising',
    name: 'Rising',
    degrees: [4, 5, 3, 6],
    hint: 'Climbs, then lands somewhere bittersweet — J-pop and anime',
  },
  {
    id: 'spanish',
    name: 'Spanish',
    degrees: [6, 5, 4, 3],
    hint: 'Four chords stepping down — flamenco, surf rock',
  },
  {
    id: 'circle',
    name: 'Circle',
    degrees: [6, 2, 5, 1],
    hint: 'Round the circle of fifths and home — jazz and Motown',
  },
  {
    id: 'vamp',
    name: 'Two chords',
    degrees: [1, 4, 1, 4],
    hint: 'Back and forth between two — a bed to play over',
  },
]

/**
 * HOW the chords are played, as opposed to WHICH chords — the choice the beat picker has always
 * offered for drums and the backing never did. Five progressions, each held as a pad, was the
 * whole of it: harmony could be chosen and rhythm could not.
 *
 * ⚠️ EVERY STYLE IS BLOCK CHORDS — all of a triad's notes together — and that is a constraint,
 * not an omission. `leadsBack` reads the turnaround off the notes by asking whether a DIFFERENT
 * chord arrives halfway through the last slot; a broken chord plays different notes at every step,
 * so it would read as a turnaround on every bar. Arpeggiating is the keyboard's job here (the
 * room's Arpeggio picker), and a broken-chord backing waits for a reader that can tell the two
 * apart.
 *
 * ⚠️ THE FIRST IS TODAY'S SOUND, BYTE FOR BYTE, and it has no tag of its own: a layer laid before
 * styles existed reads as "pad" because that is what it is.
 */
export type ChordStyle = 'pad' | 'stabs' | 'offbeat' | 'pulse'
export const CHORD_STYLES: { id: ChordStyle; name: string; hint: string }[] = [
  { id: 'pad', name: 'Pad', hint: 'Held through each chord' },
  { id: 'stabs', name: 'Stabs', hint: 'A short chord on every beat' },
  { id: 'offbeat', name: 'Offbeat', hint: 'On the “and” of every beat — reggae, ska' },
  { id: 'pulse', name: 'Pulse', hint: 'Eighth notes that push it along' },
]

/**
 * The bass's styles, for the same reason. Root & fifth is today's, unchanged.
 *
 * ⚠️ NO OCTAVE BASS, which is the obvious fifth and was left out on purpose: its upper note lands
 * at 48–59, in the pad's own register, and "a bass crossing above the chords it is supposed to
 * sit under" is the bug this module's own test exists to catch.
 */
export type BassStyle =
  | 'rootfifth'
  | 'roots'
  | 'pulse'
  | 'walk'
  | 'funk'
  | 'dub'
  | 'bossa'
  | 'octaves'
  | 'offbeat'
export const BASS_STYLES: { id: BassStyle; name: string; hint: string }[] = [
  { id: 'rootfifth', name: 'Root & fifth', hint: 'The root, then the fifth below it' },
  { id: 'roots', name: 'Roots', hint: 'One long note per chord' },
  { id: 'pulse', name: 'Pulse', hint: 'Eighth notes on the root' },
  { id: 'walk', name: 'Walk', hint: 'A note on every beat, stepping into the next chord' },
  /* ⚠️ 10 Nov 2026 — Evan: "bass lines that fit each style". The four above fit any song; these
     three are what a particular one's bass player does, written as steps on the bar — see LINES */
  { id: 'funk', name: 'Funk', hint: 'Syncopated sixteenths that bounce around the beat' },
  { id: 'dub', name: 'Dub', hint: 'Reggae: a long note on the one, then a hook' },
  { id: 'bossa', name: 'Bossa', hint: 'Root and fifth in the dotted bossa nova rhythm' },
  {
    id: 'octaves',
    name: 'Octaves',
    hint: 'Disco: eighths jumping between the root and its octave',
  },
  { id: 'offbeat', name: 'Offbeat', hint: 'House: the root on every “and”, between the kicks' },
]

/**
 * The bass lines a particular style plays, as sixteenth-note steps across one bar.
 *
 * ⚠️ EACH IS [step, tone, length]: the sixteenth it starts on, R for the chord's root, F for its
 * fifth or L for the root an octave DOWN, and how many sixteenths it holds. Laid on the LOOP'S bar grid, not the chord's, so a
 * chord that starts mid-bar picks the line up where the bar is — the rule `hitsIn` keeps for the
 * chords, and the reason the bass and the drums agree about where the one is.
 *
 * - Funk: the one, the "a" of one, the "and" of two on the fifth, then three and four broken up
 *   the same way — off the beat as often as on it, which is what makes it bounce.
 * - Dub: a long root on the one, a pickup into three, the fifth on three, and a push into the next
 *   bar — the reggae bass that leaves room around the one-drop's snare.
 * - Bossa: root (dotted quarter), fifth (eighth), fifth (dotted quarter), root (eighth) — the
 *   bossa nova bass, every bar.
 * - Octaves: low root on the beat, the root an octave up on the "and", all bar — disco.
 * - Offbeat: the root on every "and" and nothing on the beat, so it answers the kick rather than
 *   doubling it — the house bass.
 *
 * ⚠️ THE OCTAVE GOES DOWN, NOT UP. The root already sits as high as a bass may — just under the
 * pad's floor (see underPad) — so an octave ABOVE it is inside the chords, which is the one thing
 * this module's every-key sweep refuses. L is the root an octave below, which is where a disco
 * bass player's low string is anyway.
 */
type Tone = 'R' | 'F' | 'L'
type Step = [at: number, tone: Tone, len: number]
const LINES: Partial<Record<BassStyle, Step[]>> = {
  funk: [
    [0, 'R', 2],
    [3, 'R', 1],
    [6, 'F', 1],
    [8, 'R', 2],
    [10, 'R', 1],
    [11, 'F', 1],
    [14, 'R', 1],
  ],
  dub: [
    [0, 'R', 5],
    [6, 'R', 1],
    [8, 'F', 4],
    [14, 'R', 2],
  ],
  bossa: [
    [0, 'R', 6],
    [6, 'F', 2],
    [8, 'F', 6],
    [14, 'R', 2],
  ],
  octaves: [
    [0, 'L', 1],
    [2, 'R', 1],
    [4, 'L', 1],
    [6, 'R', 1],
    [8, 'L', 1],
    [10, 'R', 1],
    [12, 'L', 1],
    [14, 'R', 1],
  ],
  offbeat: [
    [2, 'R', 2],
    [6, 'R', 2],
    [10, 'R', 2],
    [14, 'R', 2],
  ],
}

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
 * @param style how the chords are played — see CHORD_STYLES
 * @param beat seconds per beat; the rhythmic styles land on the beat grid, the pad ignores it
 */
export function progressionEvents(
  p: ChordPattern,
  loopLen: number,
  scaleDegrees: readonly number[],
  root: number,
  leadBack = false,
  style: ChordStyle = 'pad',
  beat = 0,
): { events: LoopEvent[]; len: number } {
  const L = scaleDegrees.length
  if (!L || !(loopLen > 0) || p.degrees.length === 0)
    return { events: [], len: Math.max(0, loopLen) }
  const events: LoopEvent[] = []
  for (const s of slotsOf(p, loopLen, L, leadBack)) {
    const chord = triadOf(s.degree, scaleDegrees, root, BASS)
    for (const [at, until] of hitsIn(s, style, beat))
      for (const note of chord) {
        events.push({ t: at, midi: note, on: true })
        events.push({ t: until, midi: note, on: false })
      }
  }
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}

/**
 * When a chord sounds inside its slot, as [start, end] pairs.
 *
 * ⚠️ ON THE LOOP'S BEAT GRID, NOT THE SLOT'S. Counting from each chord's own start would put a
 * stab on "beat one" of a chord that began halfway through a bar — the turnaround's half-slot is
 * exactly that — and the groove would lurch at every change. Measured from zero, every hit lands
 * where the drums do.
 *
 * ⚠️ AT LEAST ONE HIT PER CHORD, whatever the grid says. A chord slot shorter than the gap
 * between hits (a fast turnaround, an offbeat that falls past the slot's end) would otherwise be
 * a chord that never sounds — so it gets one at its start, which is the right thing to hear.
 */
function hitsIn(s: Slot, style: ChordStyle, beat: number): [number, number][] {
  const end = s.at + s.dur
  /* the pad: the whole slot, with the sliver that lets a repeat re-articulate (see HOLD) */
  if (style === 'pad' || !(beat > 0)) return [[s.at, s.at + s.dur * HOLD]]
  const step = style === 'pulse' ? beat / 2 : beat
  const offset = style === 'offbeat' ? beat / 2 : 0
  const gate = style === 'stabs' ? 0.45 * beat : style === 'offbeat' ? 0.3 * beat : 0.4 * beat
  const out: [number, number][] = []
  const eps = 1e-9
  for (let k = Math.ceil((s.at - offset - eps) / step); ; k++) {
    const t = k * step + offset
    if (t >= end - eps) break
    if (t < s.at - eps) continue
    out.push([t, Math.min(t + gate, end - (end - s.at) * (1 - HOLD))])
  }
  if (!out.length) out.push([s.at, Math.min(s.at + gate, s.at + s.dur * HOLD)])
  return out
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
 * tonic. Worked out for all ten:
 *
 *     Four chords  I V vi IV              returns to I   → V     IV then V
 *     Fifties      I vi IV V              returns to I   → V     already ends on V — nothing to add
 *     Wistful      vi IV I V              returns to vi  → iii   V then iii
 *     Simple       I IV V IV              returns to I   → V     IV then V
 *     Turnaround   ii V I I               returns to ii  → vi    I then vi
 *     Canon        I V vi iii IV I IV V   returns to I   → V     already ends on V — nothing to add
 *     Rising       IV V iii vi            returns to IV  → I     vi then I
 *     Spanish      vi V IV iii            returns to vi  → iii   already ends on iii — nothing to add
 *     Circle       vi ii V I              returns to vi  → iii   I then iii
 *     Two chords   I IV I IV              returns to I   → V     IV then V
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
  style: BassStyle = 'rootfifth',
  beat = 0,
): { events: LoopEvent[]; len: number } {
  if (!scaleDegrees.length || !(loopLen > 0) || p.degrees.length === 0)
    return { events: [], len: Math.max(0, loopLen) }
  if (style !== 'rootfifth') return otherBass(p, loopLen, scaleDegrees, root, leadBack, style, beat)
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

/** A scale step as a midi note — negative steps reach below the root, which a walk needs. */
function scaleNote(step: number, scaleDegrees: readonly number[], root: number, base: number) {
  const L = scaleDegrees.length
  return base + root + Math.floor(step / L) * 12 + scaleDegrees[((step % L) + L) % L]
}

/**
 * Below the pad, always: anything at or above the pad's floor comes down an octave.
 *
 * ⚠️ THE FLOOR IS `BASS + root`, NOT 48. The pad's lowest note moves with the key — 51 in D# —
 * and root & fifth already sits under THAT, reaching 48 in D# quite correctly. Folding at an
 * absolute 48 would drop half the roots in the higher keys an octave for no reason; caught by the
 * first run of this file's own sweep, which asserted 48 and failed on the unchanged root & fifth.
 */
const underPad = (midi: number, root: number) => (midi >= BASS + root ? midi - 12 : midi)

/**
 * The three basslines that are not root-and-fifth, on the same slots as everything else.
 *
 * ⚠️ WALK STEPS INTO THE NEXT CHORD FROM THE SCALE NOTE BELOW ITS ROOT — never a chromatic
 * approach, which is the jazz move and would put a note outside the scale under a keyboard whose
 * whole promise is that every note fits. The rest of the bar is root, third and fifth of the
 * chord it is under. "The next chord" wraps: the last slot walks into the first, because the loop
 * does.
 */
function otherBass(
  p: ChordPattern,
  loopLen: number,
  scaleDegrees: readonly number[],
  root: number,
  leadBack: boolean,
  style: BassStyle,
  beat: number,
): { events: LoopEvent[]; len: number } {
  const slots = slotsOf(p, loopLen, scaleDegrees.length, leadBack)
  const events: LoopEvent[] = []
  const add = (t: number, d: number, midi: number) => {
    events.push({ t, midi, on: true })
    events.push({ t: t + d, midi, on: false })
  }
  slots.forEach((s, i) => {
    const step = Math.max(0, s.degree - 1)
    const rootNote = underPad(scaleNote(step, scaleDegrees, root, BASS_LOW), root)
    const end = s.at + s.dur
    if (style === 'roots' || !(beat > 0)) return add(s.at, s.dur * HOLD, rootNote)
    const line = LINES[style]
    if (line) {
      /* the fifth as root & fifth plays it: the chord's top note an octave down, under the root */
      const triad = triadOf(s.degree, scaleDegrees, root, BASS_LOW)
      const fifth = underPad(triad[triad.length - 1] - 12, root)
      const tone = (t: Tone) => (t === 'R' ? rootNote : t === 'L' ? rootNote - 12 : fifth)
      const six = beat / 4
      const bar = beat * 4
      let any = false
      for (let b = Math.floor(s.at / bar - 1e-9); b * bar < end - 1e-9; b++)
        for (const [at, t, len] of line) {
          const on = b * bar + at * six
          if (on < s.at - 1e-9 || on >= end - 1e-9) continue
          /* ⚠️ A CHORD IS ENTERED ON ITS ROOT, whatever step of the line it meets first — the way a
             bass player plays a change. Without it a short chord whose only step was a fifth never
             sounded its root at all: F in a fast Four chords played a C. The low root IS its root,
             so Octaves keeps its jump rather than opening every chord on the high one. */
          const first = t === 'F' ? 'R' : t
          add(on, Math.min(len * six * HOLD, (end - on) * HOLD), tone(any ? t : first))
          any = true
        }
      /* a chord too short to meet any step of the line still sounds its root — see hitsIn */
      if (!any) add(s.at, s.dur * HOLD, rootNote)
      return
    }
    if (style === 'pulse') {
      const hits = hitsIn(s, 'pulse', beat)
      for (const [t, until] of hits) add(t, until - t, rootNote)
      return
    }
    /* walk: one note per beat that falls in this chord; the last of them leads into the next */
    const beats: number[] = []
    for (let k = Math.ceil(s.at / beat - 1e-9); k * beat < end - 1e-9; k++) beats.push(k * beat)
    if (!beats.length || beats[0] > s.at + 1e-9) beats.unshift(s.at)
    const next = slots[(i + 1) % slots.length]
    /* the scale note just under the next root. A root from this table always sits below the pad's
       floor (BASS_LOW + root + at most 11), so it is never folded and the step under it never
       needs to be — see the register test, which holds every style's roots where root & fifth
       plays them. */
    const nextStep = Math.max(0, next.degree - 1)
    const approach = scaleNote(nextStep - 1, scaleDegrees, root, BASS_LOW)
    const tones = [0, 2, 4, 2].map((up) =>
      underPad(scaleNote(step + up, scaleDegrees, root, BASS_LOW), root),
    )
    beats.forEach((t, n) => {
      const last = n === beats.length - 1 && beats.length > 1
      const until = n + 1 < beats.length ? beats[n + 1] : end
      add(t, (until - t) * HOLD, last ? approach : tones[n % tones.length])
    })
  })
  events.sort((a, b) => a.t - b.t)
  return { events, len: loopLen }
}

/**
 * Does this take already end on the chord that leans home?
 *
 * ⚠️ READ FROM THE NOTES, NOT FROM THE SETTING, and that distinction is the bug this fixes. The
 * Lead back toggle began life showing a remembered preference, which is right until a song is
 * loaded: open one built WITH a turnaround while the preference happens to be off, and the row
 * shows `Four chords` pressed — correctly, from the layer — beside `↩ Lead back` unpressed,
 * about a pad whose own piano roll plainly ends on G. Two buttons an inch apart, describing one
 * backing, and one of them lying. Measured: 15 notes ending G3 B3 D4, toggle reading false.
 *
 * ⚠️ IT COUNTS ONSETS RATHER THAN LOOKING FOR THE CHORD. A turnaround is the only thing that
 * puts a fifth chord in a four-chord progression, so "more chord starts than the pattern has
 * degrees" answers it without this needing to re-derive which degree the lead-back was, in
 * which key, under which scale — all of which the room may since have changed. The notes are
 * the evidence; the setting is only an intention.
 */
export function leadsBack(events: readonly LoopEvent[], p: ChordPattern, len: number): boolean {
  if (!p.degrees.length || !(len > 0)) return false
  /**
   * ⚠️ A DIFFERENT CHORD IN THE SECOND HALF OF THE LAST SLOT — no longer "more onsets than the
   * pattern has chords". That rule was exact while every chord was one onset (the pad), and is
   * wrong for every other style: Stabs strikes each chord once a beat, so it would read as a
   * turnaround on every take. What a lead-back actually IS — the last slot split in two, the second
   * half a different chord (see `slotsOf`) — is true in every block-chord style, so that is what
   * is asked. Still read from the notes, never from the setting: see above.
   */
  const slot = len / p.degrees.length
  const from = len - slot
  const mid = len - slot / 2
  const eps = 1e-6
  const chords = new Map<number, Set<number>>()
  for (const e of events) {
    if (!e.on || e.t < from - eps) continue
    const at = Math.round(e.t * 1e6)
    const pcs = chords.get(at) ?? new Set<number>()
    pcs.add(((e.midi % 12) + 12) % 12)
    chords.set(at, pcs)
  }
  const times = [...chords.keys()].sort((a, b) => a - b)
  if (!times.length) return false
  const first = [...chords.get(times[0])!].sort().join()
  return times.some((t) => t / 1e6 >= mid - eps && [...chords.get(t)!].sort().join() !== first)
}

/** The key a backing is laid in: the scale's degrees and the root they are counted from. */
export type Voicing = { degrees: readonly number[]; root: number }

/**
 * A backing's notes in a new key.
 *
 * ⚠️ EVAN'S CALL, 9 NOV 2026: CHANGING KEY RE-VOICES CHORDS ALREADY LAID. Until then a progression
 * was built in the key of the moment it was dropped and stayed there, so moving the Key picker
 * re-tuned the keyboard over a backing still in the old key — every lock-safe note the keyboard
 * offered was now a possible clash with what was underneath. The comment that recorded this
 * also recorded why it was not obviously yes: the layer is editable, and re-laying it would
 * silently overwrite anything somebody had changed in the roll. Both halves are kept here.
 *
 * ⚠️ SO IT FIRST ASKS WHETHER THESE ARE STILL THE NOTES THIS MODULE LAYS. `lay` is the same call
 * that made them, and it is tried in every key of every scale the room offers, with and without
 * the lead-back — the layer carries neither its key nor its lead-back, and a song does not store
 * the key, so a progression laid in D and opened in a room set to C is still recognised and moves
 * to wherever the picker now says. Recognised, it is laid again in the new key with the lead-back
 * it was found with, so length, style and turnaround all survive and the round trip C → D → C is
 * exact. `from` is tried first only because it is nearly always the answer.
 *
 * ⚠️ NOT RECOGNISED MEANS SOMEBODY CHANGED IT, AND THEN NOTHING IS REBUILT: every note moves by the
 * interval the key moved, edits included — which, for a key change alone, is exactly what
 * re-laying an unedited one would have done. A change of SCALE cannot be done to notes this cannot
 * read as degrees, so those stay in the scale they were in; the room reads that off the notes
 * (`outsideScale`) and says so, rather than remembering that it happened.
 */
export function revoice(
  events: readonly LoopEvent[],
  lay: (degrees: readonly number[], root: number, lead: boolean) => LoopEvent[],
  from: Voicing,
  to: Voicing,
  scales: readonly (readonly number[])[],
): LoopEvent[] {
  const lead = laidLead(events, lay, from, scales)
  if (lead !== null) return lay(to.degrees, to.root, lead)
  const d = to.root - from.root
  return events.map((e) => ({ ...e, midi: Math.max(0, Math.min(127, e.midi + d)) }))
}

/**
 * Does this take play a note the scale does not have?
 *
 * ⚠️ READ FROM THE NOTES, LIKE `leadsBack`, NOT FROM A RECORD OF WHAT HAPPENED. The first version
 * remembered which layers a change of scale had skipped, and the next change of KEY — which moved
 * the same edited notes along, still in their old scale — cleared the memory and the caption with
 * it: a backing in G minor under a keyboard in G major, and nothing on screen saying so. Asking
 * the notes cannot drift that way, survives a reload, and also catches a song laid in another key
 * and opened here. Anything this module lays is inside its scale by construction, so it is silent
 * for every backing nobody has touched.
 */
export function outsideScale(events: readonly LoopEvent[], v: Voicing): boolean {
  const pcs = new Set(v.degrees.map((d) => (((d + v.root) % 12) + 12) % 12))
  return events.some((e) => e.on && !pcs.has(((e.midi % 12) + 12) % 12))
}

/** the lead-back that reproduces these notes in some key, or null when nothing does */
function laidLead(
  events: readonly LoopEvent[],
  lay: (degrees: readonly number[], root: number, lead: boolean) => LoopEvent[],
  from: Voicing,
  scales: readonly (readonly number[])[],
): boolean | null {
  const mine = sorted(events)
  const tries: Voicing[] = [from]
  for (const degrees of scales) for (let root = 0; root < 12; root++) tries.push({ degrees, root })
  for (const v of tries)
    for (const lead of [false, true])
      if (sameNotes(mine, sorted(lay(v.degrees, v.root, lead)))) return lead
  return null
}

const sorted = (events: readonly LoopEvent[]) =>
  [...events].sort((a, b) => a.t - b.t || a.midi - b.midi || Number(a.on) - Number(b.on))

/**
 * ⚠️ TIMES TO A TENTH OF A MILLISECOND, NOT EXACTLY. `setBpm` rescales every event by a ratio, so
 * a progression laid at 96 and played at 120 has times that are the same numbers by a different
 * route; exact equality would call every tempo change an edit.
 */
function sameNotes(a: readonly LoopEvent[], b: readonly LoopEvent[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++)
    if (a[i].midi !== b[i].midi || a[i].on !== b[i].on || Math.abs(a[i].t - b[i].t) > 1e-4)
      return false
  return true
}
