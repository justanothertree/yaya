# Song sections — a design to talk through, not to build yet — 10 Nov 2026

Evan held sections for a conversation and asked for a short doc only once everything else was
done. Nothing here is built. It is the shape of the problem, three ways to solve it, the
questions only he can answer, and what I'd do first.

## The problem

A song here is **one loop**: up to 32 bars, played round and round. Within it, each layer can
already be arranged bar by bar. So a verse can drop the drums for two bars, and a fill can sit on
the last bar. What you cannot make is a **chorus**: a part that sounds different because the
**chords** change, and that comes back. Two things stop it:

- **A progression fills the whole loop.** Its chords divide the loop between them, so "Four chords
  for the verse, Fifties for the chorus" has nowhere to go.
- **There is no name for a stretch of bars.** You can arrange bar 9 differently, but nothing says
  bars 9–16 are the chorus, or lets you copy them, move them or play them twice.

The twelve-bar blues was left out of the progressions for the first reason.

## What already exists to build on

- Per-layer `plan`: for each bar of the song, which bar of the take plays there, or silence. It is
  saved in song files, drawn by the bar strip, and sent in a jam.
- `growPlan` and `followLastBar`: an arrangement already survives the song changing length.
- 12 layers, 32 bars. At 8 bars a section, that is four sections.

## Three ways

1. **Sections are named stretches of the one loop.** Verse = bars 1–8, Chorus = bars 9–16. A strip
   above the bar ruler names them; "copy this section" copies every layer's plan for those bars.
   Chords become per-section: a progression is laid across **a section's** bars rather than the
   whole loop. _Smallest change, and the jam, song files and undo work as they do today. Capped at
   32 bars, and a section played twice is two copies of it._
2. **Sections are separate loops, chained.** Each section has its own layers and length, and a song
   is an order such as A A B A. _Truest to how songs are built, with real repeats and no 32-bar
   ceiling — but a new song format, a scheduler that switches loops at boundaries, and the jam
   learning about the order. The biggest change by far._
3. **Patterns and an order, like a tracker.** The layers stay as they are; a section is a named bar
   range, and the song is an order list of ranges ("1–8, 1–8, 9–16, 1–8"). _Repeats without copies,
   one loop of material — but the playhead no longer moves straight through the loop, which the bar
   strip, the ruler and Capture all assume it does._

## Questions for you

- **Do people want different chords in a chorus?** That's the main reason to do this at all. If
  the answer is mostly "the drums drop out", the per-bar arrangement already does it.
- **How long are the songs?** Under 32 bars, way 1 is enough. Real verse-chorus-verse songs are
  usually longer.
- **Is a repeat a copy or a reference?** If you change the chorus, should both choruses change?
- **In a jam,** does everyone share one song order, or can one person play a section while another
  edits the next?
- **Should old songs open unchanged?** I'd say yes, as one section with no name.

## What I'd do first

**Way 1, in two small steps**, each useful on its own:

1. Named section markers on the bar strip, with "copy this section to bars N–M". No new playback,
   and nothing changes in song files except a list of names.
2. Lay a progression across a section rather than the whole loop. That is the chorus, and the
   twelve-bar blues falls out of it.

If 32 bars turns out to be the wall people hit, way 2 is the destination, and way 1's names carry
across to it.
