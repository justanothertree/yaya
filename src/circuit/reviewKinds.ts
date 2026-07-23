// The review system is generic: a review is just a rated thing with a KIND tag. Movies
// were the first kind; food, beer, restaurants, games and more are the same mechanic —
// a title, per-person scores, and the rich rating (sentiment, rec, tags, note). Only the
// external-score field (RT%) and the movie-flavoured "tip of the cap" votes stay movie-only.

export type ReviewKind = { id: string; label: string; plural: string; emoji: string }

export const REVIEW_KINDS: ReviewKind[] = [
  { id: 'movie', label: 'Movie', plural: 'Movies', emoji: '🎬' },
  { id: 'food', label: 'Food', plural: 'Food', emoji: '🍔' },
  { id: 'beer', label: 'Beer', plural: 'Beers', emoji: '🍺' },
  { id: 'restaurant', label: 'Restaurant', plural: 'Restaurants', emoji: '🍽️' },
  { id: 'game', label: 'Game', plural: 'Games', emoji: '🎮' },
  { id: 'other', label: 'Other', plural: 'Other', emoji: '⭐' },
]

const BY_ID = new Map(REVIEW_KINDS.map((k) => [k.id, k]))
// anything unknown (or the legacy undefined) reads as a movie — that's the existing data
export const kindOf = (id?: string | null): ReviewKind =>
  BY_ID.get(id ?? 'movie') ?? REVIEW_KINDS[0]
export const kindEmoji = (id?: string | null): string => kindOf(id).emoji
