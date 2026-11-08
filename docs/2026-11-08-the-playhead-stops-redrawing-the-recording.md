# The playhead stops redrawing the recording — 8 Nov 2026

Found while looking for remaining work after Evan's five items: the take editor's playhead (item 2)
had to be smooth on a phone, so it was measured on a long take rather than assumed.

**Stacked on #74**, which is stacked on #70 — the editor's latest code lives there.

## Measured

A six-minute take (an 8kHz WAV, so 5.8MB on disk and ~17 million samples once decoded), the editor
open at full view, the main thread's lost time read off a 4ms timer's late arrivals:

|                          | busy                                   | worst stall |
| ------------------------ | -------------------------------------- | ----------- |
| idle                     | 12–13 ms/s                             | 2–4 ms      |
| playing, before (steady) | **296 ms/s** — about 30% of the thread | 17 ms       |
| playing, after (steady)  | **9 ms/s**                             | 2.2 ms      |

The cause: `peaks` — one pass over every sample in view — sat inside the draw effect, and the
playhead redraws twenty times a second. Each redraw walked all ~17 million samples, about 15ms of
work, to move a one-pixel line. A selection drag paid the same on every pointer move.

## The fix

The outline is memoised on what it depends on — the recording, the width and the zoom — and the
draw reads it. Nothing else changed: the picture is **pixel-identical** (the same SHA-256 of the
canvas before and after, at the same state), zoom still recomputes it, and a drag across the take
now costs ~9ms per move including the probe's own yield.

## Not verified

On a phone. The figures are a desktop CPU's; a phone is several times slower, which is the reason
for the change, and the reason the "after" figure is the one to check on a real device.
