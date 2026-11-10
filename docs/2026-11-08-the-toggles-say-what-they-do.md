# The toggles say what they do — 8 Nov 2026

Evan's feedback, item 5: explain Hold, lead back and the last-bar fill near their controls, verify
what they actually do, and have disabled controls say why — without paragraphs of permanent
clutter.

**Based on `main`, independent of #35, #70 and #74.** Nothing here touches the bench, the take
editor or a take's sound.

## What was there

Hold, ↩ Lead back, the bass's _Follow the chords_ and the fill's _On the last bar_ each explained
themselves **only in a `title`** — and a tooltip does not exist on a phone. Three of them can be
disabled, and the reason lived in the same tooltip: on the device most people play this on, a
disabled control was a grey word with no explanation. The fill's tooltip did not cover one of its
two disabled states at all (every layer in use).

## What it does now

Each of the four carries a second line, inside the button, of three or four words — what it does,
or while it is disabled, why. One slot, so explaining a disabled control costs no extra space; the
`title` stays for the longer sentence.

| control           | says                                    | disabled says                         |
| ----------------- | --------------------------------------- | ------------------------------------- |
| 🦶 Hold           | _lets notes ring_ · on: _tap to let go_ | _arpeggio is on_                      |
| ↩ Lead back      | _last bar leads home_                   | _already ends there_                  |
| Follow the chords | _root and fifth_                        | _pick chords first_ · _no layer free_ |
| On the last bar   | _tom roll to end_                       | _needs 2+ bars_ · _no layer free_     |

## ⚠️ Verifying the fill found that its name stopped being true

_On the last bar_ lays the fill as a plan of nulls and one slot, sized to the bar count **when it
is pressed** — and a bar past the end of a plan is silent (`partAt`). So:

- laid on 2 bars, grown to 4 → it played in **bar 2**, the middle, and never in bar 4
- laid on 4, shrunk to 2 → it **never played**
- …and the button read pressed throughout

`setBars` now moves a fill **that is still on the last bar** to the new last bar
(`followLastBar` in arrange.ts). A fill dragged somewhere else on purpose is left where it was put,
and so is every other arranged layer. Below two bars nothing moves — every bar is the last one
there, which is why the button is disabled — and the plan is kept, so going back to two or more
finds it again.

## What each was verified to do

In the pane, on a dev server serving this branch, reading the app's own looper (the instance the
page loaded, `looper.ts?t=…` — the plain path was a second, empty copy, as CLAUDE.md warns) and
the instrument's own output tap:

- **Lead back** — Four chords off: the last slot is **F A C** (IV). On: **F A C → G B D**, the V
  that leans back to the top. Fifties already ends on V: disabled, _already ends there_.
- **Fill** — laid at 2 → `[null,0]`; grown to 4 → `[null,null,null,0]`; shrunk to 1 → unchanged,
  button disabled _needs 2+ bars_; back to 3 → `[null,null,0]`; moved by hand to bar 1 then grown
  to 5 → `[0,null,null]`, left alone; the chord layer untouched.
- **Hold** (Organ, so a held note cannot be mistaken for a release tail; output RMS): silence 0 ·
  key down 0.137 · released without Hold 0.006 · **released with Hold 0.137, still 0.137 1.4s
  later** · Hold off 0.0065. **Shift** as the momentary pedal: Hold on while it is down, the
  released note held at 0.137, let go to 0.0065 when Shift comes up. An arpeggio disables it
  with _arpeggio is on_; turning the arpeggio off puts _lets notes ring_ back.
- **375 with touch**: the panel's 26 controls and the Hold row's 5 — 0 undersized, sideways,
  spilling or clipped; screenshot checked.

## Named, not changed

**A progression is laid for the loop's length at the moment it is picked**, so shrinking the loop
afterwards cuts the take short and the last bar — lead-back included — is no longer heard, while
↩ still reads pressed. Growing it repeats the progression, lead-back and all, which is musically
fine. This is every chord layer, not lead back, and whether a progression should re-lay itself to
a new length is a product question; it is written here rather than decided.

## Not verified

Nothing has been listened to; the output tap measures level, not taste. Chromium only. The
captions have not been read by somebody who did not write them.
