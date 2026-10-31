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
  friends: 'Friends',
  members: 'Anyone with an account',
  public: 'Anyone',
}

/** closed -> open, so moving right always means more people */
export const TIER_ORDER: VisibilityTier[] = ['private', 'friends', 'members', 'public']

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
 */
export function offeredTiers(
  ceiling: VisibilityTier | undefined,
  value: VisibilityTier,
): VisibilityTier[] {
  if (ceiling === undefined) return TIER_ORDER
  return TIER_ORDER.filter((t) => openness(t) <= openness(ceiling) || t === value)
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

export const TIER_HINTS: Record<'circuit' | 'snake', Record<VisibilityTier, string>> = {
  circuit: {
    private: 'Nobody outside your circuits — your board stays off the public site.',
    friends: 'Also friends you’ve added. A friend request doesn’t count until it’s accepted.',
    members: 'Also everyone else with an account on the site, friend or not.',
    public:
      'Also anyone at all, including people who aren’t signed in — this puts you on the public board.',
  },
  // No real names in example copy, ever — not even as illustration. This file ships in a
  // public repo and renders on a page other members read.
  snake: {
    private: 'Your scores show under the handle you typed, and nobody learns it’s you.',
    friends: 'Friends see your name beside the handle. Everyone else sees just the handle.',
    members: 'Anyone signed in can tell these scores are yours.',
    public: 'Your name shows next to these scores for anyone, signed in or not.',
  },
}
