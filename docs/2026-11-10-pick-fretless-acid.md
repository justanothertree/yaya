# Three more bass voices: Pick, Fretless and Acid — 10 Nov 2026

Evan, from the loop: "more instruments (especially bass: more bass voices…)". There were seven
basses. These three each fill a gap that none of the seven covered:

| Voice         | What it is                                                                         | Built from                                                         |
| ------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Pick bass** | An electric played with a plectrum: the rock bass, harder and brighter than Finger | A saw with a soft octave, a filter falling from 3.2 kHz, half held |
| **Fretless**  | Smooth and singing; every note slides **up** into place                            | A triangle with a soft octave, pitch rising from 0.97, long hold   |
| **Acid bass** | The squelch of acid house                                                          | One saw through a resonant filter (q 10) that snaps shut each note |

- **The Rock starter now plays Pick.** Its driving eighths are what a pick is for, and that is the
  only new style pick. Evan asked for a voice "where it clearly fits", and Fretless and Acid have no
  starter they clearly belong to.
- **The menu now has two bass families**, Bass (the six played ones) and Synth bass (Synth bass,
  Acid, 808, Sub). Ten basses would not fit one row of eight at 1440, which the families test
  holds. At 375 the family tabs still take two lines: the seven old tabs alone measure 421px against a 351px line, so they already wrapped.
- **Stacked on #150.** Acid's squelch is a filter sweep, and before #150 a saw got no sweep in the
  bass register at all.

## Measured in the room

Each voice played through the real synth and read from the instrument analyser. "Attack" is the
mean RMS from 45 to 165 ms, and "held" is 0.5 to 0.65 s.

| Voice (E2)   | Attack | Held  | Peak  |
| ------------ | ------ | ----- | ----- |
| Keys (C3)    | 0.231  | 0.121 | 0.430 |
| Finger       | 0.309  | 0.170 | 0.523 |
| Slap         | 0.178  | 0.075 | 0.688 |
| Synth bass   | 0.187  | 0.132 | 0.672 |
| Bass         | 0.457  | 0.270 | 0.828 |
| **Pick**     | 0.250  | 0.184 | 0.672 |
| **Fretless** | 0.356  | 0.318 | 0.633 |
| **Acid**     | 0.152  | 0.062 | 0.813 |

- **Acid's first version peaked at 0.92** on a single note, from a q-12 resonance, with the lowest
  average of any bass. That would make the limiter work on every note. With q 10 and a lower level
  it peaks at 0.81–0.82 from C2 to G3, under Bass, and sits beside Slap on average.
- **Pick** sits level with Keys. **Fretless** sits between Finger and the 808 (0.425 / 0.378).

## Other checks

- **Tests:**
  - Pick is a saw that opens wider than Finger.
  - Fretless rises where Slap and the 808 fall.
  - Acid is one resonant saw that sweeps on every bass note.
  - Rock picks Pick, and exactly five styles pick a voice.
  - The three voices travel through a song file and the jam as themselves.
  - The existing pairwise test ("no two basses built the same way") now covers ten.
  - Setting Fretless's pitch above 1 turns its test red, and so does lowering Acid's q to 2.
- **375:** with the menu open on Synth bass, `mobileAudit` reports zero. A planted 16px button was
  reported first, to show the audit was working.
- **1440:** the family tabs fit one line, and each bass family fits one row.
- **Keyboard:** Enter on the Acid bass tile selects it, the phone menu closes, and the menu button
  reads "🧪 Acid bass".
- **Console:** no errors.

## For Evan's ears

- Whether Pick sounds like a pick, Fretless like a fretless, and Acid like acid. Acid sounds most
  like itself with the layer's Glide turned up.
- Whether Rock should keep Pick.
