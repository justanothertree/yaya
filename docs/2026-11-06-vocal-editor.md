# The vocal editor — where it stands, 6 Nov 2026

Three passes over the recording/editing workflow in the Instrument's takes panel. This is the
handoff: what exists, the one decision that shapes all of it, what is verified and by what, and
what only a person with a microphone and a phone can answer.

Nothing in Instrument synthesis, the preset levels or the layer fader was touched. The three
loudness calls in `OPEN-DECISIONS.md` §11 are exactly as they were.

---

## 1. What the workflow is now

| step           | how                                                                        |
| -------------- | -------------------------------------------------------------------------- |
| record         | 🎤 Record a take — explicit permission, stream stopped the moment you stop |
| or open a file | 📂 Open a file — size, then duration, then decode; each refusal says which |
| see it         | a waveform per take, min/max envelope                                      |
| zoom and move  | ＋ － ⤢ All ⤢ Selection, and a slider to travel along a long take          |
| select         | drag across the picture; backwards works; a tap clears it                  |
| keep           | Keep — everything outside the selection stops playing                      |
| cut            | Cut — the selection goes and **the gap closes**                            |
| trim the ends  | Trim ends — one press, no drag: the dead air before and after the sound    |
| undo / redo    | ↶ Undo ↷ Redo, through the whole history, surviving a reload               |
| start again    | Whole take — one press, and itself undoable                                |
| hear it        | ▶ in the editor, ▶ in the list, and on the loop — all the same audio     |
| export         | ⬇ Save a copy — a WAV of what you hear                                    |
| delete         | ✕ asks first, and disarms after six seconds                                |

## 2. The decision everything rests on: a list of kept spans

An edit is **`{ keep: [{from, to}, …] }` in source seconds**, stored beside the audio. Nothing
ever rewrites the blob that came off the microphone.

That shape was forced by the second operation. Keeping the middle of a take is one span; cutting
a cough out of the middle is two. The first pass stored `trim: {from, to}`, and bolting a `cut`
field beside it would have been two mechanisms that have to agree about which wins — so the
prerequisite was replacing the pair with the list, and that is most of what this pass is.

Everything else falls out of it rather than being built:

- **undo** is an index into a list of lists, so Undo is standing somewhere else;
- **duration** is the sum of the spans;
- **the audio** is one function, `renderSamples` → `editedBuffer`, asked by the editor, the
  list, the loop and the export, so they cannot disagree;
- **the playhead** needs `toSource`, because the picture is drawn on the **source clock** and a
  playing buffer reports the **played clock** — with two cuts those differ by different amounts
  in different places, and no subtraction converts between them.

`takeEdit.ts` is pure and has **58 tests**. Every invariant in it was perturbed from a scratchpad
copy and watched go red: history dropping its front without moving the index, redo surviving a
branch, the join fade removed, overlaps unmerged, a cut emptying the take, `toPlayed` by
subtraction, the legacy trim dropped on read, zoom recentring instead of anchoring, `peaks`
ignoring its window, and all seven ways `loudSpan` could be wrong.

**Trim ends is the clearest evidence the shape was right.** It needed no new stored field, no
second path through the renderer and no undo of its own — it is an ordinary `keepOnly` with the
span worked out rather than dragged, so it composes with a cut already made and Undo takes it
back like anything else. The only new code is `loudSpan`, which answers where the sound is.

### Two details worth knowing

**The joins are faded, 5ms.** Butting two unrelated waveforms together is a step discontinuity,
and this project has already measured one of those at **1.813** against a natural per-sample slew
of **0.0288**. A voice does not change in 5ms.

**The history is bounded at 40 steps** because it is persisted, inside a store with a hard cap
whose overflow would eventually squeeze out a recording.

**The quiet threshold is relative to the take's own peak**, never a fixed level. A phone held at
arm's length records a voice that peaks around -30dBFS, and any absolute floor useful for a
close recording would call that whole take silence — so the operation whose job is to remove
silence would remove all of it. The test that pins this scales the same recording down by a
hundred and expects the same answer.

## 3. What was measured, and how

A four-tone take — 220 / 440 / 880 / 1760 Hz, one second each — so a cut can be told from a trim
by _which tones survive_.

