# Sung lyrics, glitchpop style — the plan — 10 Nov 2026

Evan's idea for today: **type lyrics and have a couple of female voices sing them, glitchpop
style.** He asked for a plan before anything is built, covering:

1. how syllables land on notes
2. an honest comparison of a voice made in the browser against outside singing-AI services, with a
   recommendation
3. then a small robotic prototype of the browser-only option

No outside service has been signed up for or called, and nothing here adds a dependency.

## 1 · Timing: a syllable on each note

**One syllable per note, written on the note itself.** A note-on gains an optional syllable
(`syl`). The piano roll shows it under the note, and clicking a note edits it. That makes timing
the piano roll's existing job: a word lands on the beat because its note does, and moving, snapping
and copying a note takes its syllable with it.

- **Typing lyrics.** One box per layer: `glit-ter in the dark _ _ to-night`.
  - Spaces separate words, and hyphens split a word into syllables.
  - `_` holds the last syllable across the next note: its vowel carries on, its consonant doesn't
    repeat, and the pitch glides. That is the "hold one across notes" Evan asked for.
  - The box fills the layer's notes in time order. Spare notes sing a hold; spare syllables are
    reported, not dropped silently.
- **Without hyphens** a word is split by a small vowel-group rule (`twinkle` → `twin`-`kle`). It
  will be wrong sometimes, and you can always see and edit the result on the notes.
- **What has to change for this to keep:**
  - Song files pack notes as flat number triples. Syllables would travel as a parallel list added
    at the end of the record, which older bundles ignore.
  - Every load passes through `toNotes → toEvents`, so that normaliser has to carry the syllable.
    Otherwise the first save, or the first time a jam partner receives it, quietly removes the
    lyrics.
  - The jam, the Library, undo and the editor's copy and paste all go through those same paths, so
    covering them covers the rest. That is the §8 "a save that writes every column" lesson, applied
    in advance.

## 2 · The voice: browser or service

|                    | **Browser formant voice** (recommended)                                                                       | **Outside singing AI**                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sound              | Robotic, vowel-shaped: closer to early vocoder pop or a talk box than to a person. Fits glitchpop on purpose. | Can sound like a real singer.                                                                                                                                                                           |
| Note-level control | Total. It is the same note events as every other instrument, so timing, pitch, harmony and effects are exact. | Varies. Full-song generators can't follow your notes at all. Desktop singing synths can, but have no web API.                                                                                           |
| Cost               | Nothing                                                                                                       | Per render or per month, plus hosting. Open-source singing models (SoulX-Singer, released February 2026, and DiffSinger) need a GPU server.                                                             |
| Licensing          | Ours                                                                                                          | Per voice. Synthesizer V's own voices are licensed to one person, and third-party voices each have their own terms. Hosted services' terms for generated vocals vary and would need reading one by one. |
| Privacy            | Lyrics never leave the browser.                                                                               | Lyrics and melody go to a third party.                                                                                                                                                                  |
| Works on the site  | Yes: offline, on a phone, live while you play.                                                                | Only through a server we would run (an edge function holding the key), and it renders afterwards rather than live.                                                                                      |
| Jam                | Free: each browser sings the notes it receives, like every other instrument.                                  | Each render would be an audio file to send around.                                                                                                                                                      |

**Recommendation: the browser formant voice.** It is the only option that does what the room is
built on: notes in, sound out, the same on every machine, live. Its weakness, sounding robotic, is
the style being asked for. An outside service becomes worth a separate conversation only if realism
turns out to matter more than playing live. If so, it would be an "export a sung take" feature
rather than an instrument.

What I checked: Synthesizer V's voice terms (one person per licence; each third-party voice has its
own terms) and current open-source models (SoulX-Singer's inference code and models, February
2026). I found no general per-note singing API with clear licensing, which is itself the finding.
Prices were not checked, and nothing was signed up for.

## 3 · How the browser voice works

- **The source:** a buzz from a sawtooth, with a little breath noise and vibrato.
- **Vowels:** three formant filters per voice, set to measured vowel resonances for a female voice
  (for example "ah" ≈ 850 / 1,610 / 2,850 Hz, "ee" ≈ 310 / 2,790 / 3,310). Each glides to the next
  vowel rather than jumping.
