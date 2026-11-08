# The bench and the reload — 7 Nov 2026

_Instrument layers survived switching rooms and died on a refresh. They had never been written
down anywhere, and two ceilings in the song format had quietly shrunk a kept song for months._

---

## The report, and what reproducing it changed about the fix

> Instrument layers survive switching modules and returning, but disappear after a full page
> refresh. Check layer setup persistence separately from recordings and edit history — the latter
> aren't confirmed lost.

Both halves reproduce, on the dev server at `#instrument`. A bench was built by hand — Boom bap,
Four chords, an empty part — one layer muted, one at a fader of 1.3, the drums given a bar plan of
`[0, null]`, the empty one switched to harp, and a six-second recording placed at bar 0 with a
two-step edit history standing on step 1.

**Instrument → Games → Home → Instrument**, with the room genuinely unmounted while away: the
bench came back **byte for byte**.

**Reload:**

|                        | before                          | after                      |
| ---------------------- | ------------------------------- | -------------------------- |
| layers                 | 3                               | **0**                      |
| layer rows on screen   | 3                               | **none**                   |
| placed takes           | 1                               | **0**                      |
| recording in IndexedDB | 264,644 bytes, 6.00s            | **264,644 bytes, 6.00s**   |
| edit history           | 2 steps, standing at 1          | **2 steps, standing at 1** |
| playing settings       | bell / oct 3 / major / swing on | **unchanged**              |

So the separation the report asked for holds, measured rather than assumed: **recordings and edit
history are not lost.** Only the arrangement is.

⚠️ **AND THE FIRST RUN HID HALF OF IT.** Tempo and bar count read **96 / 2** on both sides, which
looks like survival and is not — those are the looper's own defaults and they had never been
changed. Re-run at **140 bpm / 4 bars**, the reload gave back **96 / 2**. A figure that agrees for
the wrong reason is worth less than no figure, and the only way to tell was to move it.

⚠️ **THE CAUSE WAS AN ABSENCE, NOT A FAULT**, and that is what reframed the work. `state` in
looper.ts is a module-level object; nothing wrote it to storage and nothing read it back.
`git log -S` finds no key for it anywhere in the project's history, so this never worked and there
was no stale value to clear. It also explains the first half exactly: an SPA navigation never
unloads the module, and a reload makes a new one.

The gap read as a fault rather than as a limit because **the room plainly does remember**:
instrument, octave, scale, root, chord, strum, arpeggio, swing and lead-back, plus saved rigs, the
recordings and their edit histories, all survive the same reload. The one thing that did not was
the song. A library song kept mid-run as a control came back intact — 2 layers, 140 bpm, 4 bars,
2,923 bytes on disk — so the Library was working the whole time; there was simply nothing between
"what you are playing with" and "what you decided to keep".

## What was decided

Three questions came with the fix and were put to the owner rather than guessed:

- **Restore it silently**, the way the nine playing settings already come back, rather than
  offering a "pick up where you left off" button or warning on the way out.
- **Carry the placed takes**, not only the note layers. The audio already survives in IndexedDB,
  so without this you kept the recording and lost the arrangement it was part of.
- **Never carry a jam partner's layer.** `packSong` already drops `from` from a kept song —
  "a song you kept from a jam is yours, and re-opening it should not leave parts belonging to
  somebody who is not in the room" — and a reload is that argument at its strongest: the call is
  over and the peer is gone.

`src/audio/workbench.ts` is the whole of it, with `openWorkbench()` called once from the room.
Two things in it are worth repeating here because they are easy to undo later:

- **The transport is stored beside the song rather than inside it**, although `packSong` writes a
  copy of both. `readSong` answers null when a song has no layers, and a bench holding one sung
  take over nothing is a real state with a real tempo. Only the outer pair is ever read, so the
  two cannot disagree.
- **An empty bench is written down too** — as the removal of the key. "Clear all" has to reach
  this file, or a reload puts back what somebody just deleted, which is a worse bug than the one
  being fixed.
