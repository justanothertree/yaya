// Signed-out public board data. The home-page demo seeds its local sandbox from this:
// a dummy "Example" persona to freely tinker with, plus everyone who opted their Circuit
// into the public board (is_public) fetched live via the anon RPC circuit_public(). Movies
// / watchlist stay from the bundled Evan slice so those tabs still have content. Falls back
// to the bundled slice if there's no backend or the fetch fails.
import type { CircuitState, DayLog, Movie, Person, WatchlistItem } from './types'
import { emptyCircuitState } from './types'
import { getSupabaseClient } from '../finance/client'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { todayISO } from './dates'
import { publicSeed } from './publicSeed'

// An obviously-sample person so visitors have something of their own to play with.
const demoPerson: Person = {
  id: 'demo',
  name: 'Example',
  color: '#22cc78',
  goal: 100,
  colLabels: ['Body', 'Cardio'],
  exercises: [
    { id: 'd1', name: 'Pushups', unit: 'reps', mult: 1, cat: 'arms', col: 0, row: 0 },
    { id: 'd2', name: 'Squats', unit: 'reps', mult: 1, cat: 'legs', col: 0, row: 1 },
    { id: 'd3', name: 'Plank', unit: 'min', mult: 10, cat: 'core', col: 0, row: 2 },
    { id: 'd4', name: 'Run', unit: 'mi', mult: 32, cat: 'run', col: 1, row: 0 },
  ],
}
const demoLogs: DayLog[] = [
  {
    id: 'dl1',
    personId: 'demo',
    date: todayISO(),
    entries: [
      { eid: 'd1', val: 40 },
      { eid: 'd4', val: 2 },
    ],
  },
]

type PublicSlice = {
  people?: Person[]
  logs?: DayLog[]
  movies?: Movie[]
  watchlist?: WatchlistItem[]
}

/** The board bundled into the build — demo persona + the last-known public slice. Shown
 *  instantly so the page is never blank while the live board loads (Firefox's cross-site
 *  fetch can be slow), and used as the fallback when there's no backend / the fetch fails. */
export const bundledPublicBoard = (): CircuitState => ({
  ...emptyCircuitState(),
  people: [demoPerson, ...publicSeed.people],
  logs: [...demoLogs, ...publicSeed.logs],
  movies: publicSeed.movies,
  watchlist: publicSeed.watchlist,
})

/** Live public board: demo persona + opted-in public people/logs (+ movies). `live` is true
 *  only when the anon RPC actually returned data, so callers can avoid overwriting a good
 *  cached board with the bundled fallback on a transient/blocked fetch. */
export async function fetchPublicCircuit(): Promise<{ state: CircuitState; live: boolean }> {
  if (!hasFinanceSupabaseEnv()) return { state: bundledPublicBoard(), live: false }
  try {
    const { data, error } = await getSupabaseClient().rpc('circuit_public')
    if (error || !data) return { state: bundledPublicBoard(), live: false }
    const slice = data as PublicSlice
    return {
      state: {
        ...emptyCircuitState(),
        people: [demoPerson, ...(slice.people ?? [])],
        logs: [...demoLogs, ...(slice.logs ?? [])],
        // movies/watchlist now come from the board too (ratings/votes filtered to public people)
        movies: slice.movies ?? publicSeed.movies,
        watchlist: slice.watchlist ?? publicSeed.watchlist,
      },
      live: true,
    }
  } catch {
    return { state: bundledPublicBoard(), live: false }
  }
}
