# The play area — 8 Nov 2026

Evan's feedback, item 1: group the keyboard, sound selection, the relevant volume controls and
Hold together; less scrolling between playing, recording and arranging; transport accessible; a
phone kept usable rather than shrunk.

**Stacked on #75** (`feat/instrument-explain-controls`) — this moves the Hold button that #75 gave a
second line to, so it cannot land first without a conflict.

## Measured first

The room had already been grouped once — PLAY, then THE SONG, then the detail — and the second
group left the row a player's hands use on the keyboard _below_ the song. With an arrangement
loaded (Four chords, Boom bap), document positions:

|                                | 1440×900 before         | after                                | 375×812 before        | after                               |
| ------------------------------ | ----------------------- | ------------------------------------ | --------------------- | ----------------------------------- |
| keys                           | 304                     | 304                                  | 219                   | 219                                 |
| Octave · Volume · Hold · Panic | **1456**                | **587**, one line under the keys     | **1565**              | **526**, two lines under the keys   |
| octave slide                   | not measured, unchanged | —                                    | 614, after the picker | **474**, straight under the keys    |
| instrument                     | a 323px grid at 587     | **a button at 655** naming the sound | 474                   | 640                                 |
| ▶ Play                        | 923 — below the fold    | **742** — on screen with the keys    | 666                   | **780** — still on the first screen |
| layers                         | 1110                    | 913                                  | 987                   | 1085                                |
| 🎤 Record a take               | 1603                    | **1182**                             | 1859                  | **1375**                            |
| page                           | 4503                    | 4312                                 | 3030                  | 2968                                |

## What moved — nothing added, nothing removed

1. **The play row** (Octave, Volume, the typing light, Hold, Panic) from below the song to directly
   under the keys, in the markup, so both layouts get it. On a phone it follows the keys and the
   octave slide by `order`, which the room already used for the keys and the picker.
2. **The octave slide** on a phone: it is written before the keys and sits under them by layout on a
   desktop, so at `order: 0` it used to land after the picker and a health note, 150px from the
   keys it moves. Now straight under them.
3. **The recordings panel** from below the sound knobs and the scale row to straight after the
   layers it is placed into.
4. **The instrument grid is a menu on a desktop too** — see below.
5. In the room's phone layout (below 780px, or a short landscape screen), the typing light is hidden —
   it explains a hardware keyboard, which also means a portrait tablet with one attached loses it —
   and Volume shares a line with Octave: the row went from 149px to 102px.

### ⚠️ The instrument grid: a recorded decision, overturned on purpose — and queued

The note on the picker said the grid was "untouched on a desktop, where it fits and browsing it is
the point". It does fit; it is also 323px, and those pixels were what kept ▶ Play below the fold at
1440×900 with the keys on screen — the exact thing the room's grouping exists to prevent, and what
item 1 asks for. So it is behind its button everywhere now. The button names the sound you have,
and **on a desktop the menu stays open while you pick**, so trying three sounds in a row still
works; a phone closes it on a pick as before. If Evan would rather it open by default on a desktop,
that is one CSS rule and a default — it is in the queue rather than assumed.

## Checked

- Positions above, measured in the pane with the same arrangement at each size.
- The moved controls still work: Octave up 4 → 5, the `-` key 5 → 4, the Volume slider to 55%
  (label follows), Hold presses, Panic present; the menu opens to 287px, a pick keeps it open on a
  desktop and the button then reads _🎼 Organ_.
- **375 with touch, the whole room** (82 controls): the first pass caught what this change broke —
  the play row's "70%" sat **29px past the screen edge**, because the shared slider rule's 6rem
  minimum did not fit the narrower label. Given a 60px floor: 0 off-edge, 0 spills, 0 sideways, 0
  undersized. Seven _wordless_ findings remain, all in the layer list and the bar ruler, which this
  diff does not touch.
- Screenshots at both sizes: the play row reads as one group under the keys.
- `npm run typecheck`, `eslint . --max-warnings 0`, 147 files / 2,767 tests, `npm run build`.

## Not verified

On a real phone — only Chromium's emulation. Whether the 67px volume slider on a phone is
comfortable to drag is a thumb question. Tablet widths between 640 and 780 get the phone ordering
and the desktop slider, and were not measured separately.
