# The singer, in the pocket — 14 Nov 2026

Typed lyrics now land on the beat. This is still phase 0 of
[the sung-lyrics plan](2026-11-10-sung-lyrics-plan.md): pure Web Audio, nothing saved, no lyric
storage on notes.

## What was wrong

Measured in the room, on the Funk starter, with the sample line `glit-ter in the dark _ to-night`:

- **A chord sang three syllables at once.** Syllables went onto notes one each in time order, so on
  the Chords layer "glit", "ter" and "in" all started at the same instant, on the three notes of the
  first chord.
- **Everything bunched at the start.** On the slap bass (14 notes) the eight syllables took the first
  eight notes and the voice then held "night" for the last six, half the loop.
- **Played timing went straight into the voice.** A part played a little loose put every vowel a
  little off the beat.
- **The first consonant of a line was clipped** to the line's start, even when the line was waiting
  for the top of the loop and there was time for it.
- **On fast notes the consonant ate the vowel before it.** An s is 85ms; a sixteenth at 140 bpm is
  107ms.

## What it does now

`src/audio/pocket.ts`, pure and tested, decides where each syllable goes; `singer.ts` places the
consonant before each vowel, as it already did.

1. **One voice.** Notes that start within 30ms of each other are one sung note, the top one
   (`melodyOf`). That covers a chord and a strum.
2. **On the grid: the room's Snap, in the line's own feel** (`feelOf`, `snapToGrid`).
   - The grid is the room's Snap: 1/4, 1/8 or 1/16, and sixteenths when Snap is Off.
   - A swung or triplet line keeps its feel. Which grid the notes sit closest to (straight,
     triplets, or a swing measured from the line itself) is asked at sixteenths, whatever the
     Snap. The Snap then says how coarse a grid to draw in that feel. Straight wins any close call.
   - A line played a steady few milliseconds late is moved onto the beat as a whole first (its
     "lean", measured from the notes within a 32nd of a beat). A steady lean was enough to make a
     clear swing read as straight.
   - A coarse Snap has finer levels under it. A note whose point is already taken, or is closer to
     the next note, takes the nearest point one level finer. So a line of eighths on Snap 1/4 stays
     eighths instead of marching a beat later per note, while an off-beat whose beat is free moves
     onto it.
   - Two notes never share a point, a note never runs into the next, and nothing lands on the loop's
     end, which is the next pass's downbeat.
3. **Too many syllables:** the longest note a beat or more long is split, until every syllable has a
   note (`makeRoom`). The cut is the strongest point of the line's grid inside the note, nearer the
   middle on a close call, so the second syllable starts on a beat where there is one. It used to
   be half the note's length in half-beats, which only lands on a beat when the note starts on one.
   "glit-ter" on a half note sings two quarter notes. What still does not fit is counted, as before.
4. **Too many notes:** the syllables are spread (`place`), the best of every in-order placement by
   dynamic programming. The notes between syllables are holds of the vowel. The scoring:
   - a stressed syllable earns the strength of its beat (downbeat, middle of the bar, beat, eighth,
     sixteenth) and a little for a long note;
   - a light one ("the", "in", the "-ter" of glitter) loses a little for a strong beat, so it sits
     between them;
   - a run of holds costs its length squared, more inside a word than at its end, so the line
     reaches the end of the melody instead of stopping early;
   - a word that starts after a breath (a beat or more of silence) earns a little, and a hold after a
     breath costs extra, because it re-sings a vowel out of nowhere.

   The first syllable is always on the first note. Typed holds (`_`) are kept.

5. **Stress** is a guess, like the syllable split: a word leans on its first syllable, unless it
   starts with a short prefix (to-NIGHT, a-WAY, be-FORE); a short list of articles, prepositions and
   conjunctions are light.
6. **The consonant** may start before the line's first downbeat when the line is waiting for the
   top of the loop (`lead`), and never takes more than 45% of the note before it.

## Before and after, on the Funk starter (positions in beats)

| Part                                 | Before                                                           | After                                                           |
| ------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Chords                               | glit, ter, in all at 0.5; the, dark at 1.5; to, night at 2.5     | glit 0.5, ter 1.5, in 2.5, the 3.5, dark 4.5, to 6.5, night 7.5 |
| Slap bass                            | glit 0, ter 0.75, in 1.5, the 2, dark 2.5, to 3.5, night 4, held | glit 0, ter 0.75, in 1.5, the 2.75, dark 4, to 5.5, night 6     |
| 16 eighths, the line without its `_` | glit 0 … night 3, then held for the whole second bar             | glit 0, ter 0.5, in 1.5, the 2.5, dark 4, to 5.5, night 6       |

