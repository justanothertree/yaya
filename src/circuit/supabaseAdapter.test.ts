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
const fake = {
  from(table: string) {
    return {
      select: () => Promise.resolve({ data: tables[table] ?? [], error: null }),
      upsert: (row: unknown) => {
        calls.push({ kind: 'upsert', name: table, args: row })
        return Promise.resolve({ error: null })
      },
      delete: () => ({
        eq: (_c: string, id: string) => {
          calls.push({ kind: 'delete', name: table, args: id })
          return Promise.resolve({ error: null })
        },
      }),
    }
  },
  rpc(name: string, args: Record<string, unknown>) {
    if (name !== 'circuit_session_sums') calls.push({ kind: 'rpc', name, args })
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
  subscribeLogged: () => undefined,
}))

const { createSupabaseAdapter } = await import('./supabaseAdapter')
const { CellRefused } = await import('./cellRefused')

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
