// The Circuit — domain model.
// Mirrors the standalone app's data so the port is faithful, and is shaped so the
// localStorage adapter today and a Supabase adapter later can both satisfy it.

export type ID = string

/** A participant in the shared Circuit (Josh, Evan, Cam, …). */
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
  /** Whether this person opts into the public board / signed-out demo. */
  isPublic?: boolean
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
  /** ISO date watched */
  date?: string
  /** Rotten Tomatoes string, e.g. "94%" */
  rt?: string
  /** per-person ratings, keyed by Person.id (becomes a join table on Supabase) */
  ratings: Record<ID, MovieRating>
  /** Circuit (group) this film belongs to; server-set/preserved. New ones default to the
   *  member's circuit via a DB trigger. Undefined in the signed-out demo. */
  groupId?: string | null
}

export interface WatchlistItem {
  id: ID
  title: string
  rt?: string
  /** person ids who voted to watch it next */
  votes?: ID[]
  /** Circuit this item belongs to (see Movie.groupId). */
  groupId?: string | null
}

export interface CircuitState {
  people: Person[]
  logs: DayLog[]
  movies: Movie[]
  watchlist: WatchlistItem[]
  /** Circuits the signed-in user belongs to (server-loaded). Empty in the demo. */
  groups?: CircuitGroup[]
}

export const emptyCircuitState = (): CircuitState => ({
  people: [],
  logs: [],
  movies: [],
  watchlist: [],
  groups: [],
})
