# Making the lyric singer sound good — research and a throwaway demo — 13 Nov 2026

Evan wants a cool, glitchpop-style female voice that sings typed lyrics in time. The phase-0
prototype (`src/audio/singer.ts`, a buzz through three formant filters) sounds robotic, which is
what a formant synthesiser is. This note compares the ways out, says which one the demo was built
with and why, and records what was measured. **Nothing here is wired into the instrument room,
nothing is saved, and no lyric storage was built.**

## The options

|                   | **A · Neural speech + re-pitching, in the browser** (demo)                                                                                                               | **B · DiffSinger in the browser**                                                              | **C · Hosted singing model** (SoulX-Singer on a rented GPU)                                                                                                     | **D · Commercial singing synths / music APIs**                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is        | Kokoro-82M (a neural text-to-speech model) says each word; our own code cuts it into syllables, snaps each to its note (TD-PSOLA) and stretches it to the note's length. | A real singing model (acoustic model + vocoder) exported to ONNX and run with onnxruntime-web. | A real singing model on a server: MIDI + lyrics in, a sung take out. An edge function would hold the key.                                                       | Synthesizer V, ACE Studio, Vocaloid (desktop); ElevenLabs Music, Suno (whole-song generators).                                                        |
| Sound             | A real woman's voice, hard-tuned: the autotuned-pop sound by construction. Spoken diction, not sung phrasing; long holds are a looped vowel and sound synthetic.         | Real singing, if a good English voicebank exists — they are few, and community-made.           | Best of the four: trained on 42,000+ hours of singing, English included, and clones a voice from a short sample.                                                | Studio quality.                                                                                                                                       |
| Words on the beat | Exact: every syllable is placed by our code, on our notes, sample-accurate.                                                                                              | Exact: notes and phonemes are its input.                                                       | Exact in principle (MIDI-conditioned); its own README warns the demo's preprocessing "may not perfectly align" lyrics and notes.                                | Desktop synths: exact, but no web API, and Synthesizer V's licence forbids use "through a network". Song generators: cannot follow your notes at all. |
| Latency           | Measured below: about 2.0–2.6s per new word on this desktop, single-threaded; re-singing words already spoken takes under a second. A phone will be slower.              | Not measured. Two or more models of hundreds of MB, and diffusion steps — slower than A.       | Not measured. A GPU render of a line plus a cold start: seconds per line when warm, a minute or more when cold.                                                 | Seconds to minutes, per render.                                                                                                                       |
| Cost              | Nothing. The model (~92MB at q8) downloads once and is cached by the browser.                                                                                            | Nothing.                                                                                       | GPU time: third-party rate tables put Modal's L4 near $0.80/hour and Replicate's L40S near $3.51/hour, before idle and cold-start time. Not checked first-hand. | Subscriptions or per-render pricing; Enterprise for API access in ACE Studio's case.                                                                  |
| Licensing         | kokoro-js and the Kokoro weights are Apache-2.0. ⚠️ Its phonemiser bundles eSpeak NG, which is GPL-3.0 — needs a decision before anything ships, not just a demo.        | Per voicebank, and many forbid commercial use or redistribution.                               | Code and weights Apache-2.0, with a use policy against impersonation. The voice you clone from is its own licensing question.                                   | Per vendor and per voice; ElevenLabs' music terms exclude some commercial uses on self-serve plans.                                                   |
| Privacy           | Lyrics never leave the browser.                                                                                                                                          | Same.                                                                                          | Lyrics and melody go to the server we run.                                                                                                                      | Lyrics go to the vendor.                                                                                                                              |
| Needs from Evan   | Nothing to try it. To ship: the GPL question, and a worker so speaking does not freeze the page.                                                                         | A voicebank whose licence allows a website; a port nobody has published.                       | An account and a key on a GPU host, and a budget.                                                                                                               | Accounts, money, and terms that allow a web app — the desktop synths' do not.                                                                         |

