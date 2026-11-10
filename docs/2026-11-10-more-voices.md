# Five basses and four new voices — 10 Nov 2026

Evan's second overnight ask: **several distinct bass voices (sub, finger, slap, synth, 808) plus
a few genuinely different new instruments, usable from the keyboard, the backing and the jam.**
No database change.

## What was added

| Voice        | Id            | What makes it itself                                                                          |
| ------------ | ------------- | --------------------------------------------------------------------------------------------- |
| Finger bass  | `finger`      | a triangle with a little growl and a gentle filter: round, warm, keeps sounding               |
| Slap bass    | `slap`        | a filter that slams shut from wide open, resonant, landing a hair sharp: percussive           |
| Upright bass | `upright`     | a woody triangle, dark, almost no sustain: air between walking notes                          |
| Synth bass   | `synthbass`   | two saws beating against each other plus an octave below, resonant: holds full                |
| 808          | `808`         | a sine that drops into its note and **holds**, with a whisper of harmonics for phone speakers |
| Supersaw     | `supersaw`    | five saws spread around the note: wide and open                                               |
| 8-bit        | `chip`        | a raw square, instant on and off, no filter                                                   |
| Harpsichord  | `harpsichord` | a bright quill pluck with a second string an octave up, slightly out of tune                  |
| Sitar        | `sitar`       | a narrow, very resonant buzz and a pitch that bends up into the note                          |

- Bass and Sub were already there, which makes seven basses. Sub moved up beside the others in
  the picker. An id is forever because a song stores it, so reordering is safe where renaming
  would not be.
- **Keyboard:** all nine are on the picker.
- **Backing:** the Bass row has a **Sound** picker with the seven basses. It changes the loaded
  bass, and with none loaded it is used for the next bass laid. A style change keeps the sound.
- **Jam and song files:** every reader checks an instrument against the one `INSTRUMENTS` list,
  so the new ids travel as themselves. A partner on an older bundle hears them as Keys until they
  reload.

## Measured in the room, not heard

Played through the app's own synth, dry, and read from the instrument output's analyser after a
silence reading as the null control. Figures are level at the attack, at 0.4 s and at 1.2 s, then
the spectral centroid in Hz.

Basses, at C2:

| Voice      | Attack | 0.4 s | 1.2 s | Brightness      |
| ---------- | ------ | ----- | ----- | --------------- |
| Bass       | 0.53   | 0.33  | 0.28  | 149             |
| Finger     | 0.33   | 0.21  | 0.13  | 140 (darkest)   |
| Slap       | 0.26   | 0.085 | 0.085 | 275 (dies fast) |
| Upright    | 0.35   | 0.18  | 0.03  | 253 (dies away) |
| Synth bass | 0.23   | 0.14  | 0.18  | 280 (holds)     |
| 808        | 0.45   | 0.43  | 0.34  | 247 (holds)     |
| Sub        | 0.49   | 0.35  | 0.16  | 217             |

The first pass had Slap at a tenth of Bass by 0.4 s, and Synth bass, Finger and Upright a third
to half quiet. Triangles and saws carry less energy than a square at the same level, so those
levels were raised and re-measured. Attacks now sit within 2.3× of each other.

At C4:

- Supersaw: 0.15 / 0.06 / 0.16, the brightest at 1,696 Hz.
- Harpsichord: 0.18 / 0.05 / 0.006.
- 8-bit: 0.27, holding at 0.23.
- Sitar: 0.145, ringing longer than Koto.

For scale: Lead 0.11 and Keys 0.28.

## Costs

- **The instrument menu grew a row.** Forty tiles at eight columns is five rows, so with the menu
  open at 1440×900, ▶ Play moved from 998 px to 1,119 px. The UI milestone is where grouping the
  picker belongs.

## Verified

- New tests in `presets.test.ts`:
  - at least six basses, each on the picker
  - no two built the same way: every pair must differ on two or more of waveform, sustain, decay,
    filter, pitch fall and partial count
  - each is led by its fundamental
  - each has something above the fundamental, so a phone speaker can play it
  - all nine new voices survive a song file, which is also how the jam sends a layer
- Three perturbations each turned tests red once: Upright made a copy of Finger, 808 made a bare
  sine, and Slap taken off the picker list.
- Existing loudness sweeps cover the new voices.
- In the room at 1440:
  - The Bass row's Sound picker turned the loaded bass into Slap, kept Slap through a change to
    Walk, and after the bass was deleted, picking 808 and pressing Roots laid it on 808.
- At 375 with touch and the menu open on 40 tiles: `mobileAudit` read 0 sideways, off-edge,
  clipped, spilling and undersized across 210 controls, after a planted fault was reported and
  removed. The Sound picker is 108×40, inside the edge.

**Not verified:** any of these by ear. That is the point of the draft.
