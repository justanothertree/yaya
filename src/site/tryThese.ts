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
   * ⚠️ Costs a visitor nothing UNTIL THEY ASK FOR SOMETHING. The ornamental ones are SVG with
   * CSS keyframes and run no script at all; the pad and the snake board have a loop because you can
   * touch them; and the visualiser reads the analyser the synth already publishes — but only once
   * a note has sounded somewhere on the page, and it loads the synth the same way the hero's keys
   * do, on a deliberate press. The moment one of these needs a chunk on RENDER, the front page has
   * become the reason that chunk ships, which is the trap homeSynth.ts exists to avoid.
   *
   * ⚠️ The members-only rooms get ORNAMENT, not a readout. A visitor cannot be shown real
   * circuit scores or a real pool — that is what members-only means — so those tiles carry bars
   * with no numbers and a wheel with no words. Inventing a scoreboard and letting it read as
   * somebody's is worse than a plain rectangle.
   */
  live?: 'scribble' | 'snake' | 'keys' | 'profile' | 'viz' | 'circuit' | 'ratings' | 'calls'
  /**
   * Where this one is shown.
   *
   * ⚠️ 'hero' MEANS IT IS NOT A DEMO OF ITS OWN. The visualiser sat in the grid competing
   * with the hero for the same job — both were "here is a tool, have a go" — and the hero won,
   * so it read as a second-rate repeat of the thing four inches above it. It is not a separate
   * demo at all: it is the other half of one. You press a key, the strings ring, the line plays,
   * and that is what the visualiser does with it. So it sits under the hero, and the grid below
   * is everything the hero is NOT already showing off.
   */
  slot?: 'hero'
  /**
   * Which run of the section this belongs to.
   *
   * ⚠️ EIGHT THINGS IN ONE FLAT GRID IS A LIST, NOT A PAGE. Every demo had the same weight and
   * followed the one before it for no reason a reader could see — which is what "slapped
   * together" means in practice: no argument was being made about the order. Two runs with a line
   * each gives the section a shape, and the split is the actual thesis of the site — things you
   * make on your own, then things that need somebody else.
   */
  group: 'make' | 'together'
  /**
   * The id of the project in work.ts this demo IS.
   *
   * ⚠️ THE SAME THING WAS ON THE PAGE TWICE. Snake and the Circuit each had a live demo up
   * here and a write-up down in Selected work — the same subject in two registers, several
   * screens apart, so the page read as two lists arguing about which one was the real one. The
   * demo is the thing; the write-up is what went into it; they belong together.
   */
  project?: string
  /**
   * Where it actually goes, when that is more than a room name.
   *
   * ⚠️ `id` stays required even with this set, because `id` is what the compiler checks — an
   * invitation still cannot point at a room that does not exist. This only carries the extra bit
   * after it, like the `?demo=1` that makes the profile page show THE demo profile to a stranger.
   */
  href?: string
}

/**
 * What the section is, said once at the top.
 *
 * ⚠️ NOBODY SHOULD MISTAKE THE TASTE FOR THE MEAL. These are small and they work, which is
 * exactly the risk: somebody plays the snake board for a minute, decides they have seen Snake, and
 * never opens the room with the scores and the other people in it. Every demo carries a `preview`
 * tag and a door named after the tab it opens; this is the same thing said in a sentence first.
 */
export const DEMOS_LEAD =
  'Each one is a small live piece of a real room — have a go, then open the proper one.'

/** The runs, in the order the page makes them. */
export const GROUPS: ReadonlyArray<{ id: 'make' | 'together'; title: string; lead: string }> = [
  /**
   * ⚠️ NOT "MAKE SOMETHING" ANY MORE. Snake sits in this run because the board works with no
   * account, which is what the lead says — but you do not MAKE anything playing snake, so the
   * heading and the thing under it disagreed. The run was never about creating; it is about what
   * you can do here, now, by yourself.
   */
  { id: 'make', title: 'On your own', lead: 'No account, no install — these work right here.' },
  /**
   * ⚠️ "The reason the site has accounts at all" was a sentence about the SITE'S plumbing,
   * said to somebody who does not care how it is wired. These rooms are worth opening because of
   * who is in them, so the lead says who.
   */
  {
    id: 'together',
    title: 'With other people',
    lead: 'The rooms my friends and family are actually in, every day.',
  },
]

