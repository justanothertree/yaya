# Flats, and names for the icons — 9 Nov 2026

Two things Evan asked for after the Instrument release. No database change.

## Chords are spelled in the room's key

The chord readouts (the backing's _… underneath_ and what you are holding) spelled every chord
with sharps, so D minor's sixth chord read **A♯ major**. In D minor it is **B♭**.
`keySpeller(degrees, root)` in chordName.ts now spells notes the way a musician would:

- **The key signature decides sharps or flats.** A scale with a minor third and no major third is
  read from its relative major. F, B♭, E♭, A♭ and D♭ major are the flat keys.
- **On a seven-note scale each degree gets its own letter.** D harmonic minor reads B♭ and C♯ in
  the same key, and F♯ major's seventh reads E♯.
- D♯ and G♯ harmonic minor would need a double sharp, so they are spelled from E♭ and A♭ instead.
  That is 2 of the 84 seven-note keys; all 84 now spell on seven letters.
- **Notes outside the scale**, and scales of other sizes, take the key's plain spelling: G minor
  pentatonic reads B♭.
- **Chromatic** has no key, so it keeps the sharps it always used. So does the keyboard's own
  labelling, which this does not touch.

## The phone-only tooltip controls have names

Six controls in the room were explained only by a `title`, which a phone cannot show:

- the layer row's ⏺, 🔊 and ✕
- the bar cells
- the bar ruler's numbers

Each now has an `aria-label`. The mute button also has `aria-pressed`, and its tooltip says when
it is muted. A bar cell's name says what the bar is ("Bar 3, part 1 of 2"); its tooltip still says
what a tap does.

**Visible words were measured and rejected.** At 375, "⏺ Again", "🔊 Mute" and "✕ Delete" took
every layer row from 114 to 144 px: about 360 px down the page at twelve layers. The bar cells are
30 px blocks.

## Verified

- `chordName.test.ts`, 8 new tests written as the chords a songbook prints. Four perturbations
  each turned tests red once:
  - no flat keys
  - minor read from its own root (caught only by the pentatonic case, which was added for it)
  - no per-degree letters
  - no fallback to the other tonic
- **In the room:**
  - Four chords in D minor read D minor → A minor → **B♭ major** → G minor.
  - At 375 with touch, `mobileAudit` reported **0** controls explained only by a tooltip (was 6),
    and 0 of everything else across 131 controls. Stripping one `aria-label` brought exactly that
    control back.
  - The accessibility tree reads "Record this layer again", "Mute this layer" and "Delete this
    layer".
  - The layer row stayed 114 px tall.

**Not verified:** a real screen reader (VoiceOver, TalkBack).

## And the keys themselves — 10 Nov 2026 (stacked draft)

Evan's overnight ask: _keyboard key labels following the key like #108_. The keys under the
readouts still said A♯ in D minor. `noteLabel(midi, spell)` in chordName.ts labels each key with the
same speller the readouts use, plus its octave.

The one part that is not a lookup is that **the octave number belongs to the letter**. The octave
turns over at C, so:

- E♭ harmonic minor's sixth is C♭5, though it sounds as B4.
- C♯ harmonic minor's seventh is B♯4, though it sounds as C5.

Chromatic keeps its sharps, and so does the Key picker's own list, which this does not touch.

Verified:

- 4 tests, written as a teacher would read the keys out. Removing the octave turn turned 1 red;
  ignoring the speller turned 2 red.
- In the room, D minor reads D E F G A **B♭** C, E major reads E F♯ G♯ A B C♯ D♯, and A♭ major
  reads A♭ B♭ C D♭ E♭ F G. The screen-reader labels match.
- At 375 every label fits its 37 px key. The check was made to catch a planted over-long label
  first, because `mobileAudit` deliberately leaves the keyboard out.
