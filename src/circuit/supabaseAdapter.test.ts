import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The adapter's save path for a person linked to an account — the half of §19g(2) that lives in
 * the browser. The Supabase client is a stand-in that records what was asked of it, because the
 * question here is which call the adapter makes and with what, not what the server does with it:
 * supabase/tests/circuit-grid-sessions.sql asks the server.
 */
type Call = { kind: 'rpc' | 'upsert' | 'delete'; name: string; args?: unknown }
const calls: Call[] = []
let rpcAnswer: (
  name: string,
  args: Record<string, unknown>,
) => { data?: unknown; error?: unknown } = () => ({})

const tables: Record<string, unknown[]> = {}
/**
 * Reads that fail, by table or function name. ⚠️ A FAILURE RESOLVES, it does not throw: supabase-js
 * answers a dropped connection, a 5xx or an RLS refusal with `{ data: null, error }`, and this is
 * the error a dropped connection carries (no code at all).
 */
const failing = new Set<string>()
const failure = (name: string) => ({
  data: null,
  error: { code: '', message: `TypeError: Failed to fetch (${name})` },
})
/** while set, every table read waits on it — the fresh board has not landed yet */
let held: Promise<void> | null = null
const fake = {
  from(table: string) {
    return {
      select: async () => {
        if (held) await held
        return failing.has(table) ? failure(table) : { data: tables[table] ?? [], error: null }
      },
      upsert: (row: unknown) => {
        calls.push({ kind: 'upsert', name: table, args: row })
        return Promise.resolve({ error: null })
      },
      /* a thenable narrowed by any number of `.eq()`s, which is PostgREST's shape — deleteRating and
         deleteVote name two columns, and a stand-in that allowed one would throw for them */
      delete: () => {
        const where: Record<string, string> = {}
        const q = {
          eq(col: string, v: string) {
            where[col] = v
            return q
          },
          then<T>(res: (a: { error: null }) => T, rej?: (e: unknown) => T) {
            calls.push({ kind: 'delete', name: table, args: where })
            return Promise.resolve({ error: null }).then(res, rej)
          },
        }
        return q
      },
    }
  },
  rpc(name: string, args: Record<string, unknown>) {
    /* the two readers run on every load; the calls recorded are the writes */
    if (name !== 'circuit_session_sums' && name !== 'circuit_manual_sums')
      calls.push({ kind: 'rpc', name, args })
    if (failing.has(name)) return Promise.resolve(failure(name))
    return Promise.resolve({ data: null, error: null, ...rpcAnswer(name, args) })
  },
  channel: () => ({ on: () => undefined }),
}
/* the suite runs without a DOM; the adapter caches the board in localStorage, so it gets a fresh one */
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
})
vi.mock('../finance/client', () => ({
  getSupabaseClient: () => fake,
  getSupabaseClientOrNull: () => fake,
  isSessionDefinitelyDead: () => false,
  subscribeLogged: () => undefined,
}))
vi.mock('./toast', () => ({ showToast: () => undefined }))

const { createSupabaseAdapter } = await import('./supabaseAdapter')
const { CellRefused } = await import('./cellRefused')
const { createCircuitStore } = await import('./store')

/** where a real session's board is kept between visits */
const CACHE = 'circuit_cloud_cache_v1'
/** every promise the adapter started has settled — the fake answers at once, so a macrotask will do */
const settle = () => new Promise((r) => setTimeout(r, 0))

const person = (id: string, owner: string | null) => ({
  id,
  name: id,
  color: null,
  goal: 100,
  exercises: [{ id: 'quad', name: 'Quad Curl', unit: 'reps', mult: 1, col: 0, row: 0 }],
  col_labels: [],
  owner_user_id: owner,
  visibility: 'private',
})

