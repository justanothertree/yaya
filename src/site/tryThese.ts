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
}

export const TRY_THESE: Invite[] = [
  {
    id: 'instrument',
    icon: '🎹',
    title: 'Play an instrument',
    line: 'Your computer keyboard is the keys. Pick a sound and press something — it shows you the shape of what you played.',
  },
  {
    id: 'paint',
    icon: '🎨',
    title: 'Draw something',
    line: 'A paint studio with layers and frames. Friends can draw on the same page at the same time.',
  },
  {
    id: 'visualizer',
    icon: '🎚️',
    title: 'Watch music move',
    line: 'Put a song on and the screen moves with it. Dozens of looks, including a few in 3D — tune one, save it, and pin it to a track on your page.',
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
]
