// The review system is generic: a review is just a rated thing with a KIND tag. Movies
// were the first kind; food, beer, restaurants, games and more are the same mechanic —
// a title, per-person scores, and the rich rating (sentiment, rec, tags, note). Only the
// external-score field (RT%) and the movie-flavoured "tip of the cap" votes stay movie-only.

export type ReviewKind = { id: string; label: string; plural: string; emoji: string }

export const REVIEW_KINDS: ReviewKind[] = [
  { id: 'movie', label: 'Movie', plural: 'Movies', emoji: '🎬' },
  { id: 'food', label: 'Food', plural: 'Food', emoji: '🍔' },
  { id: 'beer', label: 'Beer', plural: 'Beers', emoji: '🍺' },
  { id: 'drink', label: 'Drink', plural: 'Drinks', emoji: '🥤' },
  { id: 'restaurant', label: 'Restaurant', plural: 'Restaurants', emoji: '🍽️' },
  { id: 'game', label: 'Game', plural: 'Games', emoji: '🎮' },
  { id: 'other', label: 'Other', plural: 'Other', emoji: '⭐' },
]

const BY_ID = new Map(REVIEW_KINDS.map((k) => [k.id, k]))

/**
 * Categories are open-ended: the built-ins above are a starting set, not the whole world.
 * Anyone can review a thing under a category of their own ("soda", "hot sauce", "hike"), and
 * it becomes a real category the moment it's used.
 *
 * Note the two different unknowns. A MISSING kind is legacy data from when everything was a
 * movie, so it still reads as one. An unrecognised STRING is somebody's own category, and gets
 * its own label rather than being mislabelled a film.
 */
export const kindOf = (id?: string | null): ReviewKind => {
  const raw = (id ?? '').trim()
  if (!raw) return REVIEW_KINDS[0]
  const known = BY_ID.get(raw)
  if (known) return known
  const label = raw.charAt(0).toUpperCase() + raw.slice(1)
  return { id: raw, label, plural: label, emoji: '⭐' }
}
export const kindEmoji = (id?: string | null): string => kindOf(id).emoji

/** the built-ins plus whatever categories the data actually contains, in a stable order */
export function kindsPresent(ids: Iterable<string>): ReviewKind[] {
  const seen = new Set<string>()
  const out: ReviewKind[] = []
  for (const k of REVIEW_KINDS) {
    seen.add(k.id)
    out.push(k)
  }
  for (const id of ids) {
    const raw = (id ?? '').trim()
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    out.push(kindOf(raw))
  }
  return out
}
