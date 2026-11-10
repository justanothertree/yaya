# A take has its own sound — 8 Nov 2026

Evan's feedback, item 4: vocal sound controls without needing "In the loop", previews that
audition those effects, and dry-versus-processed made explicit and consistent — with any material
export decision queued rather than made.

**Stacked on the take editor** (`feat/instrument-take-editor`, which is stacked on #35). It
changes `TakeEditor.tsx` and moves a validator out of `workbench.ts`, so it cannot land first.

## What was there

- A take's sound (Tone, Even, Double, Echo, Echo gap, Space) and its Chop belonged to its
  **placement** in the loop. ⚙ appeared only once a take was placed — "because that is when the
  chain exists".
- So a recording could not be given a sound, or heard with one, until it was part of the song.
- `placeTake` started every placement flat and `liftTake` threw the settings away, so taking a
  take out of the loop and putting it back **lost its sound**.
- The list's ▶ and the editor's ▶ played dry. Stems were processed. "Save a copy" was dry, and
  said nothing about it.
- ⚠️ "Flat" was titled _Back to how it was recorded_, and is not: the chain at its centre still
  runs an 80Hz rumble filter (see `tone` in takeFx.ts). Resetting the settings and bypassing them
  are different sounds.

## What it does now

|                                      |                                                                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⚙ on every take**                 | the six voice controls, Flat, and **As recorded** — placed or not                                                                                                                                        |
| **the sound lives on the recording** | a new optional `voice` on its IndexedDB row, written read-modify-write like the edit log, coalesced (400ms after a slider stops, flushed before placing and on leaving) because the row carries the blob |
| **placing**                          | starts from the recording's sound, not flat; editing while placed reaches the loop _and_ the recording; lifting keeps it                                                                                 |
| **previews** (list ▶, editor ▶)    | play through the **same chain the loop uses** (`makeVoiceChain`), via `makeAudition`                                                                                                                     |
| **As recorded**                      | a true bypass — a dry wire beside the chain, crossfaded at the chain's _output_ — heard live mid-preview. A comparison, not a mode: it resets when the panel closes                                      |
| **Chop**                             | still only in the loop — it is cut against the loop's bars and a preview has none. When a take is not placed, one line says so                                                                           |
| **Flat**                             | retitled _Every setting back to the middle_                                                                                                                                                              |
| **the editor's export**              | **⬇ Save as recorded** — unchanged behaviour, now named                                                                                                                                                 |
| **the six sliders**                  | 28px tall (were 16, under the 24px floor) — the panel is in front of every take now                                                                                                                      |

### ⚠️ Not decided here: should "Save" carry the sound?

The editor's export has always been the edited take **without** its sound, and still is. With
previews now playing through that sound, there is a real question about what an export _means_ —
"the recording, edited" or "what I just heard" — and it is Evan's, not this change's:

- **Keep it dry (today).** Honest about what a recording is; takes into another app without
  baked-in reverb. ⬇ Stems is the processed export (a real-time bounce of the live loop — with
  Chop, at the loop's tempo).
- **Offer both.** The voice chain is self-contained Web Audio nodes, so unlike the synth (see the
  note at the top of stems.ts) it _could_ render on an `OfflineAudioContext` — faster than real
  time, no loop needed. A second button, or a choice on the one there is.

## How it was checked

In the pane, on the worktree's dev server, with the seeded 6s take (edited to play a 440Hz phrase,
a 0.4s silence, then 660Hz), and an analyser on the take bus measuring the **silent gap** — where
an echo can only be the effect:

| preview                                       | gap energy (RMS)                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| list ▶, with its sound (Echo 0.6, Space 0.5) | **0.072**, **0.070**                                                                                                                             |
| list ▶, As recorded                          | **0**, **0**                                                                                                                                     |
| editor ▶, with its sound                     | **0.072**                                                                                                                                        |
| list ▶, switched to As recorded mid-phrase   | first build **0.019** — the echo already inside the delay lines rang on, because the fade was at the chain's _input_. Moved to the output: **0** |

- Three slider moves on an unplaced take: nothing written at 150ms, one write after settling; the
  recording's hash and its five-step edit history untouched. Sound back after a reload.
- **Placed** → the loop's copy (read from the saved bench) equalled the recording's sound;
  Double changed while placed → reached both; **lifted** → ⚙ still showed it; **placed again** →
  all of it back (it would have been flat before).
- **375 + touch** on the open panel: 14 controls; first pass flagged the 16px sliders (1 named,
  5 excused by spacing), after the fix 0 undersized, sideways, spilling or clipped; screenshot
  checked.
- `readVoiceFx` (moved from workbench.ts to takeFx.ts, beside the type it reads): three new tests;
  accepting `NaN` was caught by them and by #35's bench test.

## Not verified

**Nothing has been listened to** — the analyser proves the effect is in the signal, not that it
sounds good. Chromium only. A real microphone recording has not been through it.
