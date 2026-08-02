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
  snake: {
    private: 'Your scores show under the name you typed, and nobody learns it’s you.',
    friends: 'Friends see “handle (Josh)”. Everyone else sees just the handle.',
    members: 'Anyone signed in can tell these scores are yours.',
    public: 'Your name shows next to these scores for anyone, signed in or not.',
  },
}
