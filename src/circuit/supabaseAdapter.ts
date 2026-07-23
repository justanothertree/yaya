// Phase-2 adapter: the Circuit synced through Supabase (members-only tables) + realtime.
// Same CircuitAdapter contract as localAdapter, so the UI is unchanged. Reuses the
// app's existing singleton Supabase client (Auth JWT + RLS).
import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog, Movie, MovieRating, Person, WatchlistItem, ID } from './types'
import { getSupabaseClient } from '../finance/client'

const TABLES = ['circuit_people', 'circuit_logs', 'circuit_movies', 'circuit_watchlist'] as const

// Last cloud snapshot, cached locally so a returning member's board paints instantly on
// mount instead of sitting empty (or flashing the demo) while the network load runs.
// The fresh board follows moments later through the same channel realtime updates use.
const CLOUD_CACHE_KEY = 'circuit_cloud_cache_v1'
function readCloudCache(): CircuitState | null {
  try {
    const raw = localStorage.getItem(CLOUD_CACHE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as CircuitState
    // a corrupt/outdated snapshot must never crash the board — validate the shape
    // the renderers rely on, else discard and load fresh
    const ok =
      Array.isArray(s.people) &&
      Array.isArray(s.logs) &&
      Array.isArray(s.movies) &&
      Array.isArray(s.watchlist) &&
      s.logs.every((l) => Array.isArray(l.entries))
    if (!ok) {
      localStorage.removeItem(CLOUD_CACHE_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}
function writeCloudCache(s: CircuitState) {
  try {
    localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(s))
  } catch {
    /* quota — the cache is an optimization, never required */
  }
}
/** Wipe the snapshot (called on sign-out so the next user/session starts clean). */
export function clearCloudCache() {
  try {
    localStorage.removeItem(CLOUD_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

type PersonRow = {
  id: string
  name: string
  color: string | null
  goal: number | null
  exercises: Person['exercises']
  col_labels: string[]
  owner_user_id?: string | null
  is_public?: boolean | null
}
type LogRow = {
  id: string
  person_id: string
  date: string
  entries: DayLog['entries']
  img: string | null
}
type MovieRow = {
  id: string
  title: string
  kind?: string | null
  date: string | null
  rt: string | null
  ratings: Record<string, MovieRating>
  group_id?: string | null
}
type WlRow = {
  id: string
  title: string
  rt: string | null
  votes: string[]
  group_id?: string | null
}

const personToRow = (p: Person): PersonRow => ({
  id: p.id,
  name: p.name,
  color: p.color,
  goal: p.goal ?? 100,
  exercises: p.exercises,
  col_labels: p.colLabels,
  // Send the owner back unchanged so an owner's upsert passes the ownership INSERT check
  // under the Phase-C policies. It's loaded from the DB, and the WITH CHECK forbids setting
  // it to anyone but yourself, so this can't transfer/steal ownership.
  owner_user_id: p.ownerUserId ?? null,
})
const rowToPerson = (r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  color: r.color ?? '#888',
  goal: r.goal ?? 100,
  exercises: r.exercises ?? [],
  colLabels: r.col_labels ?? [],
  ownerUserId: r.owner_user_id ?? null,
  isPublic: r.is_public ?? false,
})
// NB: personToRow omits is_public — that's changed only through set_person_public, so a
// normal edit-save never reverts a public-board toggle.
const logToRow = (l: DayLog): LogRow => ({
  id: l.id,
  person_id: l.personId,
  date: l.date,
  entries: l.entries,
  img: l.img ?? null,
})
const rowToLog = (r: LogRow): DayLog => ({
  id: r.id,
  personId: r.person_id,
  date: typeof r.date === 'string' ? r.date.slice(0, 10) : r.date,
  entries: r.entries ?? [],
  img: r.img,
})
const movieToRow = (m: Movie): MovieRow => ({
  id: m.id,
  title: m.title,
  kind: m.kind ?? 'movie',
  date: m.date ?? null,
  rt: m.rt ?? null,
  ratings: m.ratings,
  // preserve an existing film's circuit; new films send null and a DB trigger scopes them
  group_id: m.groupId ?? null,
})
const rowToMovie = (r: MovieRow): Movie => ({
  id: r.id,
  title: r.title,
  kind: r.kind ?? 'movie',
  date: r.date ?? undefined,
  rt: r.rt ?? undefined,
  ratings: r.ratings ?? {},
  groupId: r.group_id ?? null,
})
const wlToRow = (w: WatchlistItem): WlRow => ({
  id: w.id,
  title: w.title,
  rt: w.rt ?? null,
  votes: w.votes ?? [],
  group_id: w.groupId ?? null,
})
const rowToWl = (r: WlRow): WatchlistItem => ({
  id: r.id,
  title: r.title,
  rt: r.rt ?? undefined,
  votes: r.votes ?? [],
  groupId: r.group_id ?? null,
})

export function createSupabaseAdapter(): CircuitAdapter {
  const sb = getSupabaseClient()

  async function loadAll(): Promise<CircuitState> {
    const [ppl, logs, movies, wl, pgroups, groups] = await Promise.all([
      sb.from('circuit_people').select('*'),
      sb.from('circuit_logs').select('*'),
      sb.from('circuit_movies').select('*'),
      sb.from('circuit_watchlist').select('*'),
      sb.from('circuit_person_groups').select('person_id, group_id'),
      sb.from('circuit_groups').select('id, name'),
    ])
    // which circuit(s) each person is shared into — lets the board scope to one circuit
    const byPerson: Record<string, string[]> = {}
    for (const r of (pgroups.data as { person_id: string; group_id: string }[] | null) ?? []) {
      ;(byPerson[r.person_id] ||= []).push(r.group_id)
    }
    return {
      people: ((ppl.data as PersonRow[] | null) ?? []).map((r) => ({
        ...rowToPerson(r),
        groupIds: byPerson[r.id] ?? [],
      })),
      logs: ((logs.data as LogRow[] | null) ?? []).map(rowToLog),
      movies: ((movies.data as MovieRow[] | null) ?? []).map(rowToMovie),
      watchlist: ((wl.data as WlRow[] | null) ?? []).map(rowToWl),
      groups: ((groups.data as { id: string; name: string }[] | null) ?? []).map((g) => ({
        id: g.id,
        name: g.name,
      })),
    }
  }

  // Note: no auto-seeding. The crew's data already lives in the cloud, and under the
  // ownership model (groups + per-person owner_user_id) a new/non-crew member must start
  // empty and create or join a circuit — never inherit someone else's slice.

  // set when the store subscribes; the background refresh delivers the fresh board
  // through the same path a realtime change would
  let emitExternal: ((s: CircuitState) => void) | null = null

  return {
    async load() {
      const cached = readCloudCache()
      if (cached) {
        // serve the snapshot instantly; the fresh board lands like a realtime update
        void loadAll()
          .then((s) => {
            writeCloudCache(s)
            emitExternal?.(s)
          })
          .catch(() => undefined)
        return cached
      }
      const s = await loadAll()
      writeCloudCache(s)
      return s
    },
    async savePerson(p: Person) {
      await sb.from('circuit_people').upsert(personToRow(p))
    },
    async deletePerson(id: ID) {
      await sb.from('circuit_people').delete().eq('id', id)
    },
    async saveLog(l: DayLog) {
      await sb.from('circuit_logs').upsert(logToRow(l))
    },
    async deleteLog(id: ID) {
      await sb.from('circuit_logs').delete().eq('id', id)
    },
    async saveMovie(m: Movie) {
      await sb.from('circuit_movies').upsert(movieToRow(m))
    },
    async deleteMovie(id: ID) {
      await sb.from('circuit_movies').delete().eq('id', id)
    },
    async saveWatchlist(w: WatchlistItem) {
      await sb.from('circuit_watchlist').upsert(wlToRow(w))
    },
    async deleteWatchlist(id: ID) {
      await sb.from('circuit_watchlist').delete().eq('id', id)
    },
    subscribe(onExternalChange) {
      emitExternal = onExternalChange
      const ch = sb.channel('circuit-sync')
      for (const table of TABLES) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          void loadAll().then((s) => {
            writeCloudCache(s) // keep next mount's instant paint current
            onExternalChange(s)
          })
        })
      }
      ch.subscribe()
      return () => {
        emitExternal = null
        void sb.removeChannel(ch)
      }
    },
  }
}
