// Phase-2 adapter: the Circuit synced through Supabase (members-only tables) + realtime.
// Same CircuitAdapter contract as localAdapter, so the UI is unchanged. Reuses the
// app's existing singleton Supabase client (Auth JWT + RLS).
import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog, Movie, MovieRating, Person, WatchlistItem, ID } from './types'
import { getSupabaseClient } from '../finance/client'
import { circuitSeed } from './seed'

const TABLES = ['circuit_people', 'circuit_logs', 'circuit_movies', 'circuit_watchlist'] as const

type PersonRow = {
  id: string
  name: string
  color: string | null
  goal: number | null
  exercises: Person['exercises']
  col_labels: string[]
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
  date: string | null
  rt: string | null
  ratings: Record<string, MovieRating>
}
type WlRow = { id: string; title: string; rt: string | null; votes: string[] }

const personToRow = (p: Person): PersonRow => ({
  id: p.id,
  name: p.name,
  color: p.color,
  goal: p.goal ?? 100,
  exercises: p.exercises,
  col_labels: p.colLabels,
})
const rowToPerson = (r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  color: r.color ?? '#888',
  goal: r.goal ?? 100,
  exercises: r.exercises ?? [],
  colLabels: r.col_labels ?? [],
})
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
  date: m.date ?? null,
  rt: m.rt ?? null,
  ratings: m.ratings,
})
const rowToMovie = (r: MovieRow): Movie => ({
  id: r.id,
  title: r.title,
  date: r.date ?? undefined,
  rt: r.rt ?? undefined,
  ratings: r.ratings ?? {},
})
const wlToRow = (w: WatchlistItem): WlRow => ({
  id: w.id,
  title: w.title,
  rt: w.rt ?? null,
  votes: w.votes ?? [],
})
const rowToWl = (r: WlRow): WatchlistItem => ({
  id: r.id,
  title: r.title,
  rt: r.rt ?? undefined,
  votes: r.votes ?? [],
})

export function createSupabaseAdapter(): CircuitAdapter {
  const sb = getSupabaseClient()

  async function loadAll(): Promise<CircuitState> {
    const [ppl, logs, movies, wl] = await Promise.all([
      sb.from('circuit_people').select('*'),
      sb.from('circuit_logs').select('*'),
      sb.from('circuit_movies').select('*'),
      sb.from('circuit_watchlist').select('*'),
    ])
    return {
      people: ((ppl.data as PersonRow[] | null) ?? []).map(rowToPerson),
      logs: ((logs.data as LogRow[] | null) ?? []).map(rowToLog),
      movies: ((movies.data as MovieRow[] | null) ?? []).map(rowToMovie),
      watchlist: ((wl.data as WlRow[] | null) ?? []).map(rowToWl),
    }
  }

  // first member to open seeds the imported history into the cloud (idempotent: stable ids)
  async function seedIfEmpty(): Promise<void> {
    const { count } = await sb.from('circuit_people').select('id', { count: 'exact', head: true })
    if (count && count > 0) return
    await Promise.all([
      sb.from('circuit_people').upsert(circuitSeed.people.map(personToRow)),
      sb.from('circuit_logs').upsert(circuitSeed.logs.map(logToRow)),
      sb.from('circuit_movies').upsert(circuitSeed.movies.map(movieToRow)),
      sb.from('circuit_watchlist').upsert(circuitSeed.watchlist.map(wlToRow)),
    ])
  }

  return {
    async load() {
      await seedIfEmpty()
      return loadAll()
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
      const ch = sb.channel('circuit-sync')
      for (const table of TABLES) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          void loadAll().then(onExternalChange)
        })
      }
      ch.subscribe()
      return () => {
        void sb.removeChannel(ch)
      }
    },
  }
}
