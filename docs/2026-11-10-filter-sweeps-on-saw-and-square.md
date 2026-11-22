# Saw and square voices get their filter sweep back — 10 Nov 2026

Found while building more bass voices. **Slap had no slap where bass lines are played.** Its snap
is a filter that starts wide open and slams shut. From 8 Sep that sweep was switched off wherever
the rule thought it could not be heard, and the rule was wrong for every saw and square voice.

## What the rule did

The crackle fix (`626624d5`, 8 Sep) skips a note's filter sweep "where the filter's destination
sits well above the highest partial this note actually has". It took the highest partial to be the
highest **ratio** in the voice's partial list. That is true of a sine and false of a saw or a
square: each partial is a whole waveform with harmonics of its own, falling only as 1/n.

So the sweep was skipped across most of the keyboard on 18 voices:

| Voice                                                 | Sweep was skipped for (MIDI) |
| ----------------------------------------------------- | ---------------------------- |
| Slap                                                  | 28–44 (below A2)             |
| Synth bass                                            | 28–66                        |
| Bass                                                  | 28–48                        |
| Brass (its swell)                                     | 56–95 (A♭3 and up)           |
| Pluck                                                 | 28–63                        |
| Lead                                                  | 28–61                        |
| Strings                                               | 28–60                        |
| Harpsichord                                           | 28–67                        |
| Clav, Reed, Cello                                     | 28–54/55                     |
| Pad, Choir, Accordion, Sitar, Fifths, Drone, Supersaw | parts of their range         |

The timbre also **changed abruptly** at the pitch where the rule flipped.

## The fix

`filterSweeps(shape, freq)` makes the decision, as a pure function. It counts a saw or square
wave's own harmonics up to the tenth, the last within 20 dB of the note. A sine and a triangle keep
the rule exactly as the crackle fix measured it, because those are the near-sines where the crackle
is audible. A saw or a square is the "rich patch" that commit found it hides in.

## Measured

- **Tests** are written as things a listener names: Slap snaps on E2, Brass swells into middle C,
  every saw or square bass sweeps across MIDI 36–59, and whistle at C5 and Keys at middle C stay
  still. Setting the saw/square reach back to 1 turns the first three red, and setting triangle's
  to 10 turns the fourth red.
- **In the room, with the real synth.** This is the share of energy above 1.5 kHz in the first
  43 ms, read off the instrument analyser, on main and then on this branch:

  | Note              | Main  | This branch | Peak (main → branch) |
  | ----------------- | ----- | ----------- | -------------------- |
  | Slap E2           | 0.07% | **7.82%**   | 0.609 → 0.602        |
  | Slap B2           | 11.6% | 11.3%       | 0.672 → 0.672        |
  | Synth bass E2     | 0.01% | **2.37%**   | 0.750 → 0.672        |
  | Bass E2           | 0%    | 0.05%       | 0.813 → 0.828        |
  | Keys C4 (control) | 0.11% | 0.11%       | 0.461 → 0.461        |

  Slap at E2 now sounds like Slap at B2. Brass at middle C now starts darker and opens: 1.41% early rising to 16.8% at 350 ms, against 6.8% → 15.7% on main. Peaks move by at most 0.08, so loudness is unchanged.

## Not verified here

- **Firefox.** The crackle was worst there, and the pane is Chromium. The argument that it is
  safe: saw and square voices swept on every note before 8 Sep, with the harsher exponential ramp,
  and none of them was among the voices reported. They now sweep with `setTargetAtTime`, which
  that commit measured as cleaner. Still, it needs a listen in Firefox.
- **Ears.** Eighteen voices sound more like their own descriptions in the low and middle register.
  The ones most changed are Slap, Synth bass, Pluck, Brass and Lead.
