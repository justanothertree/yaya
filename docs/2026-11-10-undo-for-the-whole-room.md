# Undo for the whole room — 10 Nov 2026

Evan's first overnight ask: **room-wide undo and redo for layer and arrangement edits, with
buttons plus Ctrl+Z, and only your own changes in a jam.** No database change.

## What it was

"↶ Undo take" removed the last **layer**, whatever had happened since. Nothing else could be taken
back:

- a deleted layer, or Clear all
- a beat or style swapped over the one you liked
- a bar dragged to the wrong place
- a key change that re-laid the chords
- a song opened over your work

## What it is

`history.ts` watches the looper's store. Every edit replaces the layers it changes with new
objects, so comparing references shows exactly which layers a change touched. A step stores only
those layers, before and after, plus the tempo and bar count when they moved.

- **↶ Undo and ↷ Redo** replace "↶ Undo take", and **Ctrl+Z / ⌘Z** and **Ctrl+Shift+Z / Ctrl+Y**
  do the same from the keyboard.
  - They show while there are layers, or anything to undo — so Undo is still there after Clear
    all.
  - In a text field, the field keeps its own undo.
- **One step per action.** The same field of the same layer changing again within a second folds
  into one step: a fader drag is one step, not sixty. A fader and then a mute are two.
- Tempo changes take their rescaled notes back with them. Growing the song takes back the
  arrangement it carried. Opening a song can be undone.
- **Undo can't go back past what the page opened with.** Putting the saved bench back on load is
  not a step.
- **The note editor keeps its own undo while it is open.** It already takes Ctrl+Z for its notes,
  so the room's buttons stand down and the key goes to the editor rather than both taking a step.

### Own changes only, in a jam

- **A partner's change is never recorded.** The jam applies its messages inside `fromElsewhere`
  (looper.ts), and so do its own bookkeeping and the bench restore.
- **An undo never overwrites what a partner did since.** A step is put back layer by layer, and
  only where the layer is still exactly as the step left it. If a partner muted it since, they keep
  their mute. The same goes for the tempo and bar count.
- **Your own change to a partner's part is still yours to undo**, and it goes home to them like
  any other edit.
- The jam marking your layers as shared doesn't count as an edit. Without that, every step from
  before you joined would read as overwritten.

`undoLast` had no other caller and is removed.

## Verified

- `history.test.ts`: 16 tests through the looper's own edits, with expectations written as what
  the room looks like afterwards. Seven perturbations each turned tests red once:
  - recording changes from elsewhere
  - `shared` counted as an edit
  - no folding
  - overwriting what changed since
  - redo surviving a new change
  - the transport not put back
  - the jam's apply not marked as from elsewhere
- In the room on the dev server, at 1440 with real clicks and real key presses:
  - After a reload the restored bench is not undoable.
  - Clear all → 0 layers with Undo still shown → Undo → 2 layers, Redo enabled.
  - Ctrl+Shift+Z → 0 layers; Ctrl+Z → 2. No note sounded from the Z key.
  - With the note editor open, the buttons are disabled with a reason, and Ctrl+Z left the room's
    layers and redo alone.
- At 375 with touch, `mobileAudit` read 0 sideways, off-edge, clipped, spilling and undersized
  across 122 controls, after a planted fault was reported and removed.
  - The pair wraps as one unit: Redo alone used to drop a line.
  - At 1440 the pair takes a third line of the transport block, 46 px.
  - The audit's 6 tooltip-only controls are the ones #108 names, not these.

**Not verified:** a two-browser jam (a partner's edit arriving mid-history). The two-machine path
is covered by the unit tests through `putSharedLayer`.