beforeEach(() => {
  calls.length = 0
  failing.clear()
  held = null
  tables.circuit_people = [person('mine', 'user-1'), person('nobody', null)]
  tables.circuit_logs = [
    {
      id: 'l-mine-2026-11-07',
      person_id: 'mine',
      date: '2026-11-07',
      entries: [{ eid: 'quad', val: 8 }],
      img: null,
    },
  ]
  rpcAnswer = (name) =>
    name === 'circuit_session_sums'
      ? { data: [{ person: 'mine', exercise: 'quad', on: '2026-11-07', value: 12 }] }
      : {}
  localStorage.clear()
})

describe('saving a day for a person linked to an account', () => {
  it('sends each changed cell as a total, with what the screen saw under it', async () => {
    const a = createSupabaseAdapter()
    const s = await a.load()
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    expect(day.entries).toEqual([{ eid: 'quad', val: 20 }])
    await a.saveLog({ ...day, entries: [{ eid: 'quad', val: 25 }] })
    expect(calls).toEqual([
      {
        kind: 'rpc',
        name: 'circuit_cell_set',
        args: {
          p_person: 'mine',
          p_exercise: 'quad',
          p_day: '2026-11-07',
          p_total: 25,
          p_seen_sessions: 12,
          p_seen_manual: 8,
        },
      },
    ])
  })

  it('says the server reason when a cell is refused', async () => {
    const a = createSupabaseAdapter()
    const s = await a.load()
    rpcAnswer = (name) =>
      name === 'circuit_cell_set'
        ? {
            error: {
              code: 'P0001',
              message: 'sessions count 12 on that day — lower them in Chronicle',
            },
          }
        : {}
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    await expect(a.saveLog({ ...day, entries: [{ eid: 'quad', val: 5 }] })).rejects.toBeInstanceOf(
      CellRefused,
    )
  })

  it('will not delete a day whose cells hold sessions', async () => {
    const a = createSupabaseAdapter()
    await a.load()
    await expect(a.deleteLog('l-mine-2026-11-07')).rejects.toThrow('sessions count 12 on that day')
    expect(calls.filter((c) => c.kind === 'delete')).toEqual([])
  })

  it('falls back to the old write only where the server has no cell writer and there are no sessions', async () => {
    rpcAnswer = (name) =>
      name === 'circuit_cell_set'
        ? {
            error: {
              code: 'PGRST202',
              message: 'Could not find the function public.circuit_cell_set',
            },
          }
        : { data: [] }
    const a = createSupabaseAdapter()
    const s = await a.load()
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    await a.saveLog({ ...day, entries: [{ eid: 'quad', val: 9 }] })
    expect(calls.map((c) => `${c.kind} ${c.name}`)).toEqual([
      'rpc circuit_cell_set',
      'upsert circuit_logs',
    ])
  })
})

describe('saving a day for a person nobody has claimed', () => {
  it('writes the row as it always has', async () => {
    const a = createSupabaseAdapter()
    await a.load()
    await a.saveLog({
      id: 'l-nobody-2026-11-07',
      personId: 'nobody',
      date: '2026-11-07',
      entries: [{ eid: 'quad', val: 3 }],
    })
    expect(calls.map((c) => `${c.kind} ${c.name}`)).toEqual(['upsert circuit_logs'])
  })
})

/**
 * ⚠️ THE STATE PRODUCTION IS IN AFTER THE RELEASE, and for as long as no cutover runs: the grid's
 * readers exist and the conversion's does not (OPEN-DECISIONS §20d). The board must load exactly as
 * the rows say — the refused call read as "nobody is converted", never as a broken board.
 */
