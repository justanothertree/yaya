# Drive: an overdrive guitar and a fuzz bass — 10 Nov 2026

Evan, from the loop: "more instruments (especially bass…)". The synth had no distortion at all,
so a driven guitar and a fuzz bass could not exist. Now a voice can carry a **drive**: a soft
clipper (`WaveShaperNode`, tanh) that the note is pushed into.

- **🔥 Overdrive guitar**, in Strings beside the clean one.
- **🌀 Fuzz bass**, in Bass, with a **Fuzz rock** preset (Roots on Fuzz).
- **Pluck moved from Strings to Synth.** It is a saw through a resonant filter that slams shut,
  a synth pluck rather than a string, and Strings needed the room to stay one row of eight with
  two guitars in it.

## How drive works

- **The clipper goes before the envelope.** The partials' shares sum to 1, so what reaches it
  never exceeds ±1, the range its curve is drawn over. The envelope after it still decides the
  peak, so `level` keeps its meaning. After the envelope, a driven note would come out louder than
  its own level by however much the clipper squashed it.
- **`driveCurve`** is pure and exported: tanh normalised so ±1 stays ±1, odd, never folding back,
  and memoised, since a voice is made for every note. It runs with `oversample: '2x'` to keep
  most of the aliasing out, and it is disconnected with the rest of the voice.

## Measured, and what that changed

The first version was wrong in a way only the measurement could show. Overdrive was a **triangle**
going in, and a clipped triangle is a trapezoid whose harmonics still fall as 1/n². It measured
**darker than the clean guitar**: 2.8% of its energy above 1 kHz at C4, against 16.4%. Fuzz's
filter shut at 900 Hz and left **0%** above 1 kHz, a fuzz with the fuzz filtered off. Both were
also about 5 dB louder than Keys. Both now take a **saw**, with the filter open (2.6 kHz and
2.4 kHz) and lower levels.

Measured with the real synth (attack RMS 60–180 ms, held 0.8–0.95 s):

| Note                     | Attack | Held  | Peak  | Peak ÷ RMS |
| ------------------------ | ------ | ----- | ----- | ---------- |
| Keys C4                  | 0.244  | 0.072 | 0.461 | 1.9        |
| Electric guitar C4       | 0.224  | 0.096 | 0.633 | 2.8        |
| **Overdrive guitar C4**  | 0.258  | 0.184 | 0.430 | **1.7**    |
| Pick bass E2             | 0.242  | 0.153 | 0.664 | 2.7        |
| **Fuzz bass E2**         | 0.304  | 0.221 | 0.516 | **1.7**    |
| Overdrive chord E3 B3 E4 | 0.389  | 0.330 | 0.906 |            |
| Keys chord E3 B3 E4      | 0.251  | 0.108 | 0.922 |            |

- **The drive shows where it should.** The peak-to-RMS ratio drops (1.7 against 2.8 and 2.7),
  which is compression, and the note holds far more of its level (Overdrive keeps 71% at 0.8 s
  where the clean guitar keeps 30%).
- **Overdrive attacks level with Keys** (0.258 vs 0.244). Fuzz sits inside the basses
  (0.24–0.44). A three-note overdrive chord peaks at 0.906, below the same chord on Keys.

## Other checks

- **Tests:**
  - The curve keeps ±1 at ±1 and 0 at 0, read the way a `WaveShaperNode` reads it, by
    interpolation. It is odd and monotonic, and it pushes quiet signal up harder the more it is
    driven.
  - Only Overdrive and Fuzz are driven, and both travel through a song file.
  - The "no two basses alike" check now counts clean against driven as a difference anybody hears.
  - The sweep test now covers only saw and square basses whose filter falls an octave or more.
    Fuzz's filter barely moves on purpose.
  - Removing the curve's normalisation turns the edge test red.
- **1440:** Bass (7), Strings (8) and Synth (7) are one row each.
- **375:** `mobileAudit` reports zero with Strings open, after reporting a planted fault first.
- **Keyboard:** Enter on Overdrive selects it.
- **Console:** no errors.

**Stacked on the candidate (#160)**, because it uses #168's guitar and #153's and #158's bass
lists.

## For Evan

- Whether it sounds driven rather than just loud, and how much drive each one should have.
- **Firefox:** `WaveShaperNode` is standard, but its oversampling differs between engines. Worth
  a listen there.
- **CPU:** a driven voice is one more node, oversampled. Sixteen voices at once has not been tried
  on a phone.
