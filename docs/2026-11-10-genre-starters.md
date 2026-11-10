# One press, a whole backing — 10 Nov 2026

Evan's overnight ask: **one-press genre starters, as a separate draft for him to judge by ear.**
No database change.

## What it is

A **Styles** row at the top of the backing panel. Each style lays a beat, chords played in a style,
and a bass under them, at a tempo that suits them:

| Style   | Beat                    | Chords      | Played as | Bass         | BPM |
| ------- | ----------------------- | ----------- | --------- | ------------ | --- |
| Pop     | Four on the floor (pop) | Four chords | Pulse     | Root & fifth | 110 |
| Ballad  | Half time               | Canon       | Pad       | Roots        | 72  |
| Rock    | Driving                 | Simple      | Stabs     | Pulse        | 124 |
| Hip hop | Boom bap                | Wistful     | Pad       | Roots        | 88  |
| House   | Classic house           | Two chords  | Stabs     | Pulse        | 124 |
| Funk    | Syncopated              | Two chords  | Offbeat   | Pulse        | 104 |
| Reggae  | One drop                | Simple      | Offbeat   | Roots        | 76  |
| Jazz    | Ride                    | Circle      | Pad       | Walk         | 120 |
| Bossa   | Bossa                   | Turnaround  | Pulse     | Root & fifth | 128 |
| Country | Train                   | Fifties     | Offbeat   | Root & fifth | 110 |

- **Nothing new underneath.** Each style names parts the panel already has, and the room lays them
  with the same calls the panel's buttons make. Each part swaps its own row, so a second style
  replaces the first rather than stacking on it. The rows then show what was picked, and changing
  any of them afterwards is the panel working as it always has. A style reads as pressed only while
  every part still matches it.
- **In the room's key.** Progressions are scale degrees, so a style never touches Scale or Key.
- **The tempo is set only when the song holds nothing of yours.** A tempo change rescales every
  layer, and a part you played is not a style's to speed up. With one in the song, the style
  arrives at your tempo and its tooltip says so.
- A style needs room for up to three new layers. Without it, the row says _no room for three
  layers_ instead of laying two.
- The blank page's step 2 now reads _🥁 Pick a style, a beat or some chords_.

## Verified

- `starters.test.ts`, 13 tests:
  - every style's beat, progression, chord style and bass style exist in the panel's own tables
  - its tempo is inside the room's range
  - names are unique, and no two styles lay the same backing
  - "pressed" reads back only while every part matches
  - two perturbations each turned it red once: a beat that does not exist, and Country made a copy
    of Reggae
- In the room at 1440, starting from an empty song:
  - **Reggae** laid drums, chords on Keys (the offbeat style's sound) and bass at 76 bpm, and
    started playing. Every row showed its picks.
  - **Jazz** swapped all three in place at 120. Chords moved to a pad sound, and the bass to Walk.
  - Changing the bass to Roots unpressed the style.
  - With a part of mine in the song, **Pop** arrived at 120, "at your tempo".
- At 375 with touch: `mobileAudit` read 0 sideways, off-edge, clipped, spilling and undersized
  across 190 controls, after a planted fault was reported and removed.

**Not verified:** by ear. That is the point: which styles sound right, and which beat, chords and
tempo each should use, is Evan's to judge. Once the voices draft (#113) lands, styles could also
pick a bass voice (an 808 for Hip hop, Slap for Funk). They don't yet, so this draft stays
independent of #113.