On the bass, "dark" now lands on the second bar's downbeat and "night" on beat three, with "to" as
the pickup before it; "the" sits on an off-beat. The chords are all on off-beats, so there the gain
is one syllable per chord, spread across both bars.

## Swing and triplets, swept

Two-bar lines at 70, 90, 120 and 150 bpm, played up to ±J ms loose (uniform), half of them a
steady 15ms late, four times each. A note counts as off target when it lands more than 0.03 beats
from where it was meant. "Before" is the old fixed sixteenths; the swings run from 0.15 to 0.5 of a
step late.

| Line, Snap Off             | ±0ms     | ±10ms      | ±20ms      | ±30ms       |
| -------------------------- | -------- | ---------- | ---------- | ----------- |
| Straight (16ths, 8ths, 4s) | 0% → 0%  | 0% → 0%    | 0% → 0%    | 0% → 0.9%   |
| Eighth-note triplets       | 58% → 0% | 58% → 0%   | 59% → 0.8% | 58% → 8.9%  |
| Swung eighths              | 36% → 0% | 37% → 0%   | 37% → 6.1% | 38% → 14.2% |
| Swung sixteenths           | 53% → 0% | 54% → 0.9% | 57% → 8.7% | 60% → 26.8% |

On Snap 1/8, swung eighths go from 45% off target to 0% (±0ms), 0.3% (±10ms) and 7.0% (±20ms), and
triplets to 0% up to ±20ms. A straight line pays 0.9% at ±30ms, and 2.1% at ±40ms against 0.9%
before: very loose straight playing is occasionally read as a feel.

## How it was checked

- **`pocket.test.ts`, 26 tests**, written from the song's shape: which beat a word lands on, whether
  a breath splits a word, how long one vowel is held, where a swung off-beat lands. Every scoring rule was removed once to watch
  a test fail. Three (the hold cost, the light-word dodge and the breath rules) passed when removed
  at first, so the tests that pin them were added; a fourth rule, a penalty for a word split by a
  rest, never decided anything once the other two breath rules existed, and was taken out.
- **The Snap and the feel:** ten rules were each broken once (the Snap ignored, the finer levels,
  the yield to a closer note, the lean, its window, the fit margin both ways, the swing floor, the
  loop's end, the old cut) and each turned at least one test red. Two passed at first. The swing
  floor turned out to be what stops 70:30 eighths reading as early sixteenths and losing their
  swing on Snap 1/8, so the swing test now also feeds a line placed exactly, as the arpeggio
  records it. Measuring the swing against the line's on-beats did nothing once the lean was out
  first, and was taken out. A seeded sweep in the tests holds straight lines to 0 notes moved up
  to ±20ms, and feels to under 2% moved up to ±10ms, against over 30% before.
- **The breath length was found in the room.** Counting half a beat of silence as a breath sent the
  slap bass's stressed words to whichever note followed one of its short gaps; a full beat fixed it,
  and that case is now a test.
- **`singer.test.ts`:** the first consonant comes before the downbeat when there is time, and only as
  much as there is; on sixteenths at 140 bpm the vowel keeps more than half of each note. Both were
  broken once to watch them fail.
- **Through the audio,** a path that shares no arithmetic with the planner: the slap line played up
  to 30ms loose, fitted, rendered offline, and each vowel's onset found from the low-passed envelope
  (its dip, then half its rise). Positions came out exactly on the grid, and the rise reaches half
  its level 0–20ms after the grid line in Clean and Glitchy (the attack), up to 36ms in Breathy,
  which attacks slowly on purpose. "night" in Glitchy read 46ms, because its n is already voiced.
- **In the room:** ▶ Sing starts the voice, Stop and the end of the line leave zero voices, the panel
  passes `mobileAudit` at 375, and the console has nothing new. After the Snap change: on the slap
  bass the panel's preview words change between Off, 1/8 and 1/4 and Off matches 1/16, with all 14
  notes kept, and singing at 1/4, 1/8 and Off leaves zero voices after Stop.

## Not done

- **The part under the voice still plays as it was played.** The voice is on the grid and a loose
  part is not, so they can sit a few milliseconds apart.
- **The room's Snap has no triplet or swing setting.** The feel comes from the line, so a line
  played straight is sung straight. A swing lighter than 55:45 is read as straight, and so is a
  light sixteenth swing played as loosely as it swings.
- **The stress guess is English-only and simple.** A hyphen fixes the split; nothing fixes the
  stress yet.
- **How it sounds** is for Evan's ears, and Safari and Firefox are unchecked.
