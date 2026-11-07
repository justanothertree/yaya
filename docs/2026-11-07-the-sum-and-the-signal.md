# A backing at zero volume was ducking your hands

7 Nov 2026 · `src/audio/poly.ts`, `src/audio/synth.ts` · closes OPEN-DECISIONS §11a

## What was wrong

The instrument scales every voice so that what reaches the limiter stays at its threshold — see
`polyGain`. It worked out "what is sounding" by summing each ringing voice's **patch** level, while
the signal those voices actually make is that level times the **layer's fader**, applied at the bus
input one node further down. Two different units, one comparison.

So a backing with every fader at zero — silent, contributing nothing, measured at a post-limiter
peak of exactly **0** — still counted its full patch levels against your hands, and the room turned
itself down to make room for sound that did not exist. It cut the other way at the top of the
fader: a layer pushed past unity escaped the sum and leaned on the limiter instead.

## Reproduced before touching anything

`ducking()` in `scripts/sound-probe.js`, on `#instrument` with the four-layer backing the picker
builds (Four chords · Follow the chords · On the last bar · Straight), every fader dragged to 0,
every guard in the probe green — the room silent before each half, the backing really inaudible,
and the alone reading repeating afterwards to the last digit:

|                                     | peak   | vs alone                      |
| ----------------------------------- | ------ | ----------------------------- |
| backing running, no key             | 0      | — silent, as it must be       |
| C4 held, backing loaded but STOPPED | 0.5312 | **0.00dB** — the null control |
| C4 held, silent backing RUNNING     | 0.2480 | **−6.62dB**                   |
| C4 held again at the end            | 0.5312 | identical                     |

A second measurement of the same thing, with its own code, read **−5.47dB**. The spread is the
one §11a already recorded: the sum follows the backing's envelopes, so the duck follows its note
density and a held note pumps in time with music nobody can hear.

**And the transient form is worse than the steady one.** Hold a key over an _audible_ backing and
then pull every fader to zero without letting go: the backing goes away and the key is left at
**0.2198**, against **0.5312** for that same key alone — **7.7dB down, permanently**, because the
only thing that could have corrected it was a note nobody was going to play.

## The fix

`src/audio/poly.ts` — the arithmetic moves out of `synth.ts` into a module with no Web Audio in it,
and the sum asks each part what its fader is doing:

```ts
const g = clampFader(gainOf(r.part))
if (g <= 0) continue
sum += levelAt(r, now) * g
```

Two halves, and the second is not obvious:

- **The fader is in the sum.** One multiplication, exactly as the old comment in `synth.ts`
  proposed.
- **It is read back off the bus, not remembered on the voice.** `setLayerGain` rides the part's
  bus — its own comment says it "takes effect on whatever is already ringing" — so a gain copied
  onto the voice at note-on would disagree with the signal until that voice ended. That is the
  0.2198 above, and storing the part key instead of the gain is what fixes it.

`busGain` is now the single clamp both sides use, so the sum and the bus cannot drift apart again;
a NaN there reads as silence, because a NaN on a gain node is already silence while a NaN in the
sum would be a NaN pushed onto every bus in the room.

### Why it is its own file

The rule was plainly wrong for two months and nothing could ask about it: `synth.ts` opens an
AudioContext and `npm run test` has no audio, so the only way to find out what the scaler did was
to paste a probe into a browser. That is the sentence this repository keeps writing — see
`settings.mjs`, `verdict.ts`, `designation.ts`. `poly.test.ts` is 20 tests over numbers.

Every expectation in it is written from the room rather than from the code. The fixtures are
**flat** voices, so a voice's contribution is its level times its fader and nothing else, and the
claims are about the world: _a thing making no sound takes nothing off anything else_; _a fader at
half ducks like a patch half as loud_; _what reaches the limiter is held at the threshold and never
over it_, checked against a sum written out by hand in the test.

### Made to fail, three ways

| the mistake, put back                                                 | red   |
| --------------------------------------------------------------------- | ----- |
| the sum never sees the fader (the original bug)                       | **8** |
| the half-fix: silent layers skipped, quiet ones still counted in full | **3** |
| a corrupt fader passed on instead of read as silence                  | **2** |

The middle one is the one worth having. A suite that could not tell "exclude the silent layers"
from "count what is actually heard" would have passed a fix that still left a layer at 0.4 counting
two and a half times its weight — which is the shipped backing.

Two tests had to be strengthened to get there. "Pushing it back up ducks again, by exactly as much
as before" and the fader sweep both passed under the first perturbation, because three identical
answers satisfy "back to where it was" and a flat line is both symmetric and monotonic. They now
assert that the duck happened at all.

## Measured after

Same probe, same backing, same key, all guards green:

|                                       | before                                                    | after                              |
| ------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `ducking()`, every fader at 0         | **−6.62dB**                                               | **−0.06dB**                        |
| three alternating pairs, own code     | −5.47dB                                                   | **−0.32 / +0.24 / +0.24dB**        |
| the probe's own verdict               | _your hands are ducked by a backing that cannot be heard_ | _no ducking from a silent backing_ |
| held key, faders pulled to 0 under it | 0.2198 (−7.7dB, stranded)                                 | **0.4838** (−0.71dB)               |

With the faders at zero the backing's own pre- and post-limiter peaks both read exactly **0**, so
there is nothing in those readings but the key.

### Ordinary ducking, and what else moved

The fix is the identity at a fader of 1, and the room says so. It is not the identity anywhere
else, and both directions are the point:

| backing playing, no key                   | in (at the limiter) | out        | windows past full scale |
| ----------------------------------------- | ------------------- | ---------- | ----------------------- |
| shipped gains (0.4/0.5/0.55/0.55), before | 0.9848              | 0.9205     | 0 of 85                 |
| shipped gains, after                      | 1.3251              | 0.9970     | 0 of 60                 |
| every fader at 1, before                  | 2.1227              | 1.0807     | 10 of 230               |
| every fader at 1, after                   | 2.1913              | 1.0964     | 6 of 232                |
| every fader at maximum, before            | 2.5308              | 1.1507     | **20 of 231**           |
| every fader at maximum, after             | **1.6328**          | **1.0287** | **4 of 231**            |

- **At unity nothing changes**, as it must not: the 3% is where in the bar the window landed.
- **At the top of the fader the room now protects itself.** A hot layer used to escape the sum and
  lean on the limiter; the signal arriving at the limiter falls by nearly a decibel and the samples
  past full scale fall with it. This is §11c re-measured, and it changes what raising the ceiling
  would be worth.
- **At the shipped gains the backing is about 2.6dB louder**, because it is no longer being
  attenuated for level it was never making. Still nothing past full scale. Whether the shipped
  gains should come down to meet it is an ear's call and is recorded as §13a rather than done here.

## What this does not say

Every number above is an automated measurement of a signal. **Nothing here has been listened to.**
The limiter's own doctrine in `synth.ts` is that what it does is audible as intermodulation rather
than as volume, and no spectrum reading substitutes for an ear on a real device. Firefox and Safari
are untested; the Browser pane is Chromium.
