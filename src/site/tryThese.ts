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
    line: 'Layers, frames and undo. Two people in it at once are drawing on the same canvas.',
  },
  {
    id: 'visualizer',
    live: 'viz',
    open: 'Put a song on',
    icon: '🎚️',
    title: 'Watch music move',
    line: 'Play a song and the screen moves with it. Mirrors, depth, 3D — I kept adding ways for it to look and saving the ones I liked.',
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
    line: 'The keys at the top are one sound. In here there are more, and a grid you can put notes in and keep.',
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
    line: 'Mine, as a visitor sees it. Everyone builds one out of blocks — a song, a drawing, scores, a guestbook. Add someone from their page and you can message them, call them, or draw and play together.',
  },
  {
    id: 'snake',
    live: 'snake',
    open: 'Play it properly',
    icon: '🎮',
    title: 'Play Snake',
    line: 'This one is playing itself. Tap it to take over. The full version keeps scores and lets people race each other.',
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
    line: 'Rate films and food with the people you watch and eat with. Or throw options in a pool and let the wheel pick one for everybody at once.',
    members: true,
  },
  {
    id: 'chat',
    live: 'calls',
    open: 'Open chat',
    icon: '🎧',
    title: 'Talk and share a screen',
    line: 'Voice and screen share. The call stays up as you move around the site, so you can talk while you draw or play.',
    members: true,
  },
]
