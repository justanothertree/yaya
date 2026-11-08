# The take editor gets a cursor — 8 Nov 2026

Evan's feedback, items 2 and 3: a moving playhead that matches the audio while seeking and
during edited playback, and manual trimming that is precise and easy to preview — with the
automatic **Trim ends** removed, and nothing about existing edits, Undo/Redo or the original
audio lost on the way.

**Stacked on #35** (`fix/instrument-bench-survives-reload`). Nothing here depends on its code —
the editor never touches the bench — but it was branched from it so the two do not conflict in
`songFile.ts`'s neighbourhood, and it should be reviewed after it.

## What was there

- The editor drew a playhead, but only for its own ▶, which always started at 0. There was no
  way to play from anywhere else, so nothing could be previewed except from the top.
- The playhead was `currentTime` — the clock of what is being RENDERED. What is HEARD trails it by
  the output's buffering: 42ms on this machine, and a fifth of a second or more on a Bluetooth
  headset. A line that reaches a consonant before you hear it is a line you trim late against.
- Precision was a drag: one pixel of the picture, made finer only by zooming.
- **Trim ends** guessed where the sound was (`loudSpan`, −40dB under the take's own peak).
- An edit made while playing left the old buffer playing under the new picture, so the playhead
  was drawn through a waveform the sound no longer matched.

## What it does now

|                                   |                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tap** the picture               | places a **cursor** (dashed, so it never reads as the playhead); while playing, the tap **seeks** there                                                                                      |
| **▶ Play**                       | plays the edited take **from the cursor** — from the next kept moment if the cursor sits in a cut                                                                                            |
| **‹ ›** and **← →**               | move the cursor one pixel _at the current zoom_ (Shift: ten), so precision follows the zoom; Home / End go to the ends                                                                       |
| **⇤ Start here** / **End here ⇥** | set the edge at the cursor — or, while playing, under the playhead, so an edge can be placed by ear. Moving an edge **outward restores** audio an earlier edit cut. One press, one Undo step |
| after **End here**                | the cursor steps back 2s of played time, so ▶ hears the cut-off at once                                                                                                                     |
| any edit                          | stops playback first                                                                                                                                                                         |
| playhead                          | follows `getOutputTimestamp()` (falling back to `outputLatency`) — what is reaching the speaker, not what is being rendered                                                                  |

The two edge buttons are disabled until there is a cursor, and the status line says why — _tap
the picture to place the cursor_ — rather than a tooltip a phone cannot show.

### Trim ends is gone, and nothing it did is

It was an ordinary `keepOnly` step in the stored history, so a take trimmed by it keeps that trim
and Undo still walks back through it: the history never recorded which button made a step.
`loudSpan`, its two constants and its tests went with it — nothing else called them. The 6 Nov
write-up (`docs/2026-11-06-vocal-editor.md`) is left as it was; it is the record of why it was
built.

## How it was checked

**Pure** (`takeEdit.ts`, `heard.ts`): `playedFrom` (seek), `trimTo` (the edges), `heardTime` (the
clock) — 16 new tests, written as times in a recording. Five sabotages, each caught by the test
named for it: a seek into a cut answering nothing, an edge that cannot reach back, a trim that
"changes" nothing, the clock ignoring the timestamp, the clock running ahead of the renderer.

**In the pane, on the worktree's own dev server**, with a 6s WAV seeded as the row `putTake`
writes (a 440Hz tone at 1–2s, 660Hz at 3.5–5s, silence between), every position read off the
canvas's **painted pixels**, not React state:

- a tap at 1.0s → cursor painted at x = 98 of 590 (exactly ⅙), readout `1.000s`; ▶ starts there
- **seek**: playing at 1.37s, a tap at 4.0s → playhead at 4.06s 120ms later, then 1× onward
- **edited playback**: with 2.2–3.3s cut, the playhead runs 2.18 → **3.37** across the gap
- **against the sound itself** — an analyser on the take bus, and the moment the 660Hz tone
  appears in the rendered signal compared with the moment the painted playhead crosses 3.5s:

  | playhead clock     | lag behind the rendered onset, 4 runs | vs. when it is heard (+42ms reported) |
  | ------------------ | ------------------------------------- | ------------------------------------- |
  | old, `currentTime` | 57, 5, 15, 15 — mean **23ms**         | ~19ms **early**                       |
  | new, heard clock   | 64, 54, 60, 63 — mean **60ms**        | ~18ms late — inside one 50ms redraw   |

  The shift between them (37ms) is the reported 42ms. On this machine both are within a redraw of
  the sound; the change is for outputs that report 150–250ms, where the old line led by that much.

- real keys on the focused picture: → one pixel (0.010s), Shift+← ten; the room stayed put
- **Start here** at 1.031s (a tap and three nudges) → stored `[1.031, 2.2] [3.3, 6]`, the middle
  cut kept; **End here** at 4.8s → `[… 3.3, 4.8]`, cursor to 1.700s (2s of played time before the
  end); **Start here** at 0.5s → `[0.5, 2.2]`, cut audio restored; Undo, Undo, Redo → the stored
  history at the right step. The recording's hash identical throughout.
- **375px, touch emulated**: 14 controls, 0 undersized, 0 sideways, 0 spills, 0 clipped, 0
  wordless — and the audit made to speak first (a 16px button and a 600px child: 1 and 2, back to
  0 when removed). Screenshot checked: the edge pair and the cursor nudge each hold a row.

⚠️ **A probe lesson, recorded so it is not re-learned:** an arrow key dispatched at the picture
walked the page to #paint. The product was fine — App's room-switcher already skips a key that
was `preventDefault`-ed — but a synthetic `KeyboardEvent` is **not cancelable** unless created
with `cancelable: true`, so `preventDefault()` did nothing. Real keypresses (above) stay put.

`npm run typecheck`, `eslint . --max-warnings 0`, tests and build — see the PR for this head.

## Not verified

**Nothing has been listened to.** The analyser proves the playhead agrees with the signal the
page renders and with the latency the browser reports; whether that matches a real headset is a
device test. Chromium only. A real finger has not tapped it: the 4px tap threshold was chosen, not
measured on a phone.
