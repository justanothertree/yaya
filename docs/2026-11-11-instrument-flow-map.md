# The Instrument room, walked: confusing and unfinished spots — 11 Nov 2026

Walked on main `dae27c8d` in the Browser pane, at 375 with touch from an empty `localStorage` (a
true first open), and at 1440. Ranked by how much each one costs somebody new. "Small" means a
draft of a few lines with no design question. The rest needs Evan's call before it is built.

## The flow as it stands

1. **First open:** keyboard, then the play bar (sound, octave, volume, Hold, Scale, Chord, Panic,
   More sound). Under ▶ Play, a three-step starter row: how fast, something to play over, and
   "press ⧉ Capture". It disappears for good once there is a layer.
2. **Sounds:** the ▾ menu shows one family at a time (8 families). ⚙ More sound holds arpeggio,
   effects and rigs.
3. **Beats & chords:** Styles, Chords, Played as, Bass (Preset, line, Sound), Beat (Genre), Fill.
4. **Recording:** ⏺ Record (from the top of the loop), ⧉ Capture (keeps what you just played),
   and, further down, 🎤 Record a take (the mic).
5. **Layers:** one card each, with name, sound, bar strip, ⬇ Keep, volume, effects, ⏺, mute
   and ✕. Clear all is below them.
6. **Song:** BPM, Bars, Snap, Undo and Redo in the transport. 📁 Library, ⬇ Keep song and ✎ New
   part in the row under it.
7. **Vocals:** 🎤 Sing lyrics (prototype), then 🎤 Record a take.
8. **Jam:** only once you are in a call. The way into a call is a tip at the bottom of the room.

## Ranked

1. **Layers don't say what they are.** A Pop style lays three rows named "1. 10 notes",
   "2. 48 notes" and "3. 8 notes". Which is the beat, which the chords and which the bass is only
   in each row's sound menu. The room already knows (every one is tagged). Name them "Beat ·
   Pop", "Chords · Four chords" and "Bass · Root & fifth", and keep "N notes" for parts somebody
   played. **Small.**
2. **Three ways to record, and only the first-run row explains them.**
   - ⏺ Record waits for the top of the loop, ⧉ Capture keeps what you just played, and 🎤 Record
     a take is the mic, about 300px lower, under the Sing prototype.
   - The one sentence that explains Capture belongs to the starter row, which is gone after the
     first layer.
   - Fix: a short caption under each, like Hold's "lets notes ring" ("from the top", "keep what
     you played"). **Small.** Moving the mic take up beside them is **Evan's call**.
3. **Jam is hard to find.**
   - The only way in is "Start a call" inside a dismissible tip at the very bottom of the room,
     under the visualiser. On a phone at first open it is at y≈2,690 of a 2,990px page.
   - After you dismiss the tip, nothing in the room says a jam exists.
   - **Evan's call:** a "🎶 Jam" entry in the song row that explains a call comes first.
4. **🥁 Pick a style opens its panel 385px below the button.** When the button is in the lower
   half of a phone screen, that is past the fold and looks like nothing happened. The code already
   records this trap for 📁 Library. Fix: bring the panel into view when it opens. **Small.**
5. **The help text talks about a computer keyboard on phones.** "four rows of your keyboard — Z and
   Q…" and "− and = move an octave" show on a touch screen. Fix: hide them on touch-only devices,
   which the room already detects (`useTouchOnly`). **Small.**
6. **"dry" on each layer reads like a status and copies your current effects onto the layer.**
   Evan's answer: rename it **Copy FX**, with a clear label, and no redesign. **Small.**
7. **On a phone the visualiser sits under the room at 582px**, with a scrolling grid of about 30
   modes until something has played (355px after). That's part of the design. Closing it by
   default on a phone would be **Evan's call**, and it is low on this list.
8. **Two 🎤 entries side by side, one of them a prototype.** Sung lyrics stays parked as Evan
   asked. Left alone.

## For the code

- **`InstrumentRoom.tsx` is 4,111 lines.** One component, from line 782 to the end, holds 28
  `useState`, 14 effects, 14 memos and about 2,150 lines of JSX.
- **`AudioHealthStrip`** (about 250 lines, a debug tool behind `localStorage.audio_debug`) lives in
  the same file.
- The split plan, one area per draft, smallest and safest first:
  1. the small row helpers and the health strip
  2. layers
  3. beats & chords
  4. song & transport
  5. sound & play bar
  6. keyboard

## The splits, as they land

Each split moves code without changing it, so each is checked by comparing the moved functions
with main byte for byte. The only difference allowed is Prettier re-wrapping a line that `export`
made too long.

| Split                                             | `InstrumentRoom.tsx` | New files                                                                              |
| ------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| (main, `dae27c8d`)                                | 4,111                |                                                                                        |
| 1. Row parts, `fxWord` and the audio health strip | 3,648                | `src/instrument/rowParts.tsx` 192, `fxWord.ts` 17 (+ test), `AudioHealthStrip.tsx` 270 |
