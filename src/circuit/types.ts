// The Circuit — domain model.
// Mirrors the standalone app's data so the port is faithful, and is shaped so the
// localStorage adapter today and a Supabase adapter later can both satisfy it.

export type ID = string

/**
 * Who can see a thing. One vocabulary shared by circuit boards, chat rooms and Snake
 * handles, matching the `visibility_tier` enum in Postgres. Circuit group sharing is a
 * separate mechanism layered on top — see docs/visibility-tiers-design.md.
 */
export type VisibilityTier = 'private' | 'friends' | 'members' | 'public'

/** A participant in the shared Circuit. */
export interface Person {
  id: ID
  name: string
  color: string
  /** Daily points goal; defaults to 100 if unset. */
  goal?: number
  /** Per-person exercise grid (column/row coords mirror the standalone layout). */
  exercises: Exercise[]
  /** Column header labels for this person's grid. */
  colLabels: string[]
  /** Auth user who owns this Circuit (server-set; null/undefined = unclaimed). Read-only
   *  on the client — changed only via the claim_person RPC, never written by savePerson. */
  ownerUserId?: string | null
  /** Who can see this Circuit — replaced the old is_public boolean. Server-set; changed
   *  only via set_person_visibility, never written by savePerson (same as ownerUserId). */
  visibility?: VisibilityTier
  /** Circuits (group ids) this person is shared into. Server-loaded; used to scope the
   *  board to one circuit. Empty/undefined in the signed-out demo. */
  groupIds?: ID[]
}

/** A circuit (group) the signed-in user belongs to — used by the board's circuit picker. */
export interface CircuitGroup {
  id: ID
  name: string
}

export interface Exercise {
  id: ID
  name: string
  /** reps | min | sec | mi | km | hr | other */
  unit: string
  /** points = raw value × mult */
  mult: number
  cat?: string
  tags?: string[]
  /** grid position */
  col: number
  row: number
}

export interface LogEntry {
  /** exercise id, or "__total__" for an imported day with no per-exercise breakdown */
  eid: ID
  val: number
}

export interface DayLog {
  id: ID
  personId: ID
  /** ISO date "YYYY-MM-DD" */
  date: string
  entries: LogEntry[]
  /** optional workout photo (data URL locally; storage URL once on Supabase) */
  img?: string | null
}

export interface MovieReview {
  /** 0–4 sentiment index (really bad → loved it) */
  sentiment?: number | null
  /** 0–3 rewatch index (never → forever) */
  rewatch?: number | null
  /** recommend: yes | no | maybe */
  rec?: 'y' | 'n' | 'm' | null
  /** "tip of the cap" votes: soundtrack | plot | cinema | babes */
  tips?: string[]
  tags?: string[]
  note?: string
}

export interface MovieRating {
  /** 0–100, or null if unrated */
  score: number | null
  /** decorative "vibes" icon ids */
  icons?: string[]
  review?: MovieReview | null
}

export interface Movie {
  id: ID
  title: string
  /** review category — 'movie' (default/legacy), 'food', 'beer', 'restaurant', … */
  kind?: string
  /** ISO date experienced */
  date?: string
  /** Rotten Tomatoes string, e.g. "94%" — movie-only */
  rt?: string
  /** per-person ratings, keyed by Person.id (becomes a join table on Supabase) */
  ratings: Record<ID, MovieRating>
  /** Circuit (group) this film belongs to; server-set/preserved. New ones default to the
   *  member's circuit via a DB trigger. Undefined in the signed-out demo. */
  groupId?: string | null
}

/**
 * Who a pool is for.
 *
 * ⚠️ NOT a VisibilityTier, on purpose. That vocabulary runs private → friends → members →
 * public, and a pool has no business being visible to "anyone with an account" or to the open
 * internet: it is four people deciding where to eat. The two overlapping-but-different values
 * would be a standing invitation to pass one where the other was meant.
 */
export type PoolAudience = 'just_me' | 'friends' | 'selected'

/**
 * A pool: a named set of options, and the people it is shared with.
 *
 * ⚠️ THIS REPLACED CIRCUIT GATING. A pool used to be "the watchlist rows tagged with this
 * circuit id", so sharing one with two friends meant first creating a fitness board and getting
 * them to join it — an audience mechanism inherited from the thing the feature was built beside
 * rather than chosen for it. `name` and `people` live server-side; `people` is loaded only for
 * pools you can see, and only ever holds people you could already reach.
 */
export interface Pool {
  id: ID
  name: string
  audience: PoolAudience
  /** the account that made it — only they can rename it, re-aim it or delete it */
  ownerUserId?: string | null
}

/**
 * One person being up for one option.
 *
 * ⚠️ A ROW, not an entry in an array on the option. `WatchlistItem.votes` was a jsonb array
 * rewritten whole on every tap, so two people voting at the same moment meant the second write
 * erased the first — in a feature whose entire point is several people acting at once. The id
 * is synthetic (`item::user`) purely so a vote fits the store's by-id model; the server's
 * primary key is the pair itself.
 */
export interface PoolVote {
  id: ID
  itemId: ID
  userId: string
}

export const voteId = (itemId: ID, userId: string): ID => `${itemId}::${userId}`

export interface WatchlistItem {
  id: ID
  title: string
  rt?: string
  /** what kind of thing this pool holds (movie, food, game…) — see reviewKinds */
  kind?: string
  /** The pool this option is in. */
  poolId?: string | null
  /** Legacy circuit tag, kept for anything not yet moved into a pool (see Movie.groupId). */
  groupId?: string | null
}

export interface CircuitState {
  people: Person[]
  logs: DayLog[]
  movies: Movie[]
  watchlist: WatchlistItem[]
  /** Circuits the signed-in user belongs to (server-loaded). Empty in the demo. */
  groups?: CircuitGroup[]
  /** Pools you own or are in. Optional so older cached boards deserialise unchanged. */
  pools?: Pool[]
  votes?: PoolVote[]
}

export const emptyCircuitState = (): CircuitState => ({
  people: [],
  logs: [],
  movies: [],
  watchlist: [],
  groups: [],
  pools: [],
  votes: [],
})