- ⚠️ **"Clear all" clears LAYERS, and always has.** It sits inside the layer list and calls
  `clearLayers`; a recording placed in the loop has its own controls in the takes panel and
  survives it. The bench saves what the screen shows, so after Clear all with a take still placed
  a reload gives back no layers and that one take — exactly the room as it was left. Only an
  arrangement with nothing in it removes the key. Whether Clear all _should_ lift takes too is a
  question about the button, not about saving, and is not changed here.

Measured: a two-layer arrangement with one placed take is **736–774 bytes** of localStorage.

## When something will not cooperate

A restore that quietly does less than it claims is the same bug wearing a different hat, so every
failure here has to leave saved data where it was **and** say so. Each of these was a silent
`try/catch` in the first version. The room now says them on its existing `role="status"` line.

| what happened                                                                                     | what the bench does                                                                        | what the room says                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| a recording exists but will not open — a store that is blocked, a file this browser cannot decode | its placement is **carried**: written down on every later save, re-tried on the next visit | _1 recording on your loop could not be opened — its place is kept._                             |
| a store that opened, looked, and holds no such recording                                          | its placement is let go — there is nothing to come back                                    | _1 recording on your loop is no longer in this browser._                                        |
| a change did not reach the disk (full, or storage off)                                            | the last good copy is left as it was; said once, not on every change                       | _Your latest changes could not be saved in this browser._                                       |
| a saved bench this build cannot read — a newer format, or a hand edit                             | **not restored and never written over** for the rest of the visit                          | _Saved work here could not be opened, so it was left as it was. New changes will not be saved._ |

⚠️ **TELLING "GONE" FROM "WOULD NOT OPEN" NEEDED A NEW QUESTION.** `getTake` answers `null` both
for "no such row" and for "the store would not open", and `placeTake` answers `false` for both.
Reading the second as the first turns a bad moment into a deletion. `hasTake` in takes.ts answers
yes, no, or "could not say" (`count` returns a number when it can look; `run` returns null when it
cannot), and only a definite **no** lets a placement go.

⚠️ **THE UNREADABLE-BENCH RULE HAS A COST, AND IT IS THE RIGHT ONE.** A key that is genuinely
corrupt keeps this page from saving until it is removed. That is what the room did before this
change existed, it is said out loud, and the alternative — overwriting what a newer tab wrote —
deletes something nobody was shown.

## ⚠️ Two ceilings that had moved in looper.ts and not in the parser

Found on the way in, because the restore path runs through `readSong` like everything else that
becomes oscillators — and a layer came back quieter than it went in.

