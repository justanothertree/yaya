import { describe, expect, it, vi } from 'vitest'

vi.mock('./toast', () => ({ showToast: () => undefined }))

const { createCircuitStore } = await import('./store')
import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog } from './types'

/**
 * `refresh()` — the Circuit opening again fetches the board again (OPEN-DECISIONS §20b). The adapter
 * is a stand-in whose server-side board can be changed behind the store's back, which is exactly
 * what Chronicle writing a set is.
 */
const day = (val: number, id = 'l-1'): DayLog => ({
  id,
  personId: 'p-1',
  date: '2026-11-06',
  entries: [{ eid: 'quad', val }],
})
const board = (logs: DayLog[]): CircuitState => ({ people: [], logs, movies: [], watchlist: [] })

function stand(withReload = true) {
  let server = board([day(15)])
  const loads: string[] = []
  const a: CircuitAdapter = {
    load: async () => {
      loads.push('load')
      return structuredClone(server)
    },
    subscribe: () => () => undefined,
    saveLog: async (l) => {
      server = { ...server, logs: [...server.logs.filter((x) => x.id !== l.id), l] }
    },
    deleteLog: async () => undefined,
    savePerson: async () => undefined,
    deletePerson: async () => undefined,
    saveMovie: async () => undefined,
    deleteMovie: async () => undefined,
    saveWatchlist: async () => undefined,
    deleteWatchlist: async () => undefined,
    savePool: async () => undefined,
    deletePool: async () => undefined,
    saveVote: async () => undefined,
    deleteVote: async () => undefined,
    saveRating: async () => undefined,
    deleteRating: async () => undefined,
  }
  if (withReload) {
    a.reload = async () => {
      loads.push('reload')
      return structuredClone(server)
    }
  }
  return {
    a,
    loads,
    elsewhere: (logs: DayLog[]) => {
      server = board(logs)
    },
  }
}

describe('the Circuit opening again', () => {
  it('shows what changed elsewhere since the board was loaded', async () => {
    const s = createCircuitStore()
    const t = stand()
    await s.init(t.a)
    t.elsewhere([day(4)])
    expect(s.getState().logs[0].entries[0].val).toBe(15)
    await s.refresh()
    expect(s.getState().logs[0].entries[0].val).toBe(4)
    expect(t.loads).toEqual(['load', 'reload'])
  })

  it('keeps undo, because it is the same board, newer', async () => {
    const s = createCircuitStore()
    const t = stand()
    await s.init(t.a)
    await s.saveLog(day(20, 'l-2'))
    expect(s.getHistoryState().canUndo).toBe(true)
    await s.refresh()
    expect(s.getHistoryState().canUndo).toBe(true)
  })

  it('puts a write of the last few seconds back over a board fetched before it landed', async () => {
    const s = createCircuitStore()
    const t = stand()
    await s.init(t.a)
    void s.saveLog(day(30))
    /* the fresh board predates the write — the race realtime has too */
    t.elsewhere([day(15)])
    await s.refresh()
    expect(s.getState().logs.find((l) => l.id === 'l-1')?.entries[0].val).toBe(30)
  })

  it('does nothing for a board with nowhere else to come from, and nothing before a board exists', async () => {
    const s = createCircuitStore()
    await s.refresh()
    expect(s.getState().logs).toEqual([])
    const t = stand(false)
    await s.init(t.a)
    t.elsewhere([day(4)])
    await s.refresh()
    expect(s.getState().logs[0].entries[0].val).toBe(15)
    expect(t.loads).toEqual(['load'])
  })

  it('leaves the board as it was when the fetch fails', async () => {
    const s = createCircuitStore()
    const t = stand()
    await s.init(t.a)
    t.a.reload = async () => {
      throw new Error('offline')
    }
    await expect(s.refresh()).resolves.toBeUndefined()
    expect(s.getState().logs[0].entries[0].val).toBe(15)
  })
})
