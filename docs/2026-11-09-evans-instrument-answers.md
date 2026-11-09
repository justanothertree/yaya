# Six Instrument questions, answered — 9 Nov 2026

Evan answered six of the eight questions the integration build ([#90]) held open, before testing
it. Each answer is one commit on `instrument/decisions-nov-9`, stacked on `instrument/integration`
at `8557a6f`, so any one can be reverted on its own. The test build on :4175 is untouched.

[#90]: https://github.com/justanothertree/yaya/pull/90

| #   | Question                                   | Answer                         | What changed                                                 |
| --- | ------------------------------------------ | ------------------------------ | ------------------------------------------------------------ |
| 1   | Should a jam use the full range?           | **Yes — gain to 2, 32 bars**   | `JAM_CEILINGS` deleted, and the `ceil` parameter with it     |
| 3   | Desktop instrument menu open at the start? | **Yes**                        | starts open wider than 40rem, closed on a phone              |
| 5   | Should Clear all lift recordings too?      | **No — they stay in the loop** | behaviour unchanged; a note and a title say so               |
| 6   | Re-lay chords when the loop is shortened?  | **No**                         | notes unchanged; the Chords row says when the loop cuts them |
| 7   | Should a swap keep a mute?                 | **Yes**                        | `addPatternLayer` keeps `muted`; a muted row says so         |
| 8   | Should the layer's ⬇ say Keep?            | **Yes — "⬇ Keep"**            | label                                                        |

**Still open, on purpose:** 2 (do the styles sound like their names, Pulse's note length, Keys
about twice as loud as Pad, Keys as the rhythmic sound) and 4 (should the editor's Save offer a
processed copy). Both wait for Evan to listen.

## What each answer made untrue, and what was done about it

- **1 · Jam range.** A partner on a bundle from before this still reads at eight bars and 1.5,
  and their edits go home that way, until their next load. Nothing stored is involved.
  jam.test.ts's three range tests now assert the opposite of what they did, through two real
  rooms; made to fail once by putting a 1.5 / eight-bar clamp back. Nothing between two players
  checks these fields: jam messages are broadcasts on the call's Supabase Realtime channel
  (`sendParty` in voiceSession.ts), gated on room membership and nothing else. The ws relay only
  hands out TURN credentials.
  ⚠️ **And the shared transport had an 8 of its own.** `setTransport` — how a partner's tempo
  and bar count are adopted — still clamped bars at 8, the last copy of the old ceiling and one
  #35 never reached because it is not in the song file. A partner's 16-bar loop played as 8, and
  the next tempo change made on that machine sent `bars: 8` home and halved the author's. It now
  clamps at MAX_BARS; setTransport.test.ts asks setBars what the room allows and expects the
  transport to agree, from 0 to 400.
- **3 · Menu open.** This brings back the cost #78 removed: at 1440×900 ▶ Play sits at
  998–1036px with the grid open and 711–750 closed; at 1920×1080 it ends at 1109. One press of
  the menu button gives the fold back. Recorded beside the menu so it is not rediscovered.
- **5 · Clear all.** No behaviour to change. The button's title now says what it leaves.
- **6 · No re-lay.** Shortening the loop under a progression left Four chords and ↩ Lead back
  reading pressed about bars nobody could hear (#75's write-up named it and left it). The Chords
  row now says _cut short — pick it again to fit_; picking it again is the re-lay, on purpose.
- **7 · Mute kept.** A pressed backing button can now make no sound — a new beat picked under a
  muted kit. The row says _muted in the layers_ beside it, so the silence is not mistaken for a
  broken picker. Re-recording a layer still un-mutes it; that is not a swap.
- **8 · ⬇ Keep.** 55×24 at 375 with touch; the layer row does not wrap or spill.

## Verified

`npm run typecheck`, zero-warning `npm run lint`, `npm run test`, `npm run build`. In the room on
the dev server at 375 with touch and at 1440×900 / 1920×1080: menu state on load, a muted bass
and beat surviving a style change and two beat swaps (with the caption following the beat from
Rock's row to Funk's), the cut-short caption appearing and clearing, and `mobileAudit` at 0 on
every count with the backing panel open — after a planted 16px control and 600px child were
reported and removed.

**Not verified:** two browsers in a jam — that needs two signed-in members in one call, which
only Evan can set up (a local build reaches the real Supabase project for the call itself, but
its `VITE_WS_URL` is `ws://localhost:8080`, so it gets no TURN and falls back to STUN); anything
by ear; Firefox and Safari; a real phone.
