# How the backing is played — 8 Nov 2026

After Evan's five feedback items: "more useful chord and bass accompaniment choices, comparable in
discoverability to choosing drum loops", built on the existing musical controls rather than a new
sequencer, with taste choices queued rather than made.

**Stacked on #78** (the play area), which is stacked on #75 — this edits the same Beats & chords
panel and replaces the bass button #75 captioned.

## What there was

The drum picker offers ~20 named rhythms in genre rows. The backing offered **which** chords — five
progressions, written as scale degrees so they follow the Key and Scale pickers — and exactly one
**way** of playing them: a held pad. The bass was one button, root then fifth. Harmony could be
chosen and rhythm could not.

## What there is now

Two rows beside the progressions, each a row of named buttons like the drum rows:

| row           | styles                                                                                                                     | the original                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Played as** | Pad · Stabs (every beat) · Offbeat (the "and" — reggae, ska) · Pulse (eighths)                                             | Pad, byte for byte          |
| **Bass**      | Root & fifth · Roots (one note a chord) · Pulse (eighths on the root) · Walk (a note a beat, stepping into the next chord) | Root & fifth, byte for byte |

- **Nothing new underneath.** Still `progressionEvents` / `basslineEvents` writing ordinary layers;
  a style is two more arguments (the style and the beat length) and a different rhythm over the
  same chord slots, so a progression, the lead-back, the key and the scale all carry over.
- **The style rides on the existing tag** — `-chords:four-stabs`, `-bass:four-walk` — so the
  pickers show what is loaded and a kept song keeps it. The original styles keep the original tag,
  so nothing saved before reads differently; a build without this reads `four-stabs` as an unknown
  progression and plays the notes.
- **Picking a style re-lays what is loaded**; with nothing loaded it is remembered for the next
  progression. Swapping progressions keeps both styles.
- **Rhythms sit on the loop's beat grid**, not each chord's — so a stab on a turnaround's half-slot
  lands where the drums do — and every chord sounds at least once, however short.
- **Walk steps in from the scale note below the next root**, never a chromatic approach: a note
  outside the scale under a keyboard whose promise is that every note fits.
- **Sound:** the rhythmic styles start on Keys (a stab on a swelling pad is barely there). A change
  of style brings its own sound **only if the layer still has the old style's sound** — chords put
  on a harp stay on the harp.
- **The bass row explains itself once:** before there are chords, all four are off and one line
  says _follows the chords — pick some first_, not four captions saying it.

### ⚠️ Lead back had to learn to read a rhythm

↩ is shown from the notes: "more chord onsets than the pattern has chords". True while every chord
was one onset — and wrong for every new style, since Stabs strikes each chord once a beat and would
have read as a turnaround on every take. It now asks what a lead-back IS: a **different chord
arriving halfway through the last slot**. The existing every-key, every-scale sweep passes
unchanged under the new rule and now runs across all four styles.

### Deliberately not offered

- **A broken-chord (arpeggio) style.** Every style here is block chords, because the lead-back
  reader compares chords; a broken chord changes notes at every step and would read as a turnaround
  everywhere. The keyboard has its own Arpeggio picker.
- **An octave bass.** Its upper note lands in the pad's register, which is the one thing this
  module's tests exist to forbid.

## How it was checked

**54 tests in `chordPatterns.test.ts`** (40 existing, untouched in substance — `leadsBack` now takes
the take's length), written as musical facts: Stabs strikes 0, 0.5 … 3.5s at 120bpm; Offbeat only on
the "and"; Pulse every eighth; every style plays the pad's chord in each slot; no chord rings into
the next; a too-short chord still sounds; Roots plays C G A F; Walk over two beats is C F · G G ·
A E · F B (wrapping into C) and over four beats C E G F; every bass style in every key stays under
that key's pad, inside the scale, and plays each root exactly where Root & fifth does. Five
sabotages, each caught by its test: offbeat on the beat, the old lead-back rule, walking in from
the root itself, folding at an absolute 48, a short chord left silent.

That last-but-one was a mistake of mine before it was a test: the first sweep asserted "below 48"
and failed on the **unchanged** Root & fifth in D#, whose pad starts at 51. The rule is "under that
key's pad", which is how the existing test states it; the helper folded at 48 too, and now folds at
the pad's floor.

**In the pane** (the app's own looper and output tap): an empty panel shows Pad pressed and the bass
off with its one reason; Stabs then Four chords lays `four-stabs` on Keys, 24 onsets; Walk lays
`four-walk`; Offbeat → Pad hands the sound back to Pad; Fifties keeps both styles; chords moved to
Harp stay on Harp through a style change; ↩ reads unpressed and pressed correctly on a Stabs layer.
**On the output, bass muted**, the level's 10th percentile over its 90th (lower = more rhythmic):
Pad **0.38 / 0.39**, Stabs **0.06**, Offbeat **0.04**, Pulse **0.33**. 375 with touch: 33 controls,
nothing undersized, sideways, spilling or clipped.

## For Evan's ears — queued, not decided

1. **Do the four chord styles and four bass styles sound like what their names say?** Nothing has
   been listened to.
2. **Pulse barely dips** (0.33 against Pad's 0.38): at 96bpm a Keys note's release fills the gap
   between eighths. Shorter notes, or a different sound?
3. **Level:** at the same gain (0.42) the Keys styles came out about **twice as loud** as the Pad
   (output p90 0.18–0.21 against 0.10). Match them by ear?
4. **The sound for rhythmic styles** is Keys — Rhodes, Pluck or Organ would each make a case
   (Organ is the reggae "bubble").

## Named, not changed

**Re-laying a layer un-mutes it** — `addPatternLayer` sets `muted: false` on a swap. True of every
progression and beat swap already; with styles it means changing how the chords are played brings a
muted bass back. Whether a swap should keep a mute is a behaviour question for the whole panel.
