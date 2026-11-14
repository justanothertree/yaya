# The sung-lyrics voice, rebuilt in pure synthesis — 13 Nov 2026

Evan's call after the research spike (#292, parked as a reference): **a fully code-based voice — no
Kokoro, no downloaded models, no outside services.** So the phase-0 prototype from
`docs/2026-11-10-sung-lyrics-plan.md` was rebuilt as a better synthesiser rather than replaced by a
neural one. Still phase 0: nothing is saved, and there is no lyric storage.

## What was wrong with the first one

One sawtooth per syllable through three parallel band-passes. Every syllable started a new
oscillator, so nothing could glide between notes or move the mouth from one syllable into the
next; parallel band-passes give a vowel its peaks but not the natural balance between them; and a
sawtooth is every harmonic at full strength, which is what made it sound like a machine.

## What it is now (`src/audio/singer.ts`)

- **One voice per phrase.** Notes with no real rest between them (under 0.35s) are sung by one
  continuous voice, so pitch glides and the mouth moves from syllable to syllable.
- **A glottal source.** A band-limited buzz whose harmonics fall as n^-tilt, with extra first
  harmonic for the breathy voice — instead of a sawtooth.
- **A cascade of formant resonances,** F1→F2→F3→F4 as resonant low-passes, the way a Klatt speech
  synthesiser builds a vowel: each passes the low end at unity and peaks at its formant, which
  gives the vowels their natural relative loudness. Targets are Peterson & Barney's measured
  female formants (`VOWELS` in lyrics.ts); a diphthong moves from its first vowel to its second
  across the note.
- **Smooth transitions.** Formants ease toward each target (`setTargetAtTime`), never jump, once a
  phrase has started.
- **F1 rises on high notes,** as a soprano's does: a resonance below the pitch has no harmonic to
  shape, so "ee" at C5 would lose its body exactly where glitchpop sings.
- **Consonants.** s/sh/f/th are band-filtered noise before the beat with the voice silent; z/v/j
  keep the voice humming under the hiss; p/t/k are a closure, a short burst, then a breath of
  aspiration through the coming vowel; b/d/g a shorter burst with a voice bar; m/n a nasal murmur;
  l/r/w/y start from their own shape and move into the vowel; h is breath through the vowel.
  Closing consonants happen at the end of the note.
- **Breath.** Noise shaped by the same vowel, plus an "air" path above 4kHz that goes round the
  cascade, so the breathy voice has a whisper on top.
- **Vibrato that starts late:** none for the first ~0.3s of a held note, then it grows; none on
  short notes.
- **Pitch glide** between notes (leaving after the last note, arriving just after the beat), a
  small scoop into each phrase, and **hard tune** — an instant snap, hidden in the consonant where
  there is one — for the glitchy voice.
- **Humanising:** a few cents per note, a few milliseconds of timing, a decibel of level and a slow
  pitch drift — seeded, so the same seed sings the same way.
- **Doubling:** an optional second voice, detuned, 11–22ms late, a slightly different throat, panned
  the other way.
- **Syllables land on note starts and vowels stretch to fill the note** — through small gaps too
  (under 0.12s), so a line is sung legato.

The planning is pure (`planLine`, `planPhrases`); `singInto` only turns the timeline into nodes in
whatever context it is given — the room's part bus, the preview page, or an OfflineAudioContext.

### Presets

|         | Clean                         | Breathy                        | Glitchy                                    |
| ------- | ----------------------------- | ------------------------------ | ------------------------------------------ |
| Source  | n^-1.05                       | n^-1.45, strong first harmonic | n^-0.85, buzzier                           |
| Breath  | a little                      | a lot, with air on top         | a little                                   |
| Pitch   | 70ms glide, small scoop       | 110ms glide, wider scoop       | hard tune                                  |
| Vibrato | after 0.32s, 5.6Hz, ±28 cents | after 0.38s, 5.1Hz, ±38 cents  | none                                       |
| Throat  | as measured                   | wider bandwidths, softer       | formants ×1.12 — a smaller, brighter voice |
| Extras  | —                             | doubled by default             | stutter, crush, doubled by default         |

The room's Stutter / Crush / Chop and Robot / Natural / High buttons were folded into these: the
glitchy preset is hard tune with stutter and crush, and Double and Harmony are the two toggles.

## Measured, not heard

Rendered offline with the same code and read back:

- **Vowels.** Held at 110Hz and read off the harmonics' envelope, F1 and F2 land within a few
  percent of the table for ee, eh, ae, ah and oo (clean and glitchy, the latter against its own
  ×1.12 targets). "ee" needed the fix written into `bandwidth()`: with the first bandwidths its F2
  sat 35dB under F1 and below F1's own skirt — the vowel drifted toward "oo". Now 24–25dB, which
  is where a real "ee" sits.
- **In tune.** A 14-note line read note by note: every note within ±15 cents by autocorrelation,
  13 of 14 within ±8 by a harmonic-sum estimate (the fourteenth is a 59ms window closing into an
  "n", which autocorrelation reads as −3).
- **Level.** In the room, through the same output tap as Keys on the same C5: clean +0.9dB,
  breathy +1.0dB, glitchy +1.3dB; breathy doubled with harmony +2.8dB. Peaks under Keys' own.
- **No leaks.** A counter of built-and-not-released voices returns to 0 after a line ends, after
  ■ Stop mid-line, and after leaving the room mid-line.
- **No freezes.** Scheduling a full line — breathy, doubled, with harmony, six voices — takes
  ~5–6ms on the main thread; rendering 8.5s of voice offline takes ~80ms.
- **Layout.** The panel at 375 (touch) and 1440: nothing undersized, off the edge, clipped or
  spilling, after a planted 16px button was reported to prove the audit was looking.

Tests (`singer.test.ts`) read the timeline through a model of Web Audio's automation rules written
in the test file, and every rule — glide timing, late vibrato, F1 lift, legato, hard tune,
humanising bounds, the silent voice under "s", smooth formants — was broken once to watch its test
go red.

## The preview page

`singer-preview.html` (dev server) runs the same `singInto` with a fixed A-minor melody and a small
beat, so the voice can be heard without opening the room. A bundled copy is published as a private
claude.ai page for listening on a phone.

## Not checked

- **How it sounds.** For Evan's ears.
- **Firefox and Safari**, and a real phone: the pane is desktop Chromium. Web Audio automation is
  standard, but Safari's handling of many simultaneous `setTargetAtTime` events is worth a listen.
