// Phase-1 adapter: persists the whole Circuit state to localStorage and syncs
// across tabs via the `storage` event. Same interface the Supabase adapter will
// implement in Phase 2 — so the UI never changes when we switch.

import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog, Movie, Person, WatchlistItem, ID } from './types'
import { emptyCircuitState } from './types'
import { publicSeed } from './publicSeed'

const KEY = 'circuit_state_v1'
/**
 * Ids of people the visitor created in THIS browser.
 *
 * ⚠️ Without this, refreshPublicBoard couldn't tell "someone the visitor invented in the
 * demo" from "someone who used to be public and isn't any more" — both are simply absent
 * from the live board. It kept both, so a member who turned their board private stayed
 * cached in every browser that had ever loaded the demo while they were public, and no
 * amount of reloading removed them. An explicit list means anyone not on the live board
 * and not created here is dropped, which is also a one-time cleanup for existing caches.
 */
const LOCAL_KEY = 'circuit_local_ids_v1'

function readLocalIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return new Set<string>(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function rememberLocalId(id: ID) {
  try {
    const ids = readLocalIds()
    if (ids.has(id)) return
    ids.add(id)
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...ids]))
  } catch {
    /* quota / private mode — ignore */
  }
}

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

/** Keep the visitor's own tinkering (the 'demo' persona + anything they created locally) but
 *  refresh the public people/logs/movies from the live board, so a stale or blocked first
 *  load self-heals and newly-public Circuits appear without a manual "Reset demo". */
function refreshPublicBoard(cached: CircuitState, live: CircuitState): CircuitState {
  const mine = readLocalIds()
  // The visitor's people: the always-editable demo persona plus anyone they created here.
  // NOT "anything missing from the live board" — that also matches a member who has since
  // made their board private, and keeping them would strand real data in this browser.
  const localPeople = cached.people.filter((p) => p.id === 'demo' || mine.has(p.id))
  const localIds = new Set(localPeople.map((p) => p.id))
  return {
    ...emptyCircuitState(),
    people: [...localPeople, ...live.people.filter((p) => !localIds.has(p.id))],
    logs: [
      ...cached.logs.filter((l) => localIds.has(l.personId)),
      ...live.logs.filter((l) => !localIds.has(l.personId)),
    ],
    movies: live.movies,
    watchlist: live.watchlist,
  }
}

/** `seed` is the first-run sandbox state (signed-out demo). Defaults to the bundled Evan
 *  slice; the home page passes a public-board seed instead. When `liveSeed` is true the seed
 *  came fresh from the live board, so it also refreshes an already-seeded sandbox on load. */
export function createLocalAdapter(seed?: CircuitState, liveSeed = false): CircuitAdapter {
  const firstRun = (): CircuitState =>
    seed ? clone(seed) : { ...emptyCircuitState(), ...clone(publicSeed) }
  const read = (): CircuitState => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return firstRun() // nothing saved yet → seed the sandbox
      const cached = { ...emptyCircuitState(), ...JSON.parse(raw) }
      // refresh the public board over the cache when we have fresh live data; otherwise keep
      // the cache as-is so an offline/blocked fetch never degrades a good board.
      const merged = seed && liveSeed ? refreshPublicBoard(cached, seed) : cached
      // Filtering someone out of the render isn't the same as removing them. If the merge
      // dropped anyone — e.g. a member who has since made their board private — persist the
      // cleaned state so their data actually leaves this browser rather than lingering in
      // localStorage unrendered.
      if (merged !== cached && merged.people.length !== cached.people.length) write(merged)
      // A cache that ended up with nobody in it renders "No one's in this circuit yet" and
      // stays that way, because there's nothing left to merge against. Seen in Firefox,
      // whose cross-site fetch to Supabase is flakier. If we have a seed with people, an
      // empty board is always wrong — reseed rather than show an empty demo forever.
      if (merged.people.length === 0) {
        const fallback = firstRun()
        if (fallback.people.length > 0) return fallback
      }
      return merged
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

    savePerson: (p: Person) =>
      mutate((s) => {
        // Anyone the visitor makes here who isn't part of the seeded board is theirs to
        // keep across reloads. Editing a seeded person (logging for the demo board) is not
        // a claim on them, so it doesn't mark them.
        const seeded = seed?.people ?? publicSeed.people
        if (p.id !== 'demo' && !seeded.some((x) => x.id === p.id)) rememberLocalId(p.id)
        return { ...s, people: upsert(s.people, p) }
      }),
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