describe('a server missing a reader', () => {
  const missing = (fn: string) => ({
    error: { code: 'PGRST202', message: `Could not find the function public.${fn}` },
  })
  it('loads the board when the conversion reader is not there, with the sessions still added in', async () => {
    rpcAnswer = (name) =>
      name === 'circuit_session_sums'
        ? { data: [{ person: 'mine', exercise: 'quad', on: '2026-11-07', value: 12 }] }
        : name === 'circuit_manual_sums'
          ? missing(name)
          : {}
    const s = await createSupabaseAdapter().load()
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    expect(day.entries).toEqual([{ eid: 'quad', val: 20 }])
    expect(day.sessions).toEqual([{ eid: 'quad', val: 12 }])
  })

  it('keeps that board and saves from it, because a reader that is not there is an answer', async () => {
    rpcAnswer = (name) =>
      name === 'circuit_session_sums'
        ? { data: [{ person: 'mine', exercise: 'quad', on: '2026-11-07', value: 12 }] }
        : name === 'circuit_manual_sums'
          ? missing(name)
          : {}
    const a = createSupabaseAdapter()
    const s = await a.load()
    expect(JSON.parse(localStorage.getItem(CACHE)!).logs).toEqual(s.logs)
    await a.saveLog({ ...s.logs[0], entries: [{ eid: 'quad', val: 25 }] })
    expect(calls.map((c) => `${c.kind} ${c.name}`)).toEqual(['rpc circuit_cell_set'])
  })

  /* ⚠️ THIS USED TO SAY THE OPPOSITE — "loads the board exactly as the rows say when neither reader
     is there" — about a server without the grid. Production has not been that server since
     20261110025332_circuit_grid_sessions was applied, so a session reader that is not found is
     something wrong, and reading it as "no sessions" is exactly what let a day holding sessions be
     deleted (the audit's circuit_session_sums row). */
  it('takes a session reader that is not there as a failed load, not as no sessions', async () => {
    rpcAnswer = (name) => missing(name)
    const a = createSupabaseAdapter()
    await a.load()
    expect(localStorage.getItem(CACHE)).toBeNull()
    await expect(a.deleteLog('l-mine-2026-11-07')).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

/**
 * ⚠️ THE 27 NOV 2026 AUDIT (docs/2026-11-27-supabase-failure-audit.md), parts 2 and 4. Every read
 * here used to become `data ?? []`, so one table that did not answer was a board with nothing in
 * it — painted, cached over the good board for the next visit, and then SAVED from: a blank rating
 * editor erased a review, a blank day was typed over, and a day whose sessions did not load could be
 * deleted out from under them.
 *
 * ⚠️ EVERY TABLE HOLDS A ROW, deliberately. A table left at its default `[]` reads the same whether
 * its read worked or not, so a test of it would pass against the bug (CLAUDE.md §2, the fixture
 * sitting on defaults).
 */
describe('a board whose reads did not all answer', () => {
  beforeEach(() => {
    tables.circuit_movies = [{ id: 'm1', title: 'Heat', kind: 'movie', date: null, rt: null }]
    tables.circuit_watchlist = [{ id: 'w1', title: 'Ronin', rt: null, pool_id: 'pool-1' }]
    tables.circuit_person_groups = [{ person_id: 'mine', group_id: 'g1' }]
    tables.circuit_groups = [{ id: 'g1', name: 'Gym crew' }]
    tables.pools = [{ id: 'pool-1', name: 'Friday', audience: 'friends', owner_user_id: 'user-1' }]
    tables.pool_votes = [{ item_id: 'w1', user_id: 'user-1' }]
    tables.circuit_ratings = [
      {
        movie_id: 'm1',
        user_id: 'user-1',
        score: 8,
        icons: ['🔥'],
        review: { note: 'the bank scene' },
        picture: null,
      },
    ]
  })

  const READS = [
    'circuit_people',
    'circuit_logs',
    'circuit_movies',
    'circuit_watchlist',
    'circuit_person_groups',
    'circuit_groups',
    'pools',
    'pool_votes',
    'circuit_ratings',
    'circuit_session_sums',
  ]

  it.each(READS)('a failed %s read is not kept over the board this device had', async (read) => {
    const a = createSupabaseAdapter()
    await a.reload!()
    const good = localStorage.getItem(CACHE)
    expect(JSON.parse(good!).people).toHaveLength(2)
    failing.add(read)
    await a.reload!()
    expect(localStorage.getItem(CACHE)).toBe(good)
  })

  it('paints the board this device had, not a blank, when the fresh load fails', async () => {
    await createSupabaseAdapter().reload!()
    failing.add('circuit_people')
    const s = createCircuitStore()
    await s.init(createSupabaseAdapter())
    await settle()
    expect(s.getState().people.map((p) => p.id)).toEqual(['mine', 'nobody'])
  })

  it('will not save or delete a rating while the ratings did not load', async () => {
    failing.add('circuit_ratings')
    const a = createSupabaseAdapter()
    await a.load()
    await expect(
      a.saveRating({ id: 'm1::user-1', movieId: 'm1', userId: 'user-1', score: 7 }),
    ).rejects.toThrow()
    await expect(a.deleteRating('m1::user-1')).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('will not write a day while the days did not load', async () => {
    failing.add('circuit_logs')
    const a = createSupabaseAdapter()
    await a.load()
    await expect(
      a.saveLog({
        id: 'l-nobody-2026-11-07',
        personId: 'nobody',
        date: '2026-11-07',
        entries: [{ eid: 'quad', val: 3 }],
      }),
    ).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('will not delete a day, or send its cells, while its sessions did not load', async () => {
    failing.add('circuit_session_sums')
    const a = createSupabaseAdapter()
    const s = await a.load()
    await expect(a.deleteLog('l-mine-2026-11-07')).rejects.toThrow()
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    await expect(a.saveLog({ ...day, entries: [{ eid: 'quad', val: 25 }] })).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('takes a conversion reader that is there and fails as a failed load, not as nobody converted', async () => {
    failing.add('circuit_manual_sums')
    const a = createSupabaseAdapter()
    const s = await a.load()
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    await expect(a.saveLog({ ...day, entries: [{ eid: 'quad', val: 25 }] })).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('saves again once a load succeeds', async () => {
    failing.add('circuit_ratings')
    const a = createSupabaseAdapter()
    await a.load()
    failing.clear()
    await a.reload!()
    await a.saveRating({ id: 'm1::user-1', movieId: 'm1', userId: 'user-1', score: 7 })
    expect(calls.map((c) => `${c.kind} ${c.name}`)).toEqual(['upsert circuit_ratings'])
  })
})

/**
 * ⚠️ THE MOMENT BETWEEN THE KEPT BOARD AND THE FRESH ONE. `load()` paints the board this device
 * had at once and fetches the fresh one behind it — and the write path asks `lastLogs` and `linked`,
 * which only a fresh load used to fill. So for that beat a linked person's day was saved as a plain
 * row (its sessions typed into it as if they were the manual part), and a day the screen showed
 * holding sessions could be deleted: the same harm as a failed session read, through another door.
 */
describe('the board this device had, before the fresh one lands', () => {
  async function keptBoardShowing() {
    await createSupabaseAdapter().reload!()
    let release!: () => void
    held = new Promise<void>((r) => (release = r))
    const a = createSupabaseAdapter()
    const s = await a.load()
    return { a, s, release }
  }

  it('will not delete a day it shows holding sessions', async () => {
    const { a, release } = await keptBoardShowing()
    await expect(a.deleteLog('l-mine-2026-11-07')).rejects.toThrow('sessions count 12 on that day')
    expect(calls.filter((c) => c.kind === 'delete')).toEqual([])
    release()
    await settle()
  })

  it('sends a linked person’s cell through the cell writer, against what it shows', async () => {
    const { a, s, release } = await keptBoardShowing()
    const day = s.logs.find((l) => l.id === 'l-mine-2026-11-07')!
    expect(day.entries).toEqual([{ eid: 'quad', val: 20 }])
    await a.saveLog({ ...day, entries: [{ eid: 'quad', val: 25 }] })
    expect(calls.map((c) => `${c.kind} ${c.name}`)).toEqual(['rpc circuit_cell_set'])
    expect(calls[0].args).toMatchObject({ p_seen_sessions: 12, p_seen_manual: 8 })
    release()
    await settle()
  })
})
