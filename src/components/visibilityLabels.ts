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

export const TIER_HINTS: Record<'circuit' | 'snake', Record<VisibilityTier, string>> = {
  circuit: {
    private: 'Nobody else sees this board — though people in your circuits still will.',
    friends: 'Friends you’ve added can see it. Friend requests don’t count until accepted.',
    members: 'Everyone with an account on the site can see it, friend or not.',
    public: 'Shown on the public board to anyone, including people who aren’t signed in.',
  },
  snake: {
    private: 'Your scores show under the name you typed, and nobody learns it’s you.',
    friends: 'Friends see “handle (Josh)”. Everyone else sees just the handle.',
    members: 'Anyone signed in can tell these scores are yours.',
    public: 'Your name shows next to these scores for anyone, signed in or not.',
  },
}