- **Consonants:** a short sound at the syllable's start. Filtered noise for _s_, _sh_, _f_ and
  _h_, a click for _t_, _k_ and _p_, a hum for _m_ and _n_, and a formant glide for _l_, _r_, _w_
  and _y_.
- **Spelling to sound:** a small set of English rules ("ee", "oo", "igh", "ay"…). Robotic, by
  design.
- **Two voices:** the same machine with different formant scaling and brightness, one airy and one
  bright.
- **Harmony:** a second voice a third above, inside the scale, so it never clashes with the
  keyboard.
- **Glitch:**
  - stutter (the first sliver of a syllable repeated)
  - bitcrush (a stepped wave shaper)
  - hard tune (pitch snaps with no glide)
  - formant shift (chipmunk or robot without changing the note)
  - rhythmic chop (the voice gated on the beat grid)

## Phases

0. **Prototype (the next draft).** The voice, two voices, harmony and the glitch effects, singing
   typed lyrics over an existing layer's notes, one syllable per note with `_` to hold. Nothing is
   saved and nothing changes in song files. It exists so the sound can be heard before anything is
   committed to.
1. **Lyrics live on the notes**, as section 1 describes: the piano roll, song files, the
   normaliser, undo, copy and paste.
2. **Everywhere else:** the jam, the Library, the Voice in the instrument menu, and phone layout.

**What needs Evan:** whether the prototype's sound is the one he means, before phase 1 is built.

## Phase 0, built — 10 Nov 2026 (draft, stacked on the plan)

**🎤 Sing lyrics · prototype** is a fold below the layers.

- Pick a layer whose notes it sings, type the words, choose a lead voice (**Airy** or **Bright**),
  **+ Harmony**, and the glitches: **Stutter**, **Crush**, **Chop**, and **Robot / Natural / High**
  formants. Then **▶ Sing**, which comes in at the top of the next loop.
- **✎ Try a sample line** adds a short muted melody in the room's key and the lyric `glit-ter in
the dark _ to-night`.
- Nothing is saved.

The parts:

- `lyrics.ts` is pure: syllables, putting them on notes, spelling to sounds, and the harmony note.
- `singer.ts` is the voice: a sawtooth buzz plus breath, three formant bands, noise consonants, and
  the glitches.
- `synth.ts` gains one export, `partInput`, so the voice goes through a part bus like every note.

### Measured in the room, not heard

Each note was sung through the app's own synth and read from the instrument output's analyser,
after a silence reading of 0.0055.

- **Vowels:** "see" put **8×** more energy at 2.5–3.3 kHz than at 0.85–1.4 kHz. "saw" (0.48×) and
  "moon" (0.4×) put it low. That is the front-against-back difference that makes them different
  vowels.
- **Harmony:** with it on, the E5 band went from 0 to 0.0047 under a sung C5. A control band at D5
  stayed near zero.
- **Level:** the first pass read 0.41 against Keys' 0.24 on the same note. Brought down, Bright
  reads 0.28 and Airy 0.24.
- **Crush:** at twelve levels it barely registered above 6 kHz (0.0001 → 0.0002). At five it rises
  2.5× (0.00013 → 0.00032).
- **Chop:** the level dips to 0.03–0.11 about every 125 ms, a sixteenth at 120 bpm.
- **In the room:** ▶ Sing started the loop and switched to ■ Stop singing, and switched back when
  the line ended. At 375, with the panel open, the panel adds no layout problems. The one
  undersized target in the room belongs to the audio-health strip, a developer tool.

### For Evan's ears

- Whether this is the sound he means. That decides whether phase 1 gets built.
- Which voice, and how strong the crush and stutter should be.
- Whether the words are clear enough. A high note can't sound a vowel's lowest formant, so "ee" and
  "oo" lean on their second.

## Phase 0, rebuilt — 13 Nov 2026

The voice described above (Airy / Bright, a sawtooth through three band-passes, and the separate
glitch buttons) was replaced by a pure-synthesis singer with Clean / Breathy / Glitchy presets,
Double and Harmony. See `docs/2026-11-13-formant-singer.md`. Still nothing saved.
