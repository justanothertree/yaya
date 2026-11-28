# Drum pads: a plan, nothing built

Evan, 21 Nov 2026 (item 8): "Plan only, then send it to me before building: a new MPC-style
drum-pad mode. I record short samples into pads (a clap, beatboxing, a voice sample), then play or
record MIDI notes that trigger those pads, and the result becomes a track on the timeline."

On 22 Nov: "where you need my answers, pick sensible defaults, list them clearly, and keep going;
I'll correct them later." The defaults are listed at the end, numbered, so a correction can name
one.

## The idea in one paragraph

A pad part is an ordinary **🥁 Drums** part that also carries a **pad bank**: twelve slots, each
holding one short recording of yours. The twelve slots are the drum kit's twelve pieces (a part's
notes already pick a piece by `midi % 12`), so everything drums do works unchanged:

- the 🥁 Beats patterns;
- splitting a beat into one part per piece;
- the drum names;
- the MIDI export's drum channel;
- recording a part with the keys.

Where a pad has a recording, you hear the recording. Where it has none, you hear the kit piece.

## Why a drums part with a bank, not a new instrument

The obvious shape is a new instrument, "Sampler", and the code would punish it in four places.
The new id would be read as something else everywhere that hasn't been taught it:

- **An older bundle reads an unknown instrument as 🎹 keys** (`songFile.ts:230`). A song saved
  with pads and opened on a tab that hasn't reloaded would play your beatbox as piano.
- **A jam partner drops unknown instruments** (`party/jam.ts:164`). They would hear nothing.
- **A profile visitor plays notes only** (`songPlayer.ts`). They have no recordings, and would get
  keys or silence.
- **Every drums special case** (about a dozen, listed in the map) would need a second branch.

A drums part with an optional `pads` field avoids all four:

- old readers, jam partners and profile visitors hear the kit, which is the honest fallback for
  "a beat whose sounds live on someone else's phone";
- new readers hear your recordings;
- turning pads off is clearing the bank, and nothing about the notes changes.

## What you see

- **Choosing 🥁 Drums shows a 4×3 pad grid in place of the keyboard**, with ⚙ Pads, on phone and
  desktop.
  - On a phone the grid replaces a keyboard that can't fit 12 keys anyway (a 13-key row is already
    499px wide in a 325px window), so it is the better layout there.
  - Each pad shows its name: the kit piece's ("Kick", "Clap"…) until you give it a recording, then
    the recording's.
- **Tapping a pad plays it. The computer keys play the same 12 pads** (the bottom-row keys that
  play the kit today).
- **⚙ Pads opens a sheet with the twelve slots.** Each slot has:
  - **● Record**: hold to record, up to 4 seconds. The silence before the sound is trimmed.
  - **From a recording**: one of your 🎤 takes, or a file.
  - **Trim**: the take editor you already have.
  - **Level**.
  - **Clear**: back to the kit piece.
- **Recording a beat** is recording a part, as today: arm it, play the pads over one pass, and it
  lands as a part on the timeline with its volume slider, mute and bars. Quantise works as for any
  part.
- **Export** (⬇ and 💬 Send in a chat) records what you hear, so your recordings are in the file.

## How it works

- **Samples are takes.** A pad recording is a `TakeRow` in the same IndexedDB store, marked as a
  pad sample, so the 🎤 list doesn't show it. It counts in the same 16 MB, and is refused (never
  evicted) when full.
  - It can reuse the recorder, the take editor, the waveform and `editedBuffer`.
  - A new pure function trims the leading silence: the first sample above a threshold, minus 5ms.
    It is tested on a synthetic click and on a recording with a breath before the clap.
- **The bank rides on the part:** `Layer.pads?: (string | null)[]`, twelve take ids or null.
  - It is carried through all eight places a part field must go (`Layer`, `SongLayer`, `toSong`,
    `readLayer`, `PackedSong`, `packSong`, `readPacked`, `songToLayers`).
  - Its fixture is set off its default in every slot, each place made to drop it once, and watched
    go red (CLAUDE.md, "a fixture sitting on defaults").
- **Playing:**
  - `noteOn`'s drums branch asks the part's bank before `hitDrum`. A slot with a decoded buffer
    plays an `AudioBufferSource` on the part's bus, so the part's volume, effects and the export tap
    all apply. An empty slot, or one whose recording isn't on this device, plays the kit piece.
  - Buffers are decoded when the bank is set or the song is opened, never at note time (`noteOn`
    is synchronous).
- **Stopping:** unlike kit hits, sample sources are tracked. Stop, mute, deleting the part and
  Panic all cut them, and a pad played again cuts its own previous hit (choke). A four-second
  beatbox must not keep going after Stop, which a kit hit never had to worry about.
- **On another device**, the part plays the kit wherever its recordings aren't present. The part
  says so ("3 pads play the kit here: their recordings are on another device") rather than going
  quiet.

## Steps, each released on its own once you've said yes to the plan

1. **The core, no UI.**
   - The `pads` field through all eight places.
   - The onset trim.
   - The sampler branch in `noteOn`, with tracked sources and choke.
   - The fallback.
   - Tests for each, including a song round trip with every slot set.
2. **The pad grid and ⚙ Pads,** at 375 and desktop, with record-into-pad, from-a-recording, trim,
   level and clear. Checked in the pane with `mobileAudit`, and the room's controls counted before
   and after.
3. **Recording beats with pads, and the timeline.** Undo covers bank changes (they replace the
   layer, so `history.ts` sees them).
4. **On another device:** the line that says which pads play the kit; an export check that the
   recordings are in the file.

## The defaults I picked (correct any by number)

1. **12 pads, not the MPC's 16**, because the kit has 12 pieces and everything drums do keys off
   `midi % 12`. Sixteen would mean a second mapping everywhere.
2. **Pads are a 🥁 Drums part with a bank**, not a new instrument, for the fallback reasons above.
3. **Up to 4 seconds a sample.** Longer is refused with a line saying so.
4. **One-shot, and playing a pad again cuts its last hit** (choke). Stop cuts everything.
5. **No velocity**; the app has none anywhere. Each pad has a level instead.
6. **The recorder is the voice recorder as it is**, with echo cancellation, noise suppression and
   auto gain on, because you said to leave recording quality alone. Those soften a clap's attack;
   they're the first thing to revisit when you give feedback on clips.
7. **Leading silence is trimmed automatically** (threshold -40 dBFS). The tail is yours to trim.
8. **Recordings stay on this device.** A song keeps which recording each pad uses; elsewhere the
   kit plays. Syncing them would be R2 again (piece B's storage) and is a separate yes.
9. **"MIDI notes" means the app's own note parts.** There's no Web MIDI input today and this
   doesn't add one. Importing a `.mid` file is not in scope.
10. **The keys are the ones that play the kit today.** On a phone the grid replaces the keyboard
    when 🥁 Drums is chosen.
11. **A bank belongs to its part.** The room remembers the last bank you edited and gives it to the
    next drums part you record.
