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
   * ⚠️ Costs a visitor nothing: the only live tile so far is canvas 2D and pointer events,
   * both already in the browser. The moment one of these needs a chunk, the front page has become
   * the reason that chunk ships — which is the trap HeroPlay's dynamic import exists to avoid.
   */
  live?: 'scribble'
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
  {
    id: 'instrument',
    icon: '🎹',
    title: 'Play an instrument',
    line: 'Your computer keyboard is the keys. Pick a sound and press something — it shows you the shape of what you played.',
  },
  {
    /**
     * ⚠️ THE ONE ROOM A VISITOR COULD NOT OTHERWISE SEE. Profiles are the point of the site
     * and there was nothing about them on the home page at all — they live behind a sign-in, so
     * the only honest way to show one is the demo: a real profile, served to anybody, which only
     * ever returns the single row flagged is_demo and only its public blocks.
     */
    id: 'profile',
    href: '#profile?demo=1',
    /* ⚠️ NOT 🪪. It is an Emoji 14 character and Segoe UI Emoji on Windows 10 has no glyph
       for it, so it rendered as an empty tofu box — blown up to fill the corner by .hag-bleed.
       Check a new icon actually draws before trusting it. */
    icon: '🧑',
    title: 'Have a look at a page',
    line: "Everyone here gets one — your theme, your music, your scores, whatever you pin to it. This one's mine.",
  },
  {
    id: 'visualizer',
    icon: '🎚️',
    title: 'Watch music move',
    line: 'Put a song on and the screen moves with it. Dozens of looks, some in 3D.',
  },
  {
    /**
     * ⚠️ THE PAD IS THE POINT, so the sentence stops describing what drawing is like. It sits
     * in a wide slot rather than a narrow one because a third of a row is not enough surface to
     * want to drag across — which is the entire behaviour being invited.
     */
    id: 'paint',
    live: 'scribble',
    icon: '🎨',
    title: 'Draw something',
    line: 'Layers, frames, and friends drawing on the same page as you.',
  },
  {
    id: 'snake',
    icon: '🎮',
    title: 'Play Snake',
    line: 'The one you remember, with a scoreboard — and other people in it if anybody else is around.',
  },
  {
    id: 'circuit',
    icon: '🏆',
    title: 'Score your day',
    line: 'The workout board my friends and I have used daily for a year. Log it, total it, argue about it.',
    members: true,
  },
  {
    id: 'ratings',
    icon: '⭐',
    title: 'Decide together',
    line: 'Rate films and food, or throw options in a pool and let the wheel choose for everyone at once.',
    members: true,
  },
  {
    id: 'chat',
    icon: '🎧',
    title: 'Call your people',
    line: 'Talk and share your screen, and the call follows you around the site while you draw or play.',
    members: true,
  },
]