**Recommendation.** A is the only one that keeps the room's promise — notes in, sound out, the same
in every browser, no account, no bill — and it is the one the demo is built with. It will never
sound like a trained singer; it sounds like a real voice put through hard tune, which is a large
part of what glitchpop vocals are. If Evan hears it and wants a _singer_ rather than a tuned
speaker, C is the step up, and it would be an "export a sung take" feature (a render you wait for)
rather than a live instrument. B is not worth the porting work unless a licensable English
voicebank turns up. D does not fit a website.

## How the demo works (`singer-demo.html`, `src/singerDemo/`)

1. `line.ts` — lyrics onto the melody with the room's own rules (`autoSplit`, `-`, `_`), keeping
   each syllable's word: the voice says whole words, because "ter" on its own is not the end of
   "glitter".
2. Kokoro says each word once (cached per voice).
3. `psola.ts` — pitch per 5ms (YIN), one mark per glottal pulse, the word cut into syllables at
   the dips between its vowels, and each syllable's vowel found as its longest steady voiced run.
4. `sing.ts` — each syllable placed so the point where it reaches half loudness lands on its note,
   with the consonant before it; the vowel held by sweeping back and forth across its middle; the
   pitch snapped to the note (Hard tune) or glided with vibrato (Natural). Formant scaling gives
   Bright and Pixie without moving the note.
5. `mix.ts` — double-tracking, optional harmony a third up, low cut, air, compression, reverb, a
   dotted-eighth echo, over a small Am–F–C–G loop; rendered offline to a WAV.

The voice loads from a CDN at run time; **package.json is unchanged** and the page is not a build
input, so the site's bundle is untouched.

## Measured

- **In tune.** The dry lead (Heart, Hard tune, Stutter off) was read note by note with a
  harmonic-sum pitch estimate that shares nothing with the YIN tracker the code uses: 14 of 14
  notes within ±18 cents, 12 within ±8 — measured after the vowel fix below, and the same as
  before it. With Stutter on, the first note read 108Hz: the stutter's gating confuses the
  estimator, and with it off the same note reads −3 cents.
- **On time.** Unit tests place one syllable at a time and read its onset back from the output's
  own loudness: on the beat within 15ms, with the consonant in the 60ms before it.
- **Formants stay put.** A 200Hz vowel sung at E4 keeps its 800Hz resonance (harmonic 2–3 louder
  than harmonic 4 by more than 2×), and plain resampling, run through the same check, gives the
  opposite answer — the difference between a voice and a chipmunk.
- **One fault found and fixed by looking.** A spectrogram of the Sky clip showed a broadband smear
  over "stat" in "static". The vowel finder had held a 10ms voiced blip at the "t" burst for 0.7s
  instead of the 110ms "a" beside it. It now chooses the steady voiced run with the most sound in
  it, and blips under 20ms are not vowels; both rules have a test that goes red without them.
- **Clips:** no clipping, steady level across the bars (−11 to −15 dB RMS per half second).
- **Latency, desktop, Browser pane, single-threaded WASM** (`crossOriginIsolated` is false, so
  onnxruntime cannot use threads): model start 1–9s (the 92MB download only the first time);
  2.0–2.6s per new word, whatever its length; PSOLA 20–140ms for a whole line; the offline mix
  0.5–2s. A new eight-word line is about 20–35s end to end; the same words in a new style, under
  1s. **The speaking blocks the main thread** — the page cannot even run a timer meanwhile — so a
  real version needs it in a Web Worker.
- **One call per line is ~2.3× cheaper** (7.5s for eight words against ~17.6s word by word), but
  Kokoro runs the words together — two of seven boundaries left a pause to cut at — so the line
  cannot be split without word timings, which the onnx-community export does not return.

## Not measured, and why

- **How it sounds.** That is the question for Evan's ears; nothing here can answer it.
- **A phone.** The pane is a desktop browser. Expect the per-word cost to be several times higher.
- **Firefox and Safari.** Kokoro's WASM path should run there; not checked.
- **Options B, C and D were researched, not run.** No account was made and no outside service was
  called; the demo's only outside traffic is downloading the open model and library files.
