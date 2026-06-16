// Tiny external store for The Circuit. React subscribes via useSyncExternalStore;
// mutations update local state optimistically, then persist through whatever adapter
// was supplied to init() — localStorage when signed out, Supabase + realtime when in.
import { useSyncExternalStore } from 'react'
import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog, Movie, Person, WatchlistItem, ID } from './types'
import { emptyCircuitState } from './types'

export interface CircuitStore {
  init(adapter: CircuitAdapter): Promise<void>
  getState(): CircuitState
  subscribe(listener: () => void): () => void
  savePerson(p: Person): Promise<void>
  deletePerson(id: ID): Promise<void>
  saveLog(log: DayLog): Promise<void>
  deleteLog(id: ID): Promise<void>
  saveMovie(m: Movie): Promise<void>
  deleteMovie(id: ID): Promise<void>
  saveWatchlist(w: WatchlistItem): Promise<void>
  deleteWatchlist(id: ID): Promise<void>
}

function upsert<T extends { id: ID }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i === -1) return [...arr, item]
  const next = arr.slice()
  next[i] = item
  return next
}
const removeById = <T extends { id: ID }>(arr: T[], id: ID): T[] => arr.filter((x) => x.id !== id)

export function createCircuitStore(): CircuitStore {
  let state: CircuitState = emptyCircuitState()
  let adapter: CircuitAdapter | null = null
  let unsub: (() => void) | null = null
  const listeners = new Set<() => void>()

  const emit = () => listeners.forEach((l) => l())
  const set = (next: CircuitState) => {
    state = next
    emit()
  }
  const need = (): CircuitAdapter => {
    if (!adapter) throw new Error('circuit store not initialized')
    return adapter
  }
  const apply = (next: CircuitState, persist: () => Promise<void>): Promise<void> => {
    set(next)
    return persist().catch((err) => {
      console.error('[circuit] persist failed', err)
    })
  }

  return {
    async init(a) {
      if (adapter === a) return
      if (unsub) {
        unsub()
        unsub = null
      }
      adapter = a
      set(await a.load())
      unsub = a.subscribe((external) => set(external))
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    savePerson: (p) =>
      apply({ ...state, people: upsert(state.people, p) }, () => need().savePerson(p)),
    deletePerson: (id) =>
      apply({ ...state, people: removeById(state.people, id) }, () => need().deletePerson(id)),
    saveLog: (log) => apply({ ...state, logs: upsert(state.logs, log) }, () => need().saveLog(log)),
    deleteLog: (id) =>
      apply({ ...state, logs: removeById(state.logs, id) }, () => need().deleteLog(id)),
    saveMovie: (m) =>
      apply({ ...state, movies: upsert(state.movies, m) }, () => need().saveMovie(m)),
    deleteMovie: (id) =>
      apply({ ...state, movies: removeById(state.movies, id) }, () => need().deleteMovie(id)),
    saveWatchlist: (w) =>
      apply({ ...state, watchlist: upsert(state.watchlist, w) }, () => need().saveWatchlist(w)),
    deleteWatchlist: (id) =>
      apply({ ...state, watchlist: removeById(state.watchlist, id) }, () =>
        need().deleteWatchlist(id),
      ),
  }
}

/** App-wide singleton. Call connectCircuit() (see connect.ts) to wire an adapter. */
export const circuitStore = createCircuitStore()

/** React hook: re-renders on any Circuit state change. */
export function useCircuit(): CircuitState {
  return useSyncExternalStore(circuitStore.subscribe, circuitStore.getState)
}
