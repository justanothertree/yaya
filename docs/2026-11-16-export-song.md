# ⬇ Export song and ⬇ MIDI

Evan, 16 Nov 2026: "Export the whole song: add '⬇ Export song' in 📁 Songs that renders the full
mix (every part, takes, beats, effects, and the sung lyrics) to one file I can play and share from
my phone. Render offline … where possible, and fall back to real time with progress if not. WAV at
minimum; add a smaller format … if it's practical. On a phone, use the share sheet … otherwise a
download. Also offer a MIDI export of the parts' notes. Confirm the stems include the sung voice,
and fix that if they don't."

## Real time, not offline

Not possible here without rebuilding the synth. `synth.ts` builds one graph on one context at its
first note (buses, limiter, shared reverb) and the looper schedules against that clock 140ms ahead.
An offline render would need a second synth and a second scheduler, a second copy of how the song is
played, which is what `stems.ts` was written to avoid. So the export plays the song once, with a
progress bar and a Stop, and records the room's own output. It took 13s for a 10s song plus its
ring-out.

## What it makes

- A stereo WAV that starts on the song's first sample and ends when the room, the echo and the last
  word have fallen 60dB (at most 3s after the song). A third channel carries a marker started on the
  audio clock at the loop's top, so the start is exact whatever the browser buffers.
- The same pass compressed by the browser: M4A (AAC) in Chrome and Safari, WebM or Ogg (Opus) in
  Firefox. Recorded 1dB down, because it cannot be lowered afterwards and it peaked at +0.08dB.
- Share… when the browser can share the file (the small one first, else the WAV). It is a second
  tap: the share sheet only opens inside a tap, and the first has expired by the time the song is
  recorded. Downloads are always there.
- ⬇ MIDI, instant: a tempo track and one track per part, every note where the song plays it
  (arrangements included), the kit on channel 10 on General MIDI keys, each melodic part on its own
  channel with the nearest General MIDI program, and the sung part's syllables as lyric events.

## Three faults found by measuring the file

1. **The next pass played into the ring-out.** Stopping the loop at the song's end was too late:
   the scheduler had already put the next pass's first beat on the clock, and a scheduled drum hit
   plays whatever is released. The first WAV's tail opened with a full-level kick at 10.00s (peak
   −1dBFS). Fixed at the source: `endPassAt` tells the looper not to schedule past the song's end.
   After: the level falls steadily from the song's end, and the largest rise anywhere after it is
   1dB (it was 11dB). **The stems had the same fault** (each captured 40ms of the next pass); they
   use `endPassAt` too, and the drum stem's last 150ms now peak at −46.6dB.
2. **Eight samples past full scale.** The limiter lets the front of a hit through a little past 1
   (the first kick peaked at +0.1dB). The WAV is lowered by one amount until its peak is −0.3dBFS,
   only when it is over.
3. **The file was named for tomorrow.** `toISOString` is UTC; an evening in Eastern time is the next
   day there. Named by the local date now.

## The stems now include the sung voice

They did not: a bounce solos each layer and each take, and the words are sung over the song only
while ▶ Sing is on, so no stem had them. `voice.wav` is added when a part has words, sung with
everything else silent, from the same top. Measured: −15.6dB RMS.

Also found on the way: a stems bounce (or an export) of a song opened and never played tapped the
synth before it existed and recorded every instrument as silence. `tapAll` wakes the synth first.
And each stem's download link made a new object URL on every render, holding its file in memory for
the life of the page; they are made once and revoked now.

## Does it match what plays

Measured in Chrome against a live recording of the same song played with ▶ Sing the song, taken off
the same output with the same marker:

|                                  | Export                         | Played     |
| -------------------------------- | ------------------------------ | ---------- |
| Length of the song               | 10.000s                        | 10.000s    |
| First sound                      | sample 295                     | sample 300 |
| Whole song, RMS                  | −11.71dB                       | −11.25dB   |
| Each second, export minus played | −1.15 to +0.27dB, mean −0.35dB |            |

0.3dB of the difference is the ceiling; the rest is the voice's own small unevenness, which differs
every play. The voice is in the export: without it the mix would be about −14.0dB (from the stems).

## Checked

|                                              | Chrome 1440 | Chrome 375 | Firefox 1440 | Firefox 375 | WebKit 1440           | WebKit 375 |
| -------------------------------------------- | ----------- | ---------- | ------------ | ----------- | --------------------- | ---------- |
| Export records, WAV + small file             | ✓ M4A       | ✓          | ✓ WebM       | ✓ WebM      | no Web Audio: says so | same       |
| WAV under full scale, no clipping            | ✓ −0.30dB   |            | ✓ −1.5dB     | ✓ −1.6dB    |                       |            |
| ⬇ MIDI                                      | ✓           | ✓          | ✓            | ✓           | ✓                     | ✓          |
| Fits, nothing under 24px, no sideways scroll | ✓           | ✓ audit    | ✓            | ✓           | ✓                     | ✓          |

## Not checked

Real Safari, an iPhone, and the share sheet itself: the pane and desktop Firefox have no Web Share,
and Playwright's WebKit on Windows has no Web Audio. A song with a voice take (a recording) in it.
A jam: exporting stops the loop, as ⬇ Stems always has.
