# Lyrics that do not fit, and a word held into the next bar — 15 Nov 2026

Evan's follow-ups to the lyrics box: "let a bar's words carry across a held note into the next
bar, and show a clear hint when a line has more syllables than notes. Offer to fit them by adding
notes or splitting the words."

## What changes in the lyrics box

- **A line with more syllables than its bar has notes says so**, under the line:
  - "7 syllables, 5 notes, so some notes carry more than one." when the voice still sings them all,
    sharing notes. Since the sound pass (`docs/2026-11-15-singing-sound-pass.md`) that covers most
    lines.
  - "10 syllables, 4 notes: 2 not sung." in the warning colour, when even sharing cannot fit them.
- **＋ Add N notes** writes into the part the notes the voice was already squeezing in, so every
  syllable gets a note of its own and the part plays it too.
  - The new notes are the voice's own cuts, from the same `songMelody` and `share` the singer
    fits with, so nothing you hear moves.
  - Each played note keeps its start. A new note sounds as short as the one it came from, so a
    part played short is still played short.
  - A take that repeats plays the new notes in every bar it repeats in, and the box says which
    before you press it: "Adding notes changes bars 1, 3 and 5, which play the same notes."
  - Undo takes it back in one step.
- **⤵ Move "…" to bar N** takes the words that have no note of their own to the start of the next
  bar's line. Whole words only, never the line's first. In a bar with no notes, it moves the
  whole line. Undo takes it back in one step.
- **⤵ Hold "night" into this bar** shows on a bar left empty after a sung bar. It holds the word
  that bar ends on through this bar's notes, following their pitches, instead of leaving the bar
  silent. It writes the leading `_` that always did this, so the song file needs nothing new. A
  bar with its own words can still open on `_`, as the note at the top of the box says.

## Checked

- **Tests** in `songLyrics.test.ts`, each broken once to watch it fail:
  - The cuts are the voice's own: fitted before and after adding notes, the song sings the same
    syllables at the same times.
  - Played notes keep their starts and their shortness.
  - The bars a repeating or arranged take changes.
  - Moving words: whole words from the end, and a hold that opened the next line goes.
  - The hold switch: on, off, and through every note of an empty bar.
- **Rendered to a WAV:** "star" held into a wordless bar is sung for 3.1s, from beat four through
  the next bar, filling 97% of it with no gap.
- **In the room** (dev server, 375 and 1440):
  - Move, then undo, restored all four lines in one step.
  - Add 6 notes took the part from 17 notes to 23 and cleared the hint, and undo put back 17.
  - The hold switch went on (`_`, the bar showing `~ · ~`) and off again.
- **Layout audit** (`scripts/mobile-audit.js`, made to fail first with a planted 16px button):
  clean at 375 with the sheet open, and at 1440 on the side panel.

## Not checked

How it sounds through a phone speaker, Firefox and Safari (those come next), and a song kept
and reopened after Add notes. The song file already carries `events` and `lyrics`, and its round
trips are tested.
