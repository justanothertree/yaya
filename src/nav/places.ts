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
 * left/right arrow keys. It reads outward: home, then the rooms built for the group, then the
 * things anybody can play with on their own, then how to reach me. (The group rooms are not all
 * members-only any more — see the Circuit — but they are still the ones that are ABOUT a group,
 * which is what the grouping was ever for.)
 */
export const PLACES = [
  { id: 'home', label: 'Home', icon: '🏠', title: 'Home', nav: () => true },
  /**
   * ⚠️ OPEN TO EVERYBODY, because they always were — the nav was the only thing pretending
   * otherwise. Both rooms already rendered for a signed-out visitor who typed the hash: Circuit
   * wires a localStorage sandbox seeded from publicSeed and passes `demo={!authed}`, Ratings
   * reads the same store, and DemoBanner has been sitting there the whole time explaining that
   * edits live only in this browser. Hiding the LINK did not hide anything; it only meant the one
   * part of the site with a proper public demo was the part nobody could find.
   *
   * ⚠️ Nothing about what leaves the database changes here. The public board comes from
   * circuit_public, which is already one of the handful of anon-callable functions and returns
   * only what a member has chosen to make public. People and Chat stay members-only, because
   * those are other people's names and other people's messages.
   */
  { id: 'circuit', label: 'Circuit', icon: '🏆', title: 'The Circuit', nav: () => true },
  { id: 'ratings', label: 'Ratings', icon: '⭐', title: 'Ratings', nav: () => true },
  { id: 'chat', label: 'Chat', icon: '💬', title: 'Chat', nav: member },
  { id: 'people', label: 'People', icon: '🧑‍🤝‍🧑', title: 'People', nav: member },
  {
    id: 'investments',
    label: 'Investments',
    icon: '📈',
    title: 'Investments',
    /**
     * ⚠️ SIGNED OUT SEES THE SAMPLE; SIGNED IN YOU NEED IT SWITCHED ON.
     *
     * Not `() => true`, and the difference matters. A member without canFinance has nothing
     * behind this tab — the route already bounces them and the canvas pane says "Investments
     * aren't enabled for your account" — so offering it to them is a door onto a wall. A visitor
     * DOES have something behind it: Investments renders `demo`, which returns before any query
     * runs and fills the page from DEMO_PORTFOLIO. Fabricated accounts, a "Sample data" banner,
     * and not one network call — checked, because this is the room about family money and the
     * cost of being wrong here is not a layout bug.
     *
     * ⚠️ It sits with the other rooms that are ABOUT people rather than after Sign in, which
     * is an action rather than a place. Signed out the strip now reads Home, Circuit, Ratings,
     * Investments, Sign in — rooms first, then what to do about them.
     */
    nav: (v) => (v.authed ? member(v) && v.canFinance : true),
  },
  {
    id: 'signin',
    label: 'Sign in',
    icon: '🔑',
    title: 'Sign in',
    nav: (v) => v.financeOn && !v.authed,
  },
  {
    id: 'account-settings',
    label: 'Account',
    icon: '👤',
    title: 'Account settings',
    nav: member,
  },
  { id: 'admin', label: 'Admin', icon: '🛠', title: 'Admin', nav: (v) => v.isAdmin },
  /* ⚠️ Snake is one of the things in here now, not the whole of it — see GamesRoom, and see
     SECTION_ALIASES below for why `#snake` did not stop meaning anything when this was renamed. */
  { id: 'games', label: 'Games', icon: '🎮', title: 'Games', nav: () => true },
  { id: 'visualizer', label: 'Visualiser', icon: '🎚️', title: 'Visualiser', nav: () => true },
  { id: 'instrument', label: 'Instrument', icon: '🎹', title: 'Instrument', nav: () => true },
  { id: 'paint', label: 'Paint', icon: '🎨', title: 'Paint', nav: () => true },
  /* ⚠️ Beside Paint, because that is where its pets come from — every pet in here is a drawing
     somebody kept, and the first thing the room tells you to do is go and name its layers. */
  { id: 'pets', label: 'Pets', icon: '🐾', title: 'Pets', nav: () => true },
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

/**
 * Routes that are no longer places, and what they mean now.
 *
 * ⚠️ A ROUTE SOMEBODY WAS SENT IS PERMANENT. `#snake?room=…` links were built by
 * `challengeLink` and posted into chat, so they are sitting in the database inside messages that
 * were written months ago and cannot be rewritten. Renaming the Snake tab to Games renames a
 * PLACE, which is free; renaming a LINK is only free when nobody kept one, and here eight people
 * did. So `#snake` keeps working, keeps its query, and lands on the games room with Snake
 * already open — which is exactly what it always did.
 */
export const SECTION_ALIASES: Record<string, Section> = { snake: 'games' }

/**
 * The section a hash names. One answer, for the first load and for every hashchange after it.
 *
 * ⚠️ THIS WAS TWO FUNCTIONS AND THEY DISAGREED. Only the hashchange parser knew that
 * `#circuit?tab=chat` means Chat (chat used to be a Circuit tab), so the rule applied when you
 * navigated to such a link from inside the site and not when you ARRIVED on one — which is the
 * case an old link in somebody's messages is actually going to hit. Two copies of a routing rule
 * is the same failure this file was written to stop; it had simply grown a second home.
 */
export function sectionOf(hash: string): Section {
  const raw = (hash || '#home').replace(/^#/, '')
  const [base, query] = raw.split('?')
  const id = base || 'home'
  if (id === 'circuit' && new URLSearchParams(query ?? '').get('tab') === 'chat') return 'chat'
  const alias = SECTION_ALIASES[id]
  if (alias) return alias
  return (ALL_SECTIONS as string[]).includes(id) ? (id as Section) : 'home'
}
