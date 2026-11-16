# Lyrics on the song, a menu per part, and notes copied between parts — 15 Nov 2026

Evan tested the Instrument live and asked for three changes, in this order, losing no function.

## 1 · Lyrics on a song you have already built

**Where lyrics were before:** 🎤 Voice (one of the four tools under the parts) → the "Sing lyrics ·
prototype" box → pick a part under "Notes of", type, ▶ Sing. It sang one pass of that one take,
and the words were gone when the page was.

**Now:**

- **🎤 Add lyrics** sits under the parts, beside ✎ New part. Once a part has words, a **🎤 Lyrics**
  row appears under it in the arrangement, one cell per bar (♪ where there are words) and a ▶.
- The **lyrics box** has one line per bar of the song, numbered like the ruler. Under each line it
  says what will be sung on that bar's notes (`glit · ter · in · the`, `~` for a held vowel), and
  what does not fit. A bar with no words is not sung, so a verse can leave a gap. Pasting a
  several-line verse spreads it one line to a bar. Enter moves to the next bar.
- **▶ Sing the song** plays the song from bar one with the voice, and sings it again every time
  round, until ■ (on the row or in the box) or the room's own Stop. A word changed while it plays
  is heard the next time round.
- **The words are kept.** They live on the part (`Layer.lyrics`), so the room's undo, the bench a
  reload puts back, a kept song, the jam and the profile all carry them. Lines are per SONG bar: a
  two-bar melody tiled over eight bars sings eight different lines.
- 🎤 Voice keeps a door to the same box, and the voice, Double and Harmony moved into it. The old
  prototype box (`SingPanel.tsx`) is gone; everything it did is in the new box, including
  ✎ Try a sample line.

Not touched: a syllable stored on each note (phase 1 of `2026-11-10-sung-lyrics-plan.md`).

## 2 · One menu per part

Tapping a part's name opens its **menu**: a sheet on a phone (and on a tablet, as a wider card),
a side panel on a desktop. Its ⋯ opens the same menu on its sound.

- Above the tabs: **Volume** and **Mute**.
- **Notes**: the piano roll, which used to open at the end of the room. Below it, **Copy all its
  notes to…**.
- **Sound**: Plays as, the part's **own six effects** (new: before, they could only be replaced
  with ⚙ Sound's), and Copy your sound onto it.
- **More**: Record this part again, Split (drum kits), Keep it as a loop, Delete.

**The desktop panel is not modal.** With the visuals showing it covers exactly their column. With
them hidden it pushes the room over. Either way, the keys, the transport and the parts stay
pressable.

Measured at 1440:

- **Visuals showing:** the panel starts at 826 and the visuals at 832. The room's column ends at 810.
- **Visuals hidden:** the room ends at 752 and the panel starts at 768.

**Below 1200px it is the sheet.** At 820 a side panel left the room 372px. A part's bar strip
measured 0px wide there, and its ⋯ sat 34px past the row's edge.

## 3 · Copying notes between parts

- The clipboard belongs to the room now (`noteClip.ts`), not to one editor. Copy in one part, open
  another, and **📋 Paste N notes** is there without opening ⬚ Select first.
- A paste can go **into the same bar** it came from, **at the playhead**, or **where you clicked**
  (the old behaviour).
- In a shorter part, "the same bar" means the same beat of the bar, because that part repeats.
- Nothing already there is changed. A note that would land on one of its own pitch, or off the end
  of the part, is left out and the count is said.
- **Copy all its notes to…** takes you to the other part (or a new one shaped like this one) and
  pastes there.
- Every paste is one step on the target part's own ↶, so ↶ takes it back.

## Checked

- **Tests:** `songLyrics.test.ts`, `noteClip.test.ts`, and lyrics in the every-field round trips
  in `songFile.test.ts` and `workbench.test.ts`. Each rule was broken once and its test went red:
  - all five places a song file carries the words, and the bounds on what a line may hold;
  - the song-note placement (tiled, arranged, switched-off bars, whole repetitions only, the end of
    the song);
  - a hold carried across a bar line;
  - every paste rule.
- **Against the real player:** `notesInSong` matched what the loop scheduled in one lap, note for
  note, on all five parts of a song. That included one arranged with its bars swapped, measured
  through `setScheduleListener`, which shares no code with it.
- **In the room (dev server, then the built bundle on its own port):**
  - Drew a melody in a part's menu.
  - Copied it whole to a new part: 8 notes, ↶ → 0, ↷ → 8.
  - Box-selected bar 2 and pasted it into the bass in the same bar. The view slid up two octaves to
    show it. Pasted again at the playhead, then ↶ ↶ → back to 14.
  - Typed two bars of words.
  - ▶ Sing the song: the voice stayed live across laps, and the next lap was scheduled about a
    second ahead. ■ on the row stopped the voice and left the loop. The room's Stop stopped both.
  - Escape: first drops the picks, then leaves Select, then closes, with focus back on the part's
    name.
  - The lyrics came back after a reload.
- **Layout audit** (`scripts/mobile-audit.js`, made to fail first with a planted 16px button):
  - **At 375:** the room, all three tabs and the lyrics box are clean. That took two fixes:
    - The roll's Length row was 19px on touch, now 32px. The roll had never been measured open on
      a phone.
    - ⬚ now reads "⬚ Select".
  - **At 1440 and 1200:** clean, after one fix: the Sound tab's sliders were 16px short of their
    value in the room's knob grid. The small targets left are the existing desktop bar cells and
    ruler (12px by an earlier decision), the keyboard slider, and the "together" link.

## Not checked here

- How the sung song sounds: the pane's output was muted for every run.
- Firefox, Safari, and a real phone or tablet. The tablet check in the pane uses a mouse.
- A jam with two people.
