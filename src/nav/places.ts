/**
 * Every place on this site, declared once.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE PAINT WAS MISSING FROM THE PHONE FOR ITS ENTIRE LIFE. It was in
 * the desktop nav, in the routing table, in the arrow-key order and in the titles map — and
 * absent from the one list nobody thought to update, so the only way to reach it on a phone was
 * to type the URL. Nothing was broken; a fact was simply written down in six places and one copy
 * was wrong.
 *
 * The six were: the Section union, SECTION_TITLES, ALL_SECTIONS for hash validation, navOrder
 * for the arrow keys, a hand-written run of <a> tags in the desktop nav, and MobileNav's own
 * array. Adding a room meant remembering all six, and forgetting one produced a page that half
 * exists — which is worse than one that does not, because it looks finished from wherever you
 * happened to check.
 *
 * Now a room is added here and appears everywhere, or is not added and appears nowhere.
 *
 * ⚠️ `nav` is a QUESTION ABOUT THE VIEWER, not a boolean, because who may see a place is part of
 * what the place IS. Keeping the rule beside the label is what stops the desktop and the phone
 * disagreeing about who gets a link, which is the same bug as Paint wearing a different hat.
 * Routable-but-not-listed pages — an invite you were sent, somebody's profile — answer false.
 */

/** What we know about whoever is looking, as far as the navigation cares. */
export type Viewer = {
  /** the finance/Supabase environment exists at all; without it the members' side is off */
  financeOn: boolean
  /** signed in to the members' side */
  authed: boolean
  suspended: boolean
  isAdmin: boolean
  canFinance: boolean
}

/** the shape each entry must have; the exported `Place` below is the narrowed real thing */
type PlaceShape = {
  id: string
  /** the nav link, and the launcher tile */
  label: string
  /** the launcher tile's glyph */
  icon: string
  /** the browser tab and the page's own heading, where it differs from the nav label */
  title: string
  /** whether this place is offered to this viewer */
  nav: (v: Viewer) => boolean
}

/** signed in, in good standing, on a build that has the members' side at all */
const member = (v: Viewer) => v.financeOn && v.authed && !v.suspended

/**
 * ⚠️ THE ORDER HERE IS THE ORDER EVERYWHERE — the desktop strip, the launcher grid, and the
 * left/right arrow keys. It reads outward: home, then the members' rooms, then the things
 * anybody can play with, then how to reach me.
 */
export const PLACES = [
  { id: 'home', label: 'Home', icon: '🏠', title: 'Home', nav: () => true },
  { id: 'circuit', label: 'Circuit', icon: '🏆', title: 'The Circuit', nav: member },
  { id: 'ratings', label: 'Ratings', icon: '⭐', title: 'Ratings', nav: member },
  { id: 'chat', label: 'Chat', icon: '💬', title: 'Chat', nav: member },
  { id: 'people', label: 'People', icon: '🧑‍🤝‍🧑', title: 'People', nav: member },
  {
    id: 'signin',
    label: 'Sign in',
    icon: '🔑',
    title: 'Sign in',
    nav: (v) => v.financeOn && !v.authed,
  },
  {
    id: 'investments',
    label: 'Investments',
    icon: '📈',
    title: 'Investments',
    nav: (v) => member(v) && v.canFinance,
  },
  {
    id: 'account-settings',
    label: 'Account',
    icon: '👤',
    title: 'Account settings',
    nav: member,
  },
  { id: 'admin', label: 'Admin', icon: '🛠', title: 'Admin', nav: (v) => v.isAdmin },
  { id: 'snake', label: 'Snake', icon: '🎮', title: 'Snake', nav: () => true },
  { id: 'visualizer', label: 'Visualiser', icon: '🎚️', title: 'Visualiser', nav: () => true },
  { id: 'instrument', label: 'Instrument', icon: '🎹', title: 'Instrument', nav: () => true },
  { id: 'paint', label: 'Paint', icon: '🎨', title: 'Paint', nav: () => true },
  { id: 'contact', label: 'Contact', icon: '✉️', title: 'Contact', nav: () => true },

  /**
   * ⚠️ Routable, never listed. You arrive at these from a link somebody sent you or from a name
   * you tapped, so a nav entry would be a door to a room that is empty until you are invited to
   * it. They are HERE rather than in a separate list because hash validation must know them, and
   * a second list of sections is exactly what this file exists to prevent.
   */
  { id: 'invite', label: 'Accept invite', icon: '📨', title: 'Accept invite', nav: () => false },
  { id: 'profile', label: 'Profile', icon: '🪪', title: 'Profile', nav: () => false },
] as const satisfies readonly PlaceShape[]

/**
 * ⚠️ Derived FROM the list rather than declared above it, so `id` keeps its literal type. With a
 * hand-written `id: string` the whole point is lost: every consumer would take a plain string
 * and the compiler would stop objecting to a section that does not exist.
 */
export type Place = (typeof PLACES)[number]

/** Every routable section, derived rather than restated — see the note on `invite` above. */
export type Section = (typeof PLACES)[number]['id']

export const ALL_SECTIONS: Section[] = PLACES.map((p) => p.id)

export const SECTION_TITLES: Record<Section, string> = Object.fromEntries(
  PLACES.map((p) => [p.id, p.title]),
) as Record<Section, string>

/** The places this viewer is offered, in order. Drives both navs and the arrow keys. */
export const navFor = (v: Viewer): readonly Place[] => PLACES.filter((p) => p.nav(v))
