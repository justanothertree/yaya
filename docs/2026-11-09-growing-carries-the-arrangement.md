# Growing a song carries its arrangement — 9 Nov 2026

Evan's answer to one of the questions queued with the integration build: **growing a song should
extend the arrangement into the new bars.** No database change.

## What it was

A plan says which bar of a take plays in each bar of the song, and a bar past the end of a plan is
silence (`partAt`). So an arranged layer went quiet in every bar a song grew by, while an untouched
layer beside it tiled across them. The 8 Nov note (`2026-11-08-the-toggles-say-what-they-do.md`)
recorded it as deliberate and left it as a question; only the fill's _On the last bar_ moved.

## What it is now

`setBars` asks `growPlan` (arrange.ts) for every arranged layer when the song grows:

|                                       | before                    | now                   |
| ------------------------------------- | ------------------------- | --------------------- |
| two bars swapped, `2 → 4`             | `2 1 · ·`                 | `2 1 2 1`             |
| bar two silenced, `2 → 6`             | `1 · · · · ·`             | `1 · 1 · 1 ·`         |
| eight bars, `8 → 4 → 8`               | the eight                 | the eight (unchanged) |
| a fill on the last bar                | moves to the new last bar | the same              |
| a fill dragged to bar 1 of 3, `3 → 6` | `1 · · · · ·`             | `1 · · 1 · ·`         |

- **The new bars repeat what the song played**, the way tiling already does for a layer nobody
  arranged. A plan shorter than its song (possible from a file) repeats the silence it was heard
  with, not its stored entries alone.
- **Nothing already stored is rewritten**, so shrinking and growing back gives the same song.
- **The fill still on the last bar moves rather than repeats** — its button is named for where it
  plays. `followLastBar` is asked first.
- **In a jam** the grower's `setBars` grows every layer it holds, a partner's included, and that
  edit goes home to its author. `setTransport` grows nothing on arrival, on purpose — two machines
  growing one layer would be two editors.
- A legacy `play` mask needed nothing: its missing entries already play.

## Verified

- `arrange.test.ts` (7 new), `growSong.test.ts` (3, through `setBars`), `jam.test.ts` (1, two
  machines: A grows, B's own arranged layer is grown on B). Each made to fail once: `setBars`
  without `growPlan` (3 + 1 red), a phrase of only the stored entries (1), stored entries rewritten
  (3), `growPlan` asked before the fill (1).
- In the room on the dev server: Four chords at 2 bars, bars swapped → grown to 4 read
  `2 1 2 1`; 2 then 8 read `2 1 2 1 2 1 2 1`; _On the last bar_ at 8 then 10 read the fill only in
  bar 10 while the chords read `2 1 2 1 2 1 2 1 2 1`.

**Not verified:** by ear; a two-browser jam.
