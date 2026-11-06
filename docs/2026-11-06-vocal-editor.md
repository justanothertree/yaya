# The vocal editor — where it stands, 6 Nov 2026

Two passes over the recording/editing workflow in the Instrument's takes panel. This is the
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

`takeEdit.ts` is pure and has **48 tests**. Every invariant in it was perturbed from a scratchpad
copy and watched go red: history dropping its front without moving the index, redo surviving a
branch, the join fade removed, overlaps unmerged, a cut emptying the take, `toPlayed` by
subtraction, the legacy trim dropped on read, zoom recentring instead of anchoring, and `peaks`
ignoring its window.

### Two details worth knowing

**The joins are faded, 5ms.** Butting two unrelated waveforms together is a step discontinuity,
and this project has already measured one of those at **1.813** against a natural per-sample slew
of **0.0288**. A voice does not change in 5ms.

**The history is bounded at 40 steps** because it is persisted, inside a store with a hard cap
whose overflow would eventually squeeze out a recording.

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

1. **Record something real and trim it.** Synthetic tones cannot say whether the waveform is
   legible for a _voice_. Does the envelope show you where you started singing?
2. **Cut a mistake out of the middle and listen to the join.** This is the one that automated
   checks can only half-answer: the fade is measured, but whether 5ms is enough for _your_ voice
   on _your_ phone is an ear's question.
3. **Open a voice memo from your phone** (m4a / mp3). See §6 — compressed import is the biggest
   untested path.
4. **Zoom in on a short word and select just that word.** Is the slider usable with a thumb?
5. **Undo twice, redo once, reload the page.** Everything should be where you left it.

## 6. Open gaps, stated rather than implied

- **No real microphone has been through this.** Every take in every check was synthesised and
  written through the real store. Recording quality, levels and echo cancellation are unmeasured
  here.
- **No compressed-audio fixture.** The import path was exercised with WAV only, because the only
  formats this session can synthesise are uncompressed. m4a and mp3 are unverified end to end.
  The **duration cap is therefore also unexercised**: a long compressed file is the only thing
  that reaches it, and the size cap catches every uncompressed file first.
- **Firefox and Safari are untested**, as always — the pane is Chromium.
- **Listening quality is not established by any of this.** A spectrum reading 0.000 at 440Hz says
  the samples are gone; it does not say the result sounds right.
- **Range inputs elsewhere in the room are 16px tall.** The editor's own slider was caught at
  375 and given 28px; the layer faders and the take-FX knobs have no height rule either and are
  likely under the 24px floor when they are on screen. Not touched — outside this pass — but
  worth a sweep with the FX panel open.