|             | the room offers                                                   | `songFile.ts` read       | measured      |
| ----------- | ----------------------------------------------------------------- | ------------------------ | ------------- |
| layer gain  | 0–2 (`setLayerGain`, and the slider's own `max`)                  | `num(o.gain, 0, 1.5, 1)` | 1.8 → **1.5** |
| song length | 1–32 bars (`MAX_BARS`, "eight bars is a loop and a track is not") | `num(o.bars, 1, 8, 2)`   | 16 → **8**    |

⚠️ **THE LIBRARY LOST THEM AT KEEP, NOT AT REOPEN** — which the first draft of this note said the
other way round. `saveToLibrary` runs a song through `readSong` _before_ it stores it, so a
sixteen-bar arrangement went onto the disk as eight and a layer at 1.8 went on at 1.5.
`library.test.ts` shows it by reading the store back through a fresh module, and goes red on both
when the old ceilings are put back.

That shapes what the fix can and cannot change:

- **No song already kept changes its level or its length.** What is on disk is already inside the
  old ceilings, so it reads back exactly as stored — pinned by its own test.
- **The next keep holds what the room offered.**
- **The runtime is untouched.** `MAX_BARS` in looper.ts, `setLayerGain`'s 0..2, every preset level
  and the 2× ceiling are exactly as they were; the parser now agrees with them, nothing more.
- **The live jam is untouched too** — see the next section, which is where the first version of
  this change got it wrong.

## ⚠️ Every reader of the parser, and why the jam keeps its old ceilings

`readSong` has seven callers, and the first version of this change raised the ceiling for all of
them while describing two. Asked one by one:

| reader                             | what it reads                        | effect of the corrected ceilings                                                                                                                            |
| ---------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveToLibrary`                    | a keep                               | the next keep holds what the room offered — **the fix**                                                                                                     |
| `workbench.ts`                     | this bench                           | restores what the room offered — **the fix**                                                                                                                |
| `library.ts` on load               | what is stored                       | stored songs are already inside the old ceilings: **no change**                                                                                             |
| `backup.ts` import                 | a backup file                        | written from the Library, so inside the old ceilings: **no change**                                                                                         |
| `library/cloud.ts`                 | account rows                         | written from the Library, so inside the old ceilings: **no change**                                                                                         |
| `songBlockConfig.ts`               | a profile song                       | a newly kept 16-bar song now plays 16 bars to visitors. **Gain cannot change what they hear**: `songPlayer.ts` ignores `gain`, `play` and `plan` altogether |
| `jam.ts` — `jam:layer`, `jam:song` | a partner's LIVE state, never a keep | **would have changed the room's sound** — so it does not                                                                                                    |

The jam reads at `JAM_CEILINGS = { bars: 8, gain: 1.5 }` — `main`'s exact literals, at exactly the
sites that held them (the plan and play arrays and a mask's own `pb` were already 32 for everybody,
and still are). `readSong` takes the ceilings as an optional argument whose default is what the
room offers, so only the two jam call sites name it. Raising the jam to the full range is deleting
that constant and those two arguments, and **it waits for a decision**, because what it changes is
what a live room sounds like.

### What the jam does today, measured rather than read

`src/party/jam.test.ts` runs **two real rooms** — each a fresh module instance of `jam.ts` and
`looper.ts`, joined by a stand-in for the party channel and nothing else — and pins today's
behaviour. All three tests pass against `main`'s own `songFile.ts` and `jam.ts` (copied in and run,
then restored byte-identical), and all three fail with `JAM_CEILINGS` taken out of the jam:

- a partner's layer at **1.8 plays at 1.5** on your machine
- ⚠️ **and its author's own layer drops to 1.5 the moment a partner receives it**, with nobody
  touching anything. Found by the test, not by reading. The receiver's echo guard —
  `sentLayers.set(…)` after `putSharedLayer` — is written one line too late: the looper notifies
  synchronously, so the jam's own diff runs _inside_ `putSharedLayer`, finds a layer it has no
  record of sending, and sends it back. Its author receives a message about its own layer,
  `localIdFor` maps it home, and it is applied as the partner read it. At equal ceilings that echo
  is a wasted message per change and a `releaseLayer` on the author's take; above 1.5 it moves the
  author's fader.
- an offered song longer than **8 bars loads as 8**

Both the echo and the ceiling are on `main` and both are left exactly as they were. The echo is a
bug by any reading and its fix is small (record the guard before applying, forget it if the desk
is full), but it changes what a live jam sends — so it is named here and not folded into a change
about saving.

`readPlay`'s comment in the same file reads "Bounded at MAX_BARS like everything else here" while
`bars` was bounded at 8, which is the tell. Both are named constants now — `MAX_BARS` and
`MAX_GAIN`, declared beside `MAX_LAYERS`, which songFile.ts deliberately duplicates rather than
importing from looper.ts, because this parser is reached from the profile renderer and must not
drag the audio engine into that bundle. An existing test asserted the old ceilings and had to be
corrected — a test agreeing with a stale number is why they lasted.

**Named and not fixed:** `packSong` packs the `play` mask as `1 << i`, and `1 << 31` is negative in
JavaScript, which the reader takes to mean "no mask". A legacy 32-entry mask with bar 32 playing
and any other bar muted therefore comes back playing everywhere. Unchanged by this PR (the bound
was already 32) and unreachable from new work — `setLayerPlan` clears `play` — so it belongs to its
own change.

## How it was checked

All of this in an isolated worktree on `fix/instrument-bench-survives-reload` from `main`, served
on its own origin (`:5174`, confirmed to be the worktree by a function that exists only there).

- **46 tests**: 31 in `workbench.test.ts`, 9 added to `songFile.test.ts` (5 for the Library's
  ceilings, 4 for the jam's), 3 in a new `library.test.ts` and 3 in a new `jam.test.ts` — on
  fixtures where every field is something other than its default. The
  wiring tests run in node, which has no IndexedDB and is therefore exactly the "store will not
  open" browser.
- **Made to fail first.** Seventeen perturbations of the pure half, ten of the wiring and six of
  `packSong`, each reverted from a scratchpad copy and each caught by the test named after it —
  with one exception, below. Files restored byte-identical afterwards.
- ⚠️ **The exception:** a take that has been placed must leave the carried list, or lifting it later
  would bring it back on the next reload. Node cannot place a take, so nothing there can see this;
  it was checked in the pane instead (lifted → reload → still lifted).
- **In the pane, through full reloads:**
  - silent restore of a bench of two layers at **140 / 4**, one muted, one at **gain 1.8**, a plan,
    both picker tags and a recording placed at 3.25s with tone −0.4 / squeeze 0.7 / space 0.6, muted,
    tremolo 16 × 0.65 — identical, with no notice shown
  - the recording's **264,644 bytes** and its two-step edit history **untouched**, and the loop
    plays the **3.500s** edit rather than the 6.000s file
  - a lifted take **stays lifted**
  - a jam partner's layer added through `putSharedLayer` is **not written and not restored**
  - one recording made undecodable and another deleted behind the page's back: the first keeps its
    place and its settings through the reload **and** through a later change; the second is let go;
    the room says both
  - a refused write: told once, the last good copy kept, saving resumes when room returns
  - an unreadable `v: 2` key: told, and **byte-identical** after a new layer, a tempo change and a
    forced `pagehide` flush
  - **Clear all → reload: empty**, key gone, no notice
  - the longest message at 375px wraps inside the page — no sideways scroll, no spill
- **The jam ceilings, made to fail**: each of the four parser claims broken on its own (jam gain 2,
  jam bars 32, the packed fallback reading past 8, a plan bounded at 8) and caught by the test
  named for it; the jam's call sites stripped of `JAM_CEILINGS` sent all three two-room tests red.
- **In the PRODUCTION bundle** (`vite build` + `vite preview` from the worktree, on `:4174`, an
  origin with no IndexedDB and no saved bench before it started), driven through the room's own
  controls and real keystrokes, with a recording seeded as the exact row `putTake` writes:
  - 140 / 4 typed into the fields, Four chords and Boom bap picked, the pad muted, the drums at
    **1.8**, the recording placed, muted, with Tone −0.4 / Even 0.7 / Space 0.6 and tremolo 16 ×
    0.66 → reload: **every one of those on screen**, both picker buttons pressed, no notice, the
    saved key byte-identical, and the recording's bytes and two-step history identical
  - recording lifted and the muted layer deleted → reload: **still lifted, still deleted**, the
    recording still in its list
  - one copy made undecodable and another deleted → reload: _"1 recording on your loop could not be
    opened — its place is kept. 1 recording on your loop is no longer in this browser."_; the first
    still carried after a later change
  - `localStorage.setItem` refusing this key → said **once**, the last good copy kept, a second
    refusal silent, saving resumed when it was allowed
  - a `v: 2` key → said on load, **byte-identical** after a new layer and a `pagehide`
  - Clear all → reload: no layers (and the placed recording, which Clear all does not touch);
    lifting that too removed the key, and the next reload was empty at 96 / 2
- `npm run typecheck`, `eslint . --max-warnings 0`, **150 files / 2,808 tests** (main's 2,762 plus
  these 46 and nothing else), `npm run build`.

## Still unverified

Chromium only. **Nothing has been listened to** — every reading above is a number, and the
restored take's audio was proved by its buffer length rather than by an ear. A genuinely blocked
IndexedDB was exercised in node, not in a browser; an undecodable recording was exercised in the
built bundle. The two-room jam tests are node, not two browsers on a relay. Firefox and Safari are
untested.
