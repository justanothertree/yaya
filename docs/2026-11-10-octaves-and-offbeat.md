# Two more bass lines: Octaves and Offbeat — 10 Nov 2026

More of "bass lines that fit each style". These two are the most recognisable bass lines that the
row could not yet play:

| Line        | What it plays (one bar, in sixteenths)                       | Where it is used                          |
| ----------- | ------------------------------------------------------------ | ----------------------------------------- |
| **Octaves** | Eighths: the low root on the beat, an octave up on the "and" | **Disco** preset, on Finger bass          |
| **Offbeat** | The root on every "and", nothing on the beat                 | **House** style and preset, on Synth bass |

- **House now plays Offbeat**, where it played Pulse. On the beat is where the kick is, so a house
  bass answers it from between the kicks rather than doubling it. The House preset follows, so the
  style still reads as its own preset.
- **A new Disco preset**: Octaves on Finger bass.

## The octave goes down, not up

The root already sits as high as a bass may: just under the pad's lowest note (see `underPad`).
An octave above it is inside the chords, which this module's every-key test refuses. So the jump
is to the root an octave **below**, which is where a disco player's low string is anyway. A test
holds the floor at B0, the low string of a five-string bass, in every key.

The rule that "a chord is entered on its root" now keeps a low root as it is, rather than swapping
it for the high one. The low one is the root too, and swapping it would open every chord with two
high notes in a row and break the jump.

## Measured

- **Tests** are written in sixteenths and note names:
  - Octaves is eight eighths that alternate by exactly +12 and −12.
  - Offbeat is steps 2, 6, 10 and 14, with nothing on a beat.
  - Both follow the chords and enter each chord on its root.
  - The every-key test (under the pad, inside the scale) now covers nine lines.
- **Perturbations:** opening every chord on the high root turns the Octaves test red. Dropping the
  low note two octaves turns it and the B0 test red.
- **In the room:** the House style lays Offbeat on Synth bass and reads "House · Synth bass". The
  Disco preset lays Octaves on Finger.
- **Loudness:** the low octave measures the same as the root on each voice. Finger E1 0.289 vs E2
  0.290; Synth bass 0.197 vs 0.187; Bass 0.439 vs 0.449; Keys 0.225. **A phone speaker will not
  reproduce E1 (41 Hz)**, so on a phone the high note carries the line, as for any bass.
- **375:** the Bass row holds nine lines in the same space as seven (172px against 171px).
  `mobileAudit` reports zero after reporting a planted fault first.
- **Console:** no errors.

**Stacked on #158** (presets, which includes #147's lines table and #153's voices).

## For Evan's ears

- Whether House sounds better on Offbeat than on Pulse, and whether Disco sounds like disco.
