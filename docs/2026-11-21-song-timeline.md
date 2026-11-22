# The song's timeline

Evan, 21 Nov 2026: "A timeline for the main track, like the one my vocals have, showing every part
(backing, lyrics, vocal and voice clips, samples) on one shared playhead. I should be able to drag
clips and samples to a position, snapped to the beat by default with a way to turn snapping off."

## What it is

The parts list became the timeline rather than a second view of the same song. It already had a row
for every part (the backing parts from 🥁 Beats included), a row for the words and a row for each
recording on the loop, with the bars lined up in columns under a ruler. What it lacked was room and
time:

- **The bars fill the width.** A bar was a 12px tile whatever the window, so a four-bar song was a
  56px strip with three pixels to a beat. Now every bar is drawn as wide as lets the song fill the
  row, through one CSS variable (`--bar-w`) that the tiles, the ruler, the words and the recordings
  all read. At 1280px a four-bar song is 178px a bar. A long song, or a phone, still scrolls,
  because a bar is never narrower than its tile was.
- **One playhead runs down through every row** while the song plays, from the ruler to the last
  recording, and scrolls with the bars.
- **A recording is drawn where it plays**, as long as what it plays (it's cut where the pass ends),
  with its sound drawn in it, so you can see where the singing starts. Its row says where it starts
  in bars and beats.
- **The words show in their bars** once a bar is wide enough to hold some of them, and the ruler
  numbers every bar once there's room.
- **Recordings and opened files show even with no parts**, which used to hide them.

## Moving a recording

- **Drag it.** Pointer events, so a mouse, a pen and a thumb all work; up-and-down on a phone still
  scrolls the page. The move shows as you drag and is made when you let go.
- **Or focus it and use the arrow keys:** ← → a beat (a 10ms nudge with Snap off), Shift a bar,
  Home to the top. It's a slider to a screen reader, and says where it starts.
- **Snap takes** is on until you turn it off, and the choice is remembered on the device. With it
  on, a recording moves a whole beat at a time. Hold Alt while dragging to place one freely.
- **Where it goes is kept** on the loop (so a reload puts it back) and on the recording itself, so
  taking it off the loop in 🎤 Voice and putting it back returns it to the same place.
- **Only the moved recording stops** if it was sounding; the rest of the song plays on.

⚠️ **Snap moves a recording in whole beats; it does not put its start on a beat.** A recording's
start is where the recorder began, not where the sound does. A take punched in at 3.12s has its
singing on the beat at 4.0, and snapping its start to 3.0 would move every word off the beat it was
sung on. Moved in whole beats, a take that was in time stays in time. A sound that starts at the top
of the song (anything recorded with the song stopped, and every file opened from disk) is on the
grid already, so for those it is the same thing as snapping to the grid.

## Checked

- `src/audio/timeline.test.ts`, 14 tests, written from the song's shape (a 120 bpm, four-bar song
  drawn 100px a bar): bars and their gaps fill the strip and a pixel more would not; a long song
  keeps its tile size; a take dragged three-quarters of a bar keeps its singing on a beat; Snap off
  goes exactly where it is put; a tap's wobble moves nothing; it stops at the top on its own beat
  and before the end where it is still heard; bar and beat are counted from 1. Six deliberate
  mistakes were put into `timeline.ts` one at a time and each turned the tests red.
- **In Chrome at 1280 and at 375 (touch).** A drag at 1280 moved a take exactly two beats (0.254s
  to 1.504s at 96 bpm) and saved the same place on the recording; → and Shift+→ moved it a beat and
  a bar; with Snap off ← moved it 10ms. At 375 a drag moved it exactly one bar. The playhead line
  sat where the transport put it on every sample taken (52.0, 104.1, 154.6, 205.1, 257.7px into
  the bars). The ruler and the tiles start on the same pixel.
- **The bars scroll as one.** At 375 a four-bar song is wider than its strip. A recording's row had
  no ⋯ button, so its strip was 36px wider than a part's and could not scroll as far, which would
  have left its clip under the wrong bar. The empty place it keeps now takes the button's own width
  rule, and the same for the volume column on a desktop (the slider's default 2px margins were the
  last 4px). Every strip measured the same width at both sizes, and with one scrolled 21.6px all
  four followed and the clip stayed over its bar.
- `scripts/mobile-audit.js` over the song at 375: 31 controls, nothing undersized, off the edge,
  clipped or spilling. It named a planted 16×16 button in a take's lane, and went back to nothing
  when it was removed. Every take clip is at least 24px wide on a touch screen.

## Not done here, and why

- **Undo doesn't cover a move.** The room's undo is a history of the note parts (`history.ts`), and
  recordings sit beside the parts rather than among them. A move is undone by moving it back, and
  the arrow keys make that exact. Recordings in the room's history is its own piece of work.
- **Parts move by bars**, as they did: drag or tap a bar tile to rearrange. They're not dragged in
  time, because a part is notes that repeat to fill the song, not a sound placed once.
- **The view doesn't follow the playhead** on a long song that scrolls. The line hides when it's
  outside the visible bars.
- **Volume for each recording and for the words** came in the next change, item 7, and every row
  has a fader now: see `docs/2026-11-21-part-volume.md`.
