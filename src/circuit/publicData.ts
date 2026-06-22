// Signed-out public board data. The home-page demo seeds its local sandbox from this:
// a dummy "Example" persona to freely tinker with, plus everyone who opted their Circuit
// into the public board (is_public) fetched live via the anon RPC circuit_public(). Movies
// / watchlist stay from the bundled Evan slice so those tabs still have content. Falls back
// to the bundled slice if there's no backend or the fetch fails.
import type { CircuitState, DayLog, Person } from './types'
import { emptyCircuitState } from './types'
import { getSupabaseClient } from '../finance/client'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { todayISO } from './dates'
import { publicSeed } from './publicSeed'

// An obviously-sample person so visitors have something of their own to play with.
export const demoPerson: Person = {
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

type PublicSlice = { people?: Person[]; logs?: DayLog[] }

const bundledFallback = (): CircuitState => ({
  ...emptyCircuitState(),
  people: [demoPerson, ...publicSeed.people],
  logs: [...demoLogs, ...publicSeed.logs],
  movies: publicSeed.movies,
  watchlist: publicSeed.watchlist,
})

/** Live public board: demo persona + opted-in public people/logs (+ bundled movies). */
export async function fetchPublicCircuit(): Promise<CircuitState> {
  if (!hasFinanceSupabaseEnv()) return bundledFallback()
  try {
    const { data, error } = await getSupabaseClient().rpc('circuit_public')
    if (error || !data) return bundledFallback()
    const slice = data as PublicSlice
    return {
      ...emptyCircuitState(),
      people: [demoPerson, ...(slice.people ?? [])],
      logs: [...demoLogs, ...(slice.logs ?? [])],
      // movies/watchlist aren't per-person public; keep the bundled slice so those tabs work
      movies: publicSeed.movies,
      watchlist: publicSeed.watchlist,
    }
  } catch {
    return bundledFallback()
  }
}
