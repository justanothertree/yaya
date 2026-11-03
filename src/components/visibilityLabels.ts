import type { VisibilityTier } from '../circuit/types'

/**
 * Plain-language names for the visibility tiers, and what each one means in practice.
 *
 * Separate from VisibilityPicker.tsx so that file only exports a component — mixing
 * components and constants in one module breaks fast refresh.
 *
 * The database names (private/friends/members/public) are never shown to anyone. Nobody
 * should have to guess whether "members" includes a stranger who signed up this morning.
 */

export const TIER_LABEL: Record<VisibilityTier, string> = {
  private: 'Only me',
  /* "Certain friends" rather than "Some friends" or "A few friends": the choosing is the whole
     point of the level, and the word has to survive sitting next to "Friends" without reading as
     a vaguer version of it. */
  certain: 'Certain friends',
  friends: 'Friends',
  members: 'Anyone with an account',
  public: 'Anyone',
}

/**
 * The same four levels in one word each, for the places the long names cannot go.
 *
 * ⚠️ TWO MAPS IS NOT DUPLICATION HERE, AND COLLAPSING THEM BREAKS A SENTENCE. `TIER_LABEL` is
 * written for a PICKER, where "Anyone with an account" has to be unambiguous on its own because
 * somebody is choosing it. These are written for PROSE and for buttons sitting in a row, where
 * that phrase does not fit and does not parse: the profile's "view as" row builds
 * `Only what ${…toLowerCase()} are sent`, which reads "Only what members are sent" and would
 * become "Only what anyone with an account are sent".
 *
 * They lived as two identical literals inside `Profile.tsx` and `ProfileBlocks.tsx`, each with a
 * note saying they were kept local to avoid exporting a constant from a module full of
 * components. That reason is real and this file is the answer to it, so the words live here and
 * the components import them.
 *
 * ⚠️ THE KEY ORDER USED TO BE LOAD-BEARING AND IS NOT ANY MORE. Two controls built themselves
 * by iterating this map with `Object.keys` — the profile header's activity dropdown and the
 * block editor's audience select — so its insertion order WAS the order of two things on screen,
 * in a sequence (public, friends, members, private) that is not the ladder's. Both are
 * `VisibilityPicker` now, which orders itself from `TIER_ORDER` and knows about the ceiling, so
 * this map is words only. The order below is the ladder's, for anybody who iterates it anyway.
 */
export const TIER_SHORT: Record<VisibilityTier, string> = {
  private: 'Only me',
  certain: 'Certain friends',
  friends: 'Friends',
  members: 'Members',
  public: 'Anyone',
}

/**
 * closed -> open, so moving right always means more people.
 *
 * ⚠️ `certain` SITS BETWEEN `private` AND `friends`, which is the whole reason the list may only
 * name accepted friends. A list holding somebody who is not a friend would make the narrow level
 * reach further than the broad one directly above it, and every comparison built on this order —
 * the ceiling clamp, `tierSees`, the "wider than" warnings — would quietly mean the wrong thing.
 * `visibility_certain_set` and `save_my_profile_blocks` both drop a name that is not a friend.
 */
export const TIER_ORDER: VisibilityTier[] = ['private', 'certain', 'friends', 'members', 'public']

/** How wide a tier reaches, as a position in TIER_ORDER. Bigger means more people. */
export function openness(t: VisibilityTier): number {
  return TIER_ORDER.indexOf(t)
}

/**
 * Which levels a picker may offer, given the account's ceiling and what is stored today.
 *
 * Pure so it can be asked a question without a browser, which matters more here than usual:
 * the preview harness has no session, so `my_visibility_ceiling` answers nothing there and the
 * Browser pane cannot show a narrowed picker at all. A test is the only thing that can.
 *
 * `undefined` ceiling means not known yet, and the answer is the whole ladder — the caller is
 * expected to hold the options disabled meanwhile rather than treat it as "no limit".
 *
 * ⚠️ THE STORED VALUE IS ALWAYS OFFERED, EVEN ABOVE THE CEILING. Rows like that exist: a tier
 * chosen before the ceiling applied is still in the database, held back by the read clamp rather
 * than rewritten. Dropping it would leave the control with nothing selected, which reads as a
 * broken picker rather than as a setting about to change.
 *
 * ⚠️ AND `omit` IS FOR LEVELS THE SURFACE ITSELF CANNOT TAKE, which is a different question from
 * the ceiling. A chronicle activity is capped at `friends` by a CHECK on its own table; a
 * chronicle BLOCK cannot be `public` because `get_member_chronicle` refuses an unauthenticated
 * caller, so that tier would read as the open internet and behave as members; a snake handle has
 * no `certain` because one setter moves every handle together and there is no single item to
 * hang a list on. Each of those used to be a hand-written `.filter()` at its own call site —
 * this is the same rule in one place, and it obeys the same exception: a stored value is always
 * offered, because a row that already holds it exists and a picker with nothing selected reads
 * as broken.
 */
