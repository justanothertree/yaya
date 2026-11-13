# One Beat row instead of ten — 10 Nov 2026

Evan, from the loop: "an easier, cleaner UI for all the controls". The longest part of the
Beats & chords panel was ten rows of beats, Rock to Metal, nineteen buttons in all. **Every one of
them drove the same slot**: a beat from any row replaces the beat from every other. Ten labels said
less than one row does.

Now it is one row, the way the instrument menu shows one family at a time:

```
BEAT   Genre [Rock ▾]   [Straight] [Driving] [Half time]
```

- **It opens on the genre of the beat you are hearing.** Browsing another genre lasts until the
  beat changes. After that, whether you laid a beat from the genre you browsed or pressed a Style,
  the row shows the new beat's genre. With no beat, it shows what you last browsed, or Rock.
  `genreShown` in `drumPatterns.ts` decides this, as a pure function.
- **Beat now sits above Fill**, so the drum controls read in order: the beat, then its fill. The
  panel's one sentence ("Picking one swaps that row…") comes after them, and it is still true.

## Measured

- **At 375, Beats & chords open:**

  |      | Rows | Controls | Height |
  | ---- | ---- | -------- | ------ |
  | main | 15   | 49       | 1117px |
  | this | 6    | 33       | 681px  |

  The Beat row is one line (305 × 41). `mobileAudit` reports zero across 178 controls; a planted
  16px button was reported first, to show the audit was working.

- **1440:** the Beat row is one line (728 × 29).
- **In the room:**
  - It opened on Pop, matching the loaded beat.
  - Browsing Jazz showed Swing, and laying it pressed it.
  - Pressing the Funk style moved the row to Funk.
  - After browsing Metal, one Undo of the style moved it back to Jazz, with Swing pressed.
- **Keyboard:** an arrow on Genre went from Jazz to Reggae. Tab to One drop, then Enter, laid it.
- **Console:** no errors.
- **Tests:** every beat is reachable through a genre on the menu, the row opens on the loaded
  beat's genre, browsing lasts until the beat changes, and with no beat it shows what you last
  browsed. Ignoring which beat the browse was made under turns the third test red.

## For Evan

- Whether a select for the genre reads clearly. The other option was tabs, like the instrument
  families. Ten genres as tabs would take three lines on a phone, which is most of what this
  removes.
