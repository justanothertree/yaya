# Bass lines that fit each style — 10 Nov 2026

Evan's ask, from the loop: **"bass lines that fit each style."** The Bass row had four lines — Root
& fifth, Roots, Pulse and Walk. Each one fits any song and none of them sounds like a particular
style. This draft adds three that do, and the matching starters now pick them.

| Line      | What it plays (one bar, in sixteenths)                                                    | Starter        |
| --------- | ----------------------------------------------------------------------------------------- | -------------- |
| **Funk**  | Root on 1, the "a" of 1, the fifth on the "and" of 2, then 3 and 4 broken up the same way | Funk (on Slap) |
| **Dub**   | A long root on 1, a pickup, the fifth on 3, and a push into the next bar                  | Reggae         |
| **Bossa** | Root (dotted quarter), fifth (eighth), fifth (dotted quarter), root (eighth)              | Bossa          |

## How it works

- Each line is a short table of `[step, root or fifth, length]` in `chordPatterns.ts`, laid on the
  **loop's** bar grid rather than the chord's. A chord that starts mid-bar picks the line up where
  the bar is, so the bass and the drums agree about where the one falls.
- The fifth is the one Root & fifth already plays: the chord's top note an octave down, kept under
  the pad.
- **A chord is entered on its root.** Without that rule, a short chord whose only step was a fifth
  never sounded its root at all: in a fast Four chords, the F chord played a C. A chord too short to
  meet any step still plays its root.

## Measured

- **Tests**: these are written as notes a bass player would name, not as the table's own numbers.
  Funk is C C G C C G C with 5 of 7 notes off the beat. Dub's first note is held 5 sixteenths.
  Bossa's lengths are 6 2 6 2. The next bar starts on the next chord's root. With the lead-back on,
  the last bar still follows the line. Short chords still each sound their own root. Two
  perturbations each went red: dropping the root-first rule, and laying the line on the chord's
  grid instead of the bar's.
- **In the room**: choosing Funk, Reggae and Bossa as starters set Funk on Slap, Dub and Bossa. The
  Bass row lists all seven lines.
- **Loudness, bass layer alone with chords muted** (mean / 90th-percentile RMS from the instrument
  analyser):

  | Line         | Mean  | 90th percentile |
  | ------------ | ----- | --------------- |
  | Root & fifth | 0.204 | 0.253           |
  | Funk         | 0.164 | 0.259           |
  | Dub          | 0.162 | 0.248           |
  | Bossa        | 0.192 | 0.249           |

  The peaks match Root & fifth, which already sits level with Keys (about 0.24 on a struck note).
  The means are lower because the new lines leave rests. No gain change was needed.

- **Layout**:
  - At **375** with the backing panel open, the Bass row wraps onto two lines inside the card
    (126px tall, last control at 331px). `mobileAudit` reports zero for everything; a planted 16px
    button was reported first, to show the audit was working.
  - At **1440** the row is 64px across two lines. Every undersized target the audit lists predates
    this draft, and none is in the Bass row.
- **Keyboard**: Tab reaches each line button, Enter selects it (`aria-pressed` follows), and the
  focus ring shows.
- **Console**: no errors.

## For Evan's ears

- Whether Funk on Slap, Dub under Reggae and Bossa under Bossa sound like their styles.