export function offeredTiers(
  ceiling: VisibilityTier | undefined,
  value: VisibilityTier,
  omit: VisibilityTier[] = [],
): VisibilityTier[] {
  const allowed = TIER_ORDER.filter((t) => !omit.includes(t) || t === value)
  if (ceiling === undefined) return allowed
  return allowed.filter((t) => openness(t) <= openness(ceiling) || t === value)
}

/** Is what is stored wider than this account is allowed to choose? */
export function isOverCeiling(ceiling: VisibilityTier | undefined, value: VisibilityTier): boolean {
  return ceiling !== undefined && openness(value) > openness(ceiling)
}

/**
 * Circuit sharing and the tier are two different mechanisms, and reading only the tier
 * makes people think "Friends" hides them from a crewmate who isn't a friend. It doesn't.
 * Stating it once, always visible, beats hedging it inside all four hints.
 */
export const CIRCUIT_ALWAYS =
  'People in your circuits always see your board there. This setting is about everyone else.'

/**
 * Which surface the hints are written for.
 *
 * ⚠️ FIVE SETS OF WORDS RATHER THAN ONE, because "Friends" means a different thing on each of
 * these and the sentence underneath is what says which. On a circuit board it is a caveat (your
 * crewmates see it regardless); on a chronicle activity it is the widest level there is; on your
 * activity stream it governs five modules at once. One generic line would have to be vague
 * enough to be true everywhere, and a vague privacy hint is worse than none.
 */
export type HintKind = 'circuit' | 'snake' | 'block' | 'activity' | 'chronicle'

export const TIER_HINTS: Record<HintKind, Record<VisibilityTier, string>> = {
  circuit: {
    private: 'Nobody outside your circuits — your board stays off the public site.',
    certain: 'Only the friends you pick below. Not your other friends, and nobody else.',
    friends: 'Also friends you’ve added. A friend request doesn’t count until it’s accepted.',
    members: 'Also everyone else with an account on the site, friend or not.',
    public:
      'Also anyone at all, including people who aren’t signed in — this puts you on the public board.',
  },
  /* A thing on your page. "Anyone" deliberately does not promise the open internet here: it does
     that only once the page itself is published, which the editor says underneath. */
  block: {
    private: 'Nobody but you. It still shows while you’re arranging the page.',
    certain: 'Only the friends you pick below — not your other friends.',
    friends: 'Friends you’ve added. A request doesn’t count until it’s accepted.',
    members: 'Anyone signed in to the site, friend or not.',
    public: 'Anyone at all, if your page is published in Account.',
  },
  /* The whole activity stream: circuits, ratings, snake scores, trophies and achievements. */
  activity: {
    private: 'Nobody. Your profile shows your name and nothing you’ve been doing.',
    certain: 'Only the friends you pick below get your activity.',
    friends: 'Friends you’ve added see what you’ve been up to.',
    members: 'Anyone signed in can see your activity.',
    public: 'Anyone at all, if your page is published in Account.',
  },
  /* An activity or a goal in Chronicle. Capped at friends by the table itself — a day-by-day
     record of somebody's time is not a members-tier thing, and the picker omits the two wider
     levels rather than offering a choice the save would narrow. */
  chronicle: {
    private: 'Yours alone. It stays out of the feed and off your profile.',
    certain: 'Only the friends you pick below see these sittings.',
    friends: 'Friends you’ve added see these sittings in the feed and on your page.',
    members: 'Not offered here — Chronicle stops at friends.',
    public: 'Not offered here — Chronicle stops at friends.',
  },
  // No real names in example copy, ever — not even as illustration. This file ships in a
  // public repo and renders on a page other members read.
  /**
   * ⚠️ `public` NO LONGER PROMISES SIGNED-OUT, because the code never delivered it.
   * `snake_friend_names` is the only thing that puts a member's name beside a handle, and its
   * first condition is `auth.uid() is not null` — so a signed-out visitor sees handles and
   * scores and never a name, whatever tier is set. The old wording said "signed in or not",
   * which is a privacy control claiming to be WIDER than it is: somebody reading it would think
   * they had published their name to the open web and might set it narrower in alarm, or trust
   * it and be wrong about which way.
   *
   * Narrowed the copy rather than widening the code, deliberately. The behaviour is the safe one
   * and nobody has asked for signed-out names; only the sentence was wrong.
   */
  /**
   * ⚠️ `certain` IS NOT OFFERED FOR A HANDLE, and the reason is the setter rather than the copy.
   * `set_my_snake_visibility` moves EVERY handle you have claimed to one level in a single
   * write — there is no per-handle control — so there is no single item for a list to belong to.
   * Pickers pass `omit={['certain']}` here. The words are present because the map must cover the
   * ladder, and because a handle stored at `certain` from somewhere else would otherwise render
   * a blank hint.
   */
  snake: {
    private: 'Your scores show under the handle you typed, and nobody learns it’s you.',
    certain: 'Chosen friends only — set per handle, which this control cannot do.',
    friends: 'Friends see your name beside the handle. Everyone else sees just the handle.',
    members: 'Anyone signed in can tell these scores are yours.',
    public: 'Anyone signed in sees your name here. Signed-out visitors only ever see the handle.',
  },
}
