/**
 * The invitation on the home page: a few things you can go and do, in plain words.
 *
 * ⚠️ IT IS A SHORTLIST, NOT AN INDEX, and that is the difference between this and
 * components/WhatsHere.tsx. That card is generated from navFor() and must name every room,
 * because an overview that quietly omits one is worse than none. This is the opposite job:
 * six invitations somebody can act on without reading, chosen rather than enumerated. Adding a
 * room does not belong here automatically, and that is on purpose.
 *
 * ⚠️ `id` is typed as Section, so the compiler refuses an invitation pointing at a room that
 * does not exist. It cannot force a NEW room to be considered here — nothing can — but the
 * failure mode that leaves is "a new room is not advertised", which is recoverable, rather than
 * "a button goes nowhere", which is embarrassing.
 *
 *
 * ⚠️ THE REGISTER IS THE WHOLE POINT, and it is the same sentence for both audiences.
 *
 * The page has to work for somebody deciding whether to interview me and for an aunt who is not
 * sure what a browser is. Those look like opposite demands and are not: "Play a piano — your
 * computer keyboard is the keys" tells her exactly what to do AND tells him I built a synth,
 * where "a digital audio workspace with reactive visuals" tells her nothing and him less than he
 * thinks. Concrete beats impressive, in both directions.
 *
 * So: verbs, second person, no nouns anybody has to decode, and nothing here that is not
 * actually finished and running.
 */
import type { Section } from '../nav/places'

export type Invite = {
  id: Section
  icon: string
  /** what you would DO, as a verb */
  title: string
  /** one sentence, said to a person rather than about a feature */
  line: string
  /** signed-in only — shown to members, hidden from visitors who could not open it anyway */
  members?: boolean
  /**
   * This invitation IS the thing, rather than a description of it.
   *
   * ⚠️ Costs a visitor nothing: no imports, no audio, no data. Six of the eight are SVG with
   * CSS keyframes and run no script at all; only the two you can touch — the scribble pad and the
   * snake board — have a loop. The moment one of these needs a chunk, the front page has become
   * the reason that chunk ships, which is the trap HeroPlay's dynamic import exists to avoid.
   *
   * ⚠️ The members-only rooms get ORNAMENT, not a readout. A visitor cannot be shown real
   * circuit scores or a real pool — that is what members-only means — so those tiles carry bars
   * with no numbers and a wheel with no words. Inventing a scoreboard and letting it read as
   * somebody's is worse than a plain rectangle.
   */
  live?: 'scribble' | 'snake' | 'keys' | 'profile' | 'viz' | 'circuit' | 'ratings' | 'calls'
  /** what the link under a live tile says */
  open?: string
  /**
   * Where it actually goes, when that is more than a room name.
   *
   * ⚠️ `id` stays required even with this set, because `id` is what the compiler checks — an
   * invitation still cannot point at a room that does not exist. This only carries the extra bit
   * after it, like the `?demo=1` that makes the profile page show THE demo profile to a stranger.
   */
  href?: string
}

export const TRY_THESE: Invite[] = [
  /**
   * ⚠️ EVERY LINE FOLLOWS THE HERO'S CAPTION, which is the one on this page that works:
   * "Press one, or drag across them — there are no wrong notes. There is a whole studio of this
   * behind the Instrument tab." Three moves — what to DO with the thing in front of you, why you
   * cannot get it wrong, and where the full version lives. Describing a feature does none of
   * those, which is why the descriptions read as advertising however plainly they were written.
   */
  /**
   * ⚠️ THE ORDER IS THE LAYOUT. Widths run 2,1,1,2 and repeat (see EvanCook), so positions 0
   * and 3 are the wide ones — and the two tiles that NEED width are the pad you drag on and the
   * profile, which has a whole page to show and was unreadable in a third of a row. Reordering is
   * how they get it; there is no per-tile width setting to forget to keep in step.
   */
  {
    id: 'paint',
    live: 'scribble',
    open: 'Open the studio',
    icon: '🎨',
    title: 'Draw something',
    line: 'Drag across it — the ink fades on its own, so there is nothing to ruin. The studio behind it has layers, frames, undo, and room for two people on one canvas.',
  },
  {
    id: 'visualizer',
    live: 'viz',
    open: 'Put a song on',
    icon: '🎚️',
    title: 'Watch music move',
    line: 'That is what it does to a drum loop. Put your own song on in the visualiser and it does it to that — mirrors, depth, 3D, and it keeps the looks you liked.',
  },
  {
    id: 'instrument',
    live: 'keys',
    open: 'Open the studio',
    icon: '🎹',
    /* ⚠️ The hero already HAS playable keys. A second row of keys down here was the same hook
       twice and read as the weaker copy of it, so this tile shows the part the hook does not: the
       editor you write a line in and keep. */
    title: 'Write a tune down',
    line: 'Tap any square to drop a note in — it is all one scale, so nothing you add can clash. The studio has more sounds and keeps what you write.',
  },
  {
    /**
     * ⚠️ THE ONE ROOM A VISITOR COULD NOT OTHERWISE SEE. Profiles live behind a sign-in, so
     * the only honest way to show one is the demo: a real profile served to anybody, which only
     * ever returns the single row flagged is_demo and only its public blocks.
     */
    id: 'profile',
    live: 'profile',
    open: 'See the whole page',
    href: '#profile?demo=1',
    /* ⚠️ NOT 🪪. It is an Emoji 14 character and Segoe UI Emoji on Windows 10 has no glyph
       for it, so it rendered as an empty tofu box — blown up to fill the corner by .hag-bleed.
       Check a new icon actually draws before trusting it. */
    icon: '🧑',
    title: 'See a profile page',
    line: 'Four of the looks, cycling. Everyone builds a page out of blocks — a song, a drawing, scores, a guestbook — and from somebody’s page you can add them, message them, call them, or draw and play together.',
  },
  {
    id: 'snake',
    live: 'snake',
    open: 'Play it properly',
    icon: '🎮',
    title: 'Play Snake',
    line: 'It is playing itself — tap anywhere and it goes where you pointed. It hands itself back when you stop. The full one keeps scores and lets people race each other.',
  },
  {
    id: 'circuit',
    live: 'circuit',
    open: 'Open the board',
    icon: '🏆',
    title: 'Log a workout',
    line: 'The board my friends and I have used every day for a year. Log it, total it, argue about it.',
    members: true,
  },
  {
    id: 'ratings',
    live: 'ratings',
    open: 'Open the pool',
    icon: '⭐',
    title: 'Decide what to watch',
    line: 'When nobody can decide, everyone throws an option in a pool and the wheel picks — that is it spinning. Afterwards you rate what you actually watched.',
    members: true,
  },
  {
    id: 'chat',
    live: 'calls',
    open: 'Open chat',
    icon: '🎧',
    title: 'Talk and share a screen',
    line: 'Somebody talking. The call stays up as you move around the site, so it is the same conversation whether you are drawing, playing or looking at the board.',
    members: true,
  },
]