| check                             | result                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| cut 1–2s, exported                | **3.000s**, 288,044 bytes (exactly 3s mono 48k 16-bit)         |
| is the cut material gone          | 440Hz measures **0.000** in every window of the result         |
| did the gap close                 | 880Hz plays at **1–2s** having been at source **2–3s**         |
| the loop                          | **one unbroken burst of 3,044ms** per pass, not two with a gap |
| the list's ▶ and the editor's ▶ | agree with both                                                |
| undo → redo → branch              | stored log drops the undone step; Redo correctly unavailable   |
| reload                            | the edit **and the ability to undo it** both survive           |
| zoom                              | **0.239 ms/pixel** against 3.828 at full view — 16× finer      |
| 375 sweep                         | every figure 0 across 87 controls, checker made to speak first |
| production bundle (`:4173`)       | import → cut → export → undo, all of it, in the built app      |

Gates: typecheck, lint at `--max-warnings 0`, **2,467 tests**, build.

### The third pass: real compressed files, and the microphone

The second pass's biggest gap was that every take in every check was synthesised, and the only
format this session can synthesise is uncompressed. Closed with **real files**: a 20-second
160kbps stereo mp3 and a **6-minute-41 m4a voice recording** made by Windows Sound Recorder.

| check                              | result                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| mp3 in, cut 5–9s, exported         | **16.0347s** against 16.0347 expected — one sample                      |
| and does it hold the right samples | 63 buckets compared against the original file: worst RMS gap **0.0002** |
| the same with a wrong splice       | **0.1456** — 827× larger, so the comparison can fail                    |
| m4a in, cut 1.5s at 104s           | **400.2502s** against 400.2503 expected                                 |
| and the gap closed                 | twelve probes agree with the source **shifted by 1.5004s**, to 1e-5     |
| if nothing had shifted             | out by **0.0177** — the control for the same claim                      |
| the loop                           | **2,032 and 2,041ms** of sound, 5,006ms apart, on a 5s loop             |
| reload, both takes edited          | rows, history and the ability to undo all survive                       |
| the original                       | blob bytes and stored length **never moved**, through every edit        |

**Every refusal was reached and each says something different.** The decode branch is not dead
code — it was proved by asking the two checks separately, and the two halves disagreed:

| the file                            | which check spoke | what it says                                   |
| ----------------------------------- | ----------------- | ---------------------------------------------- |
| a real 31.6MB mp3                   | size              | "That file is 31.6MB and there is 15.6MB left" |
| 11 minutes of 32kbps mp3, **2.5MB** | duration          | "That is 11 minutes long — 10 is the most"     |
| a text file named `.mp3`            | metadata          | "is not a sound file this browser can open"    |
| an m4a with its `moov` cut off      | metadata          | the same, and correctly                        |
| a video with **no audio track**     | **decode**        | "will not open in this browser"                |

That middle row is the one that could not be built before: a compressed file comfortably under
the byte cap and over the duration cap. It is 25,266 zero-payload MPEG-1 Layer III frames —
`part2_3_length` of zero means no Huffman data, so every frame decodes to silence — which is
11 minutes of real mp3 in 2.5MB. The builder is not in the repository; it is nine lines.

⚠️ **One fixture did NOT refuse, and that is Chromium's answer rather than a bug**: an mp3 whose
last 60% is random bytes imported happily as 0:20. The decoder resynchronises through garbage.
Nothing in this code can tell that from a good file, and nothing should try.

### Trim ends, measured on the recording it is for

| check                                | result                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| the 6:41 voice recording             | trimmed to **103.66s → 401.75s**, one press, 1:43 of dead air |
| where the sound really starts        | **103.752s**, found by a separate search at a 5ms window      |
| the two, less the 80ms margin        | **12ms apart** — one measuring window                         |
| the tail                             | left alone, correctly: the last sound is 21ms from the end    |
| exported                             | **298.091s**, exactly 401.751 − 103.66                        |
| a built fixture: 1s–3s of tone in 4s | kept **[0.92, 3.08]**, exported **2.160s**                    |
| on the loop                          | 2,032ms of sound per pass — the 2.16s span's 2.0s plus margin |
| a 20s drum loop with no dead ends    | the button is **off**, which is the answer                    |
| pressed twice                        | off the second time; it is never a press that does nothing    |

## 3a. The microphone was held open, two ways

The one bug in this feature that could affect somebody who never opens the editor, and neither
half was findable by reading the editor. Both reproduced with a **real `MediaStream` and real
tracks** fed by an oscillator rather than a microphone — `track.stop()` and `readyState` behave
exactly as a mic's do, nothing of the room is recorded, and the ordinary record-then-stop path
was run first as a control to prove the double was faithful.

