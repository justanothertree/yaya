# The room in two halves: your sound, your song — 10 Nov 2026

Evan's third overnight ask: **a better, easier UI for all controls.** Group related controls, keep
common ones up front and advanced ones tucked away, clear labels, good on desktop and phone. Two or
three directions with one-line tradeoffs, then build the best pick. No database change.

## The three directions

1. **Your sound, then your song (built).** Everything about how the keyboard sounds sits under it,
   with the advanced parts one press away; the song controls follow in two lines by job.
   _Tradeoff: things move, so anyone who knows where Scale and the effects were has to find them
   again._
2. **Tabs: Play / Song / Sound.** One panel at a time. _Tradeoff: the least scrolling, but you
   can't tweak the sound while watching the layers, and every switch is a click._
3. **Fold, don't move.** Keep today's order and collapse only the advanced groups. _Tradeoff: the
   least disruption, but Scale and Key stay more than two screens below the keyboard on a phone._

## What was measured first

|                     | 1440×900, menu open        | 375 phone             |
| ------------------- | -------------------------- | --------------------- |
| ▶ Play             | 998 px, below the fold     | 737 px                |
| Scale / Key / Chord | 1,712 px                   | 1,844 px              |
| Effects             | 1,630 px, always on screen | 1,552 px, 280 px tall |

The instrument menu was 362 px tall at 1440: five rows of 8. An existing note records why the room
is ordered play → song → detail: the keyboard and ▶ Play used to be 1,237 px apart. That rule was
kept.

## What changed

- **The chord readout sits under the keys**, where your eyes already are.
- **One sound bar:** instrument, octave, volume, Hold, Scale, Key, Chord, Panic, and **⚙ More
  sound**. The scale's one-line description follows the bar.
- **The instrument menu shows one family at a time.** The families are Keys, Bass, Strings, Winds,
  Synth, Bells and Drums (families.ts). The family of the sound you are playing is the one shown.
  It still starts open on a desktop, as Evan asked, but it is now one row instead of five.
- **⚙ More sound** holds the arpeggio and its feel, how a chord arrives, the six effect sliders,
  and saved rigs. Whether it is open is remembered. On a phone the button reads "⚙ More" so the
  bar fits in four lines; its accessible name stays "More sound".
- **The transport is two lines by job.**
  - The loop: ▶ Play, ⏺ Record, ⧉ Capture, 🎯 Click, BPM, Bars, Snap, Undo.
  - The parts: 🥁 Beats & chords, 📁 Library, ⬇ Keep song, ✎ New part.
  - Record used to sit on the second line under Library. Nothing was hidden or renamed.

|                     | 1440×900, menu open    | 375 phone              |
| ------------------- | ---------------------- | ---------------------- |
| ▶ Play             | **872 px** (was 998)   | 816 px (was 737)       |
| Scale / Key / Chord | **662 px** (was 1,712) | **674 px** (was 1,844) |
| Effects             | behind ⚙ More sound   | behind ⚙ More         |

**The cost, named:** on a phone ▶ Play is 79 px lower, because Scale, Key and Chord now sit
between it and the keys. At 1440 the button's bottom 10 px is still under a 900 px fold.

## Verified

- `families.test.ts`:
  - every voice on the picker is in exactly one family, and no family is empty or longer than one
    desktop row
  - the families together show every voice once
  - three perturbations each turned it red once: Sub filed nowhere, Bell filed twice, Drums emptied
  - the five basses in #113 are already filed, so the list stays right after that merges
- In the room on the dev server:
  - every position in the tables above was measured
  - Bass shows Bass and Sub; picking Sub sets the instrument; Bells shows its 8
  - ⚙ More sound opens a 187 px panel holding the arpeggio, six sliders and rigs, and stays
    remembered
  - the transport reads as the two lines above
- At 375 with touch, with the menu and ⚙ More both open: `mobileAudit` read 0 sideways,
  off-edge, clipped, spilling and undersized across 141 controls, after a planted fault was
  reported and removed. The 6 tooltip-only controls it lists are the ones #108 gives names.

**Not verified:** a real phone or tablet, or Firefox and Safari. Whether this grouping is the one
you want is also open; that is a matter of taste.

**Merging:** this edits the same file as #108, #110 and #113. Expect text conflicts in
`InstrumentRoom.tsx` when they are batched; none is in shared logic.
