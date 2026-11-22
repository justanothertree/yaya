# A take lands where it was sung

Evan, 21 Nov 2026: "vocal takes and voice clips always start at the beginning of the song. A take
must land exactly where the song's playhead was when I started recording, so I can play the song,
listen along, and record over any part (punch in) and have it line up. Account for recording
latency so takes aren't late."

## Why they always started at the top

Nothing asked where the song was. `recordTake` never read the transport, and putting a take on the
loop called `placeTake(id)` with no position, which defaults to 0. The scheduler already played a
take at any `at` it was given; nothing ever gave it one.

## What happens now

- **The playhead is read when the recorder is started**, on the audio clock, not when the button is
  pressed: the microphone prompt can be open for seconds, and the song plays on meanwhile.
  ⚠️ **The moment `start()` is called, not the recorder's `start` event, and that was measured.**
  The first version used the event, which reads as the more careful choice. In Chrome a burst put
  into the recorded stream at a known time was found in the kept recording 10 ms _before_ the call
  (the recorder keeps what the stream already held) and 70 ms before the event (which waits for the
  encoder). Placed by the event the take was 69.8 ms late; placed by the call it is 0.2 ms out.
- **The round trip is taken off.** A singer sings to what they hear, which is the song
  `outputLatency` after the audio clock reached it, and their voice reaches the recorder the input's
  own latency later. Both are read from the browser (`AudioContext.outputLatency`, falling back to
  `baseLatency`; the microphone track's `latency` setting where Chrome reports it). The total is
  capped at half a second, because a larger figure is a broken report. All of this is in
  `src/audio/punchIn.ts`.
- **A take sung over a playing song goes on the song, at that place.** A take recorded with the song
  stopped waits in the list as every take used to, and goes to the top when put on.
- **Record pressed in the last beat, to sing from the top, lands at the top.** That's the commonest
  punch-in and the plain playhead gets it wrong: a take is cut at the end of each pass, so placed in
  the last half-second it played the breath before the downbeat and none of the singing. Begun in the
  last beat and running on past the end, it goes to 0 with the part before the downbeat left out
  through the take's own edit, so the editor shows the cut and Undo there gives it back. Begun during
  a count-in, the same: it lands on beat one, never late.
- **The takes it was sung over are muted, not removed**, so the new one is heard alone and the
  older attempts stay on the loop to compare. A message says so.
- **Leaving the room mid-recording keeps and places the take too.** Both paths go through one
  function outside the component, because the unmount path has no component left to set state on.
- **The place is kept with the recording** (`songAt` on the take's row), so taking it off the loop
  and putting it back keeps it there. A place past the end of the song as it is now (fewer bars or a
  faster tempo since) goes to the top instead of playing nothing.

## Checked

- `punchIn.test.ts`, 14 tests:
  - a recording begun 3.2 s into a playing song, with an 80 ms round trip, lands at 3.12 s;
  - one begun in the second pass lands where it was sung in that pass;
  - one begun with the song stopped has no place;
  - one begun in the last beat and sung past the end lands at 0 with 0.38 s left out, including when
    the transport was read against the previous pass's origin; one stopped before the end stays put;
  - one begun during a count-in lands at 0 with the count-in left out;
  - one with nothing after the downbeat is not placed; nothing lands at the very end of a pass;
  - which takes a new one is sung over, muted ones and ones that only touch excluded;
  - the round trip, including a missing, negative and absurd report.

  A stand-in microphone and MediaRecorder show that the time is read at the `start()` call, and that
  the input latency the track reports is counted. Each rule was removed once and its test went red,
  including putting the start-event anchor back.

- **In Chrome, through the real buttons.** A tone stood in for the microphone and the real
  MediaRecorder recorded it, with the song playing. The take went onto the song by itself; reading
  the burst's position out of the kept recording, its first sample was where the placement said it
  was to within 0.2 ms. Taken off the loop and put back, it returned to the same place, and the
  saved bench held it.

## Not done here, and why

- **Dragging a take to a new place** comes with the song timeline (item 6), where there's somewhere
  to drag it. Until then a take sits where it was sung.
- **A recording begun earlier than the last beat that runs past the end** is cut there each time
  round, as every take is.
- **Latency on a real phone** can only be measured on the phone. The figures used are the ones the
  browser reports; if a take still sounds early or late, dragging it is the fix, and the offset is
  worth telling me so the reported figure can be corrected.
- **Trimming the start of a placed take** still moves its singing earlier by what was trimmed, as it
  did before this change. The timeline is the place to decide that.
