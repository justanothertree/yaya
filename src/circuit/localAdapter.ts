// Phase-1 adapter: persists the whole Circuit state to localStorage and syncs
// across tabs via the `storage` event. Same interface the Supabase adapter will
// implement in Phase 2 — so the UI never changes when we switch.

import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog, Movie, Person, WatchlistItem, ID } from './types'
import { emptyCircuitState } from './types'
import { publicSeed } from './publicSeed'

const KEY = 'circuit_state_v1'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

function write(state: CircuitState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode — ignore */
  }
}

/** upsert by id into an array, returning a new array */
function upsert<T extends { id: ID }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i === -1) return [...arr, item]
  const next = arr.slice()
  next[i] = item
  return next
}

function removeById<T extends { id: ID }>(arr: T[], id: ID): T[] {
  return arr.filter((x) => x.id !== id)
}

/** `seed` is the first-run sandbox state (signed-out demo). Defaults to the bundled
 *  Evan slice; the home page passes a live public-board seed instead. */
export function createLocalAdapter(seed?: CircuitState): CircuitAdapter {
  const firstRun = (): CircuitState =>
    seed ? clone(seed) : { ...emptyCircuitState(), ...clone(publicSeed) }
  const read = (): CircuitState => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return firstRun() // nothing saved yet → seed the sandbox
      return { ...emptyCircuitState(), ...JSON.parse(raw) }
    } catch {
      return emptyCircuitState()
    }
  }
  const mutate = (fn: (s: CircuitState) => CircuitState) => {
    const next = fn(read())
    write(next)
    return Promise.resolve()
  }

  return {
    load: () => Promise.resolve(read()),

    savePerson: (p: Person) => mutate((s) => ({ ...s, people: upsert(s.people, p) })),
    deletePerson: (id: ID) => mutate((s) => ({ ...s, people: removeById(s.people, id) })),

    saveLog: (log: DayLog) => mutate((s) => ({ ...s, logs: upsert(s.logs, log) })),
    deleteLog: (id: ID) => mutate((s) => ({ ...s, logs: removeById(s.logs, id) })),

    saveMovie: (m: Movie) => mutate((s) => ({ ...s, movies: upsert(s.movies, m) })),
    deleteMovie: (id: ID) => mutate((s) => ({ ...s, movies: removeById(s.movies, id) })),

    saveWatchlist: (w: WatchlistItem) =>
      mutate((s) => ({ ...s, watchlist: upsert(s.watchlist, w) })),
    deleteWatchlist: (id: ID) => mutate((s) => ({ ...s, watchlist: removeById(s.watchlist, id) })),

    subscribe(onExternalChange) {
      const handler = (e: StorageEvent) => {
        if (e.key === KEY) onExternalChange(read())
      }
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    },
  }
}