export const TRY_THESE: Invite[] = [
  /**
   * ⚠️ EVERY LINE FOLLOWS THE HERO'S CAPTION, which is the one on this page that works:
   * "Press one, or drag across them — there are no wrong notes. There is a whole studio of this
   * behind the Instrument tab." Three moves — what to DO with the thing in front of you, why you
   * cannot get it wrong, and where the full version lives. Describing a feature does none of
   * those, which is why the descriptions read as advertising however plainly they were written.
   */
  /**
   * ⚠️ THEY ARE ALL THE SAME WIDTH NOW, and the per-tile setting that decided it is gone.
   * Width was a field on each invitation, so which demo sat beside which was a thing to keep in
   * step by hand — and it went wrong every time the list changed: a half with nothing to pair
   * with sat beside a visible gap, and a full-width one was a 6:1 letterbox on a wide screen.
   * Every demo is a band now, its picture beside its words, so there is no packing to get wrong
   * and adding or removing one cannot strand its neighbour.
   */
  {
    id: 'paint',
    group: 'make',
    live: 'scribble',
    icon: '🎨',
    title: 'Draw something',
    line: 'Drag across it — the ink fades on its own, so there is nothing to ruin. The studio behind it has layers, frames, undo, and room for two people on one canvas.',
  },
  {
    id: 'visualizer',
    slot: 'hero',
    group: 'make',
    live: 'viz',
    icon: '🎚️',
    title: 'Watch music move',
    /* ⚠️ It says "that" because it IS that — the picture is drawn from the analyser the keys
       above are feeding, so the sentence is checkable by pressing one. It had a play button of its
       own and that made the front page two instruments; the grid above is the source now. */
    line: 'Play something above and it draws itself — that is the sound you just made, mirrored. Put a whole song through the visualiser and it does the same to that, with depth and 3D.',
  },
  {
    /**
     * ⚠️ THE ONE ROOM A VISITOR COULD NOT OTHERWISE SEE. Profiles live behind a sign-in, so
     * the only honest way to show one is the demo: a real profile served to anybody, which only
     * ever returns the single row flagged is_demo and only its public blocks.
     */
    id: 'profile',
    group: 'together',
    live: 'profile',
    href: '#profile?demo=1',
    /* ⚠️ NOT 🪪. It is an Emoji 14 character and Segoe UI Emoji on Windows 10 has no glyph
       for it, so it rendered as an empty tofu box, blown up large by the tile art.
       Check a new icon actually draws before trusting it. */
    icon: '🧑',
    title: 'See a profile page',
    line: 'Four of the looks, cycling. Everyone builds a page out of blocks — a song, a drawing, scores, a guestbook — and from somebody’s page you can add them, message them, call them, or draw and play together.',
  },
  {
    id: 'snake',
    /**
     * ⚠️ "MAKE SOMETHING" MEANS "NO ACCOUNT NEEDED", WHICH IS EXACTLY WHAT THIS IS. It sat
     * under "With other people" because the ROOM keeps scores and lets people race each other —
     * but the other run's own lead says "No account, no install — these work right here", and the
     * board below works right here for anybody.
     *
     * ⚠️ It was also the arithmetic. Once the visualiser moved up to the hero, "Make something"
     * had ONE demo in it and this run had five — a heading, a lead and a rule introducing a single
     * tile, which is the lopsided look the runs exist to prevent. What is left over there is the
     * honest set: the things that genuinely cannot work without an account.
     */
    group: 'make',
    project: 'snake',
    live: 'snake',
    icon: '🎮',
    title: 'Play Snake',
    line: 'It is playing itself — tap anywhere and it goes where you pointed. It hands itself back when you stop. The full one keeps scores and lets people race each other.',
  },
  {
    id: 'circuit',
    group: 'together',
    project: 'circuit',
    live: 'circuit',
    icon: '🏆',
    title: 'Log a workout',
    /**
     * ⚠️ IT WAS MEMBERS-ONLY AND IT NEVER NEEDED TO BE, so the one project with a real
     * public sandbox was listed under "No demo for these — you would need an account".
     *
     * Signed out, connectCircuit wires a localStorage adapter seeded from publicSeed — Evan's
     * own slice of the board, generated at build time and deliberately NOT importing seed.ts, so
     * the rest of the group's data never reaches the bundle. Circuit then renders with
     * `demo={!authed}`. You get real numbers to drag about and nothing you do leaves your browser.
     *
     * ⚠️ The pool next door stays members-only, and for a real reason rather than by habit:
     * publicSeed carries people, logs, movies and the watchlist but NO pools, so the one thing
     * that invitation is about — everyone throwing an option in and the wheel picking — would
     * be an empty wheel.
     */
    line: 'The board my friends and I have used every day for a year. Open it and my real numbers are there to mess with — log, total, drag it about. Nothing you do touches ours.',
  },
  {
    id: 'ratings',
    group: 'together',
    live: 'ratings',
    icon: '⭐',
    title: 'Decide what to watch',
    line: 'When nobody can decide, everyone throws an option in a pool and the wheel picks — that is it spinning. Afterwards you rate what you actually watched.',
    members: true,
  },
  {
    id: 'chat',
    group: 'together',
    live: 'calls',
    icon: '🎧',
    title: 'Talk and share a screen',
    line: 'Somebody talking. The call stays up as you move around the site, so it is the same conversation whether you are drawing, playing or looking at the board.',
    members: true,
  },
]
