// Shared "which circuit am I viewing" filter. The 👥 picker in the Circuit toolbar sets
// one group id (or '' for all circuits you can see); every tab reads it through these so
// filtering is consistent site-wide, not just on the Board.
import type { Person, Movie, WatchlistItem } from './types'

/** People whose membership includes the viewed circuit (all people when unset). */
export function peopleInGroup(people: Person[], viewGroup: string): Person[] {
  if (!viewGroup) return people
  return people.filter((p) => (p.groupIds ?? []).includes(viewGroup))
}

/** Movies / watchlist items are stamped with a single group_id. */
export function itemsInGroup<T extends { groupId?: string | null }>(
  items: T[],
  viewGroup: string,
): T[] {
  if (!viewGroup) return items
  return items.filter((i) => i.groupId === viewGroup)
}

// convenience re-exports so callers don't repeat the generic
export const moviesInGroup = (m: Movie[], g: string) => itemsInGroup(m, g)
export const watchlistInGroup = (w: WatchlistItem[], g: string) => itemsInGroup(w, g)