**Leaving the room mid-recording.** `TakesPanel`'s teardown effect is headed "STOPPED ON THE WAY
OUT, BOTH OF THEM" and, from 21 September to 6 November, stopped one of them. `going` is state
and an effect with `[]` deps closes over the first render's copy of it — null, for ever — so the
comment was the specification and the code was half of it. Measured: press 🎤, go to another room, and the track reads `live` four
seconds later with the panel unmounted, the Stop button gone, and the recording dot lit on a page
nobody is looking at. Fixed with a ref the cleanup can see, and **what was sung is kept** rather
than dropped — see OPEN-DECISIONS §12a, which is the half that is a decision.

**Leaving while the permission prompt is still up.** The worse of the two, because the stream is
created _after_ the unmount and nothing holds a reference to it at all. Measured: the room gone,
then the stream made, then `live` for ever. Dropped now, the moment it arrives.

A third thing came out of fixing it: `alive.current` has to be set in the effect **body**, not
only cleared in the cleanup, because StrictMode runs the cleanup once on mount in dev — a flag
only ever set false would have made `begin` drop every recording. App.tsx has two notes about
that same double-invoke; this is the third.

**This one has no test**, honestly: it is React lifecycle wiring, it needs a DOM, and vitest here
is for the pure modules. The evidence is the measurement above and the control beside it.

## 4. Two things the browser found that reading would not

**`ResizeObserver` fires zero times in the Browser pane right now** — not even the initial
callback the spec guarantees on `observe()` — through an element that went 1045 → 499 → 1045 CSS
pixels while being watched. The canvas drew at 120px and stretched it across a thousand.
CLAUDE.md records RO working in the pane on 28 Oct; delivery rides the end of a frame, and the
same file records rAF not firing while the pane is hidden (re-measured 5 Nov, having fired on
28 Oct). One frame loop, two APIs on it. The canvas now measures in a layout effect and on
`window.resize`, and keeps RO only for a sibling resizing with the window still.

**A sweep that passes is not a screenshot.** `mobile-audit` reported zero wordless controls for
↶ and ↷, correctly — the `.sr-only` spans are real names in the accessibility tree. A screenshot
showed the row wrapping _between_ them, so Undo ended one line and Redo began the next, two
near-identical glyphs with no word. They are "↶ Undo" and "↷ Redo" now and cannot wrap apart.

## 5. What a person still has to check — the short path

Five minutes on a phone, in this order:

1. **Record something real, then press Trim ends.** This is the new one and the one most likely
   to be wrong for a voice: -40dB below your own loudest moment, with 80ms left either side. Did
   it take the fumbling off the front without clipping your first word?
2. **Cut a mistake out of the middle and listen to the join.** The one automated checks can only
   half-answer: the fade is measured, but whether 5ms is enough for _your_ voice on _your_ phone
   is an ear's question.
3. **Record something, then tap away to another room before stopping.** Come back. The take
   should be in the list and your phone should have stopped showing the recording dot. If you
   would rather it had thrown it away, say so — OPEN-DECISIONS §12a.
4. **Zoom in on a short word and select just that word.** Is the slider usable with a thumb?
5. **Undo twice, redo once, reload the page.** Everything should be where you left it.

Compressed import is no longer on this list: mp3 and m4a are both measured end to end in §3. It
is still worth opening one of your own voice memos, because the ones here were a drum loop and a
Windows recording, not an iPhone's.

## 6. Open gaps, stated rather than implied

- **No real microphone has been through this.** Still true, and it is now the only one of the
  original three left. Every take was either synthesised or a file that already existed;
  recording quality, levels and echo cancellation are unmeasured here. The microphone's
  _lifetime_ is measured (§3a) — what it captures is not.
- ~~No compressed-audio fixture~~ — **closed**. Real mp3 and real m4a, end to end, §3. The
  duration cap is exercised too, by a hand-built 11-minute mp3 that is 2.5MB.
- **Trim ends has not been heard.** The threshold is measured against a real voice recording and
  lands 12ms from where a separate search says the sound starts — but "did it clip the start of
  the first word" is a question for an ear, not for an RMS. It is one press and Undo takes it
  back, which is the mitigation.
- **Firefox and Safari are untested**, as always — the pane is Chromium. Worth saying for this
  pass in particular: `audioSeconds` leans on an `<audio>` element reporting a container's
  duration, and Safari is the browser most likely to answer differently about an m4a.
- **Listening quality is not established by any of this.** A spectrum reading 0.000 at 440Hz says
  the samples are gone; it does not say the result sounds right.
- **Range inputs elsewhere in the room are 16px tall.** The editor's own slider was caught at
  375 and given 28px; the layer faders and the take-FX knobs have no height rule either and are
  likely under the 24px floor when they are on screen. Not touched — outside this pass — but
  worth a sweep with the FX panel open.
