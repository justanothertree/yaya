// Storage adapter contract. The store talks only to this interface, so swapping
// localStorage (today) for Supabase + realtime (later) is a one-file change.

import type { CircuitState, DayLog, Movie, Person, WatchlistItem, ID } from './types'

export interface CircuitAdapter {
  /** Load the full current state (once, on init). */
  load(): Promise<CircuitState>

  // ---- granular mutations (map cleanly to Supabase row upserts/deletes) ----
  savePerson(person: Person): Promise<void>
  deletePerson(id: ID): Promise<void>

  saveLog(log: DayLog): Promise<void>
  deleteLog(id: ID): Promise<void>

  saveMovie(movie: Movie): Promise<void>
  deleteMovie(id: ID): Promise<void>

  saveWatchlist(item: WatchlistItem): Promise<void>
  deleteWatchlist(id: ID): Promise<void>

  /**
   * Subscribe to changes made elsewhere (other devices/people). The localStorage
   * adapter fires this on cross-tab `storage` events; the Supabase adapter will
   * wire it to realtime. Returns an unsubscribe fn.
   */
  subscribe(onExternalChange: (next: CircuitState) => void): () => void
}
