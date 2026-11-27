import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftKey, makeAutosave, makeDrafts, memoryBackend, SIGNED_OUT } from './drafts'

/**
 * The draft store, asked without a browser.
 *
 * ⚠️ A RELOAD IS A NEW STORE OVER THE SAME ROWS. Everything the page held in memory is gone after
 * one, and only the backend survives — so each "reload" here builds a fresh `makeDrafts` on the
 * rows the last one wrote, and the backend copies on the way in and out the way IndexedDB does.
 */

const text = (v: unknown) => (typeof v === 'string' ? v : null)

describe('draftKey', () => {
  it('is the editor, the person and the thing', () => {
    expect(draftKey('paint', 'u-1')).toBe('paint|u-1')
    expect(draftKey('paint', 'u-1', 'room-9')).toBe('paint|u-1|room-9')
  })

  it('nobody signed in is one spelling, never the empty string', () => {
    for (const who of [null, undefined, '', '   '])
      expect(draftKey('paint', who)).toBe(`paint|${SIGNED_OUT}`)
  })
})

describe('a draft survives a reload, for the person who made it', () => {
  it('comes back after the store is rebuilt on the same rows', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(
      memoryBackend(rows),
      () => 'ann',
      () => 1000,
    ).write('paint', 'a whole minion')
    const after = makeDrafts(memoryBackend(rows), () => 'ann')
    expect(await after.read('paint', text)).toEqual({ at: 1000, body: 'a whole minion' })
  })

  it('is not offered to somebody else on the same browser, signed in or not', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), () => 'ann').write('paint', 'ann’s')
    expect(await makeDrafts(memoryBackend(rows), () => 'bo').read('paint', text)).toBeNull()
    expect(await makeDrafts(memoryBackend(rows), () => null).read('paint', text)).toBeNull()
    await makeDrafts(memoryBackend(rows), () => null).write('paint', 'a visitor’s')
    expect((await makeDrafts(memoryBackend(rows), () => 'ann').read('paint', text))?.body).toBe(
      'ann’s',
    )
  })

  it('asks who is signed in at each call, not once', async () => {
    let who: string | null = 'ann'
    const d = makeDrafts(memoryBackend(), () => who)
    await d.write('paint', 'first')
    who = 'bo'
    expect(await d.read('paint', text)).toBeNull()
    who = 'ann'
    expect((await d.read('paint', text))?.body).toBe('first')
  })

  it('a dropped draft is gone after a reload', async () => {
    const rows = new Map<string, unknown>()
    const d = makeDrafts(memoryBackend(rows), () => 'ann')
    await d.write('paint', 'x')
    await d.drop('paint')
    expect(await makeDrafts(memoryBackend(rows), () => 'ann').read('paint', text)).toBeNull()
  })

  it('a row the reader refuses is null and is LEFT where it is', async () => {
    const rows = new Map<string, unknown>([['paint|ann', { v: 1, at: 5, body: 42 }]])
    expect(await makeDrafts(memoryBackend(rows), () => 'ann').read('paint', text)).toBeNull()
    expect(rows.has('paint|ann')).toBe(true)
  })

  it('a row that is not a draft at all is null, whatever is in it', async () => {
    for (const junk of [
      null,
      'x',
      7,
      [],
      { at: 1, body: 'x' },
      { v: 2, at: 1, body: 'x' },
      { v: 1, at: 'x', body: 'x' },
      { v: 1, at: 1 },
    ]) {
      const rows = new Map<string, unknown>([['paint|ann', junk]])
      expect(await makeDrafts(memoryBackend(rows), () => 'ann').read('paint', text)).toBeNull()
    }
  })

  it('a backend that throws costs only the draft', async () => {
    const broken = {
      get: () => Promise.reject(new Error('blocked')),
      put: () => Promise.reject(new Error('full')),
      del: () => Promise.reject(new Error('gone')),
    }
    const d = makeDrafts(broken, () => 'ann')
    await expect(d.read('paint', text)).resolves.toBeNull()
    await expect(d.write('paint', 'x')).resolves.toBe(false)
    await expect(d.drop('paint')).resolves.toBe(false)
  })
})

describe('makeAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const recorder = (ok = true) => {
    const log: string[] = []
    return {
      log,
      store: {
        write: async (b: string) => (log.push(`write ${b}`), ok),
        drop: async () => (log.push('drop'), true),
      },
    }
  }

  it('waits for a burst to settle and writes only the last of it', async () => {
    const { log, store } = recorder()
    const a = makeAutosave(store, 600)
    a.change('a')
    a.change('ab')
    await vi.advanceTimersByTimeAsync(599)
    expect(log).toEqual([])
    a.change('abc')
    await vi.advanceTimersByTimeAsync(600)
    expect(log).toEqual(['write abc'])
  })

  it('null means nothing is unsaved, and drops', async () => {
    const { log, store } = recorder()
    const a = makeAutosave(store, 600)
    a.change('x')
    a.change(null)
    await vi.advanceTimersByTimeAsync(600)
    expect(log).toEqual(['drop'])
  })

  it('flush does what is pending at once, which is what pagehide needs', async () => {
    const { log, store } = recorder()
    const a = makeAutosave(store, 600)
    a.change('x')
    await a.flush()
    expect(log).toEqual(['write x'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(log).toEqual(['write x'])
  })

  it('paused, it touches nothing — not even with a flush — so an offered draft is never overwritten', async () => {
    const { log, store } = recorder()
    const a = makeAutosave(store, 600)
    a.pause()
    a.change('the empty page')
    await vi.advanceTimersByTimeAsync(1000)
    await a.flush()
    expect(log).toEqual([])
    a.resume()
    a.change('after the answer')
    await vi.advanceTimersByTimeAsync(600)
    expect(log).toEqual(['write after the answer'])
  })

  it('says when the device refused a write, and stops saying so when one lands', async () => {
    const r = recorder(false)
    const a = makeAutosave(r.store, 10)
    a.change('x')
    await vi.advanceTimersByTimeAsync(10)
    expect(a.failed()).toBe(true)
    const ok = recorder(true)
    const b = makeAutosave(ok.store, 10)
    b.change('y')
    await vi.advanceTimersByTimeAsync(10)
    expect(b.failed()).toBe(false)
  })

  it('tells the room after each write whether it landed, and says nothing about a drop', async () => {
    const said: boolean[] = []
    const bad = makeAutosave(recorder(false).store, 10, (ok) => said.push(ok))
    bad.change('x')
    await vi.advanceTimersByTimeAsync(10)
    bad.change(null)
    await vi.advanceTimersByTimeAsync(10)
    const good = makeAutosave(recorder(true).store, 10, (ok) => said.push(ok))
    good.change('y')
    await vi.advanceTimersByTimeAsync(10)
    expect(said).toEqual([false, true])
  })

  it('a change made while paused is written once it resumes, without another change', async () => {
    const { log, store } = recorder()
    const a = makeAutosave(store, 600)
    a.pause()
    a.change('drawn while the offer was up')
    await vi.advanceTimersByTimeAsync(5000)
    expect(log).toEqual([])
    a.resume()
    await vi.advanceTimersByTimeAsync(600)
    expect(log).toEqual(['write drawn while the offer was up'])
  })
})
