# The backing follows the key — 9 Nov 2026

Evan's answer to a question queued with the integration build: **changing key should re-voice
chords already laid.** No database change.

## What it was

A progression was built in the key of the moment it was dropped and then stayed there. Moving the
Key picker re-tuned the keyboard over a backing still in the old key, so the notes scale lock
offered could clash with what was underneath. It was left open because the layer is editable, and
re-laying it could silently overwrite hand edits.

## What it is now

An effect on the room's voicing, meaning Scale plus Key, re-lays the backing whenever either
changes, including when a rig changes both. `revoice` in chordPatterns.ts decides how:

- **A backing nobody edited is laid again in the new key.** It keeps its own length and style and
  the lead-back it was found with. Its sound, level, mute and arrangement are untouched, because
  only its notes change (`setLayerEvents`). C → D → C gives back exactly the original notes.
- **It is recognised from its notes.** These are tried in every key of every scale, with and
  without the lead-back. A song does not store its key, so a progression laid in D and opened in a
  room set to C still lands in the key the picker names.
- **An edited backing moves by the key's interval**, edits included. For a key change alone this
  is exactly what re-laying an unedited one would do.
- **On a change of scale, an edited backing keeps its old scale**, because notes moved by hand
  cannot be read back as scale degrees. The row then reads _outside this scale — pick it again to
  fit_. That caption is worked out from the notes (`outsideScale`), not from a record of what
  happened.
  - The first version did keep a record, and the next key change wiped it while the notes were
    still out of scale.
  - Nothing the room lays can trip it: every progression and bassline, in every style, key, scale
    and lead-back, is swept.
- Chromatic has no degrees of its own (it borrows C major), and changing its hidden root changes
  nothing.
- Loading a song never re-lays anything.

## Verified

- `revoice.test.ts`, 15 tests, with the expectations written as chord names. Each rule was made to
  fail once:
  - exact times instead of a tolerance (a tempo change read as an edit)
  - only the room's previous key tried
  - the lead-back dropped
  - an edited backing re-laid
  - an edited backing not moved
  - the caption never shown
  - the caption ignoring the root
- In the room on the dev server, through the keyboard's _… underneath_ hint and the app's own
  looper, read through a module script injected into the page:
  - Four chords in C major read C → G → A minor → F.
  - Key D: D → A → B minor → G.
  - Scale minor: D minor → A minor → B♭ → G minor, and the bass followed (D A / A E / B♭ F / G D).
  - Key F: F minor's chords and bass.
  - A note added by hand, then Scale major: chords left, caption shown, bass re-laid.
  - Key G: chords moved +2 with the edit, and the caption stayed through a reload.
  - Scale minor: the edited chords fit the scale, so the caption went.
- At 375 with touch, `mobileAudit` read 0 sideways, off-edge, clipped, spilling and undersized
  across 207 controls with the caption showing, after a planted fault was reported and removed.

**Not verified:** by ear; a two-browser jam. In a jam, re-voicing a partner's backing sends the
edit home to them, so the backing changes for both of you.

**Noticed, not changed:** the hint names B♭ as _A♯ major_ in D minor (`nameChord` spells with
sharps).
