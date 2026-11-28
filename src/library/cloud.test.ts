import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Drawing } from '../draw/strokes'

/**
 * The library's account copy, asked what happens when the account does not answer.
 *
 * ⚠️ supabase-js DOES NOT THROW WHEN A REQUEST FAILS. A dropped connection resolves
 * `{ data: null, error }` exactly like a refusal does, so the only way to know a delete or an edit
 * reached the account is to read `error` — and watchLibrary used to move on whether or not it
 * had. A failed delete was never sent again and the next load pulled the item back; a failed
 * edit was never sent again and the account kept the old one.
 *
 * Only the network is a stand-in here. The gallery is the real store on a fake localStorage, so
 * a delete is `removeArt` and an edit is `saveArt` under a name that is already kept — the same
 * calls the paint room makes.
 */

const net = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  answer: (async () => ({ data: null, error: null })) as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
}))

vi.mock('../finance/client', () => ({
  getSupabaseClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      net.calls.push({ fn, args })
      return await net.answer(fn, args)
    },
  }),
}))

const store = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}

const ok = { data: null, error: null }
/* what postgrest-js resolves with when fetch itself failed */
const offline = {
  data: null,
  error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
}
/* what a raised sentence in library_put comes back as */
const tooBig = {
  data: null,
  error: { message: 'that one is too big to keep', details: null, hint: null, code: 'P0001' },
}

const answer = (fn: (name: string) => { data: unknown; error: unknown }) => {
  net.answer = async (name) => fn(name)
}

const drawing = (name: string, c = '#4a7c3f'): Drawing => ({
  v: 1,
  name,
  ratio: 1,
  bg: null,
  strokes: [{ t: 'brush', c, a: 1, w: 0.03, p: [0.3, 0.3, 0.7, 0.7] }],
})

/** A page load: fresh modules over whatever this browser's storage already holds. */
async function load() {
  vi.resetModules()
  const cloud = await import('./cloud')
  const gallery = await import('../draw/gallery')
  const strokes = await import('../draw/strokes')
  return { cloud, gallery, strokes }
}

/* every send is a promise chain with no timers in it, so a long enough run of microtasks
   lets a pass finish without guessing at a delay */
const drain = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

const sent = (fn: string) => net.calls.filter((c) => c.fn === fn).map((c) => c.args.p_name)

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', fakeStorage)
  net.calls.length = 0
  answer(() => ok)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a delete that did not reach the account', () => {
  it('is sent again on the next change', async () => {
    const { cloud, gallery } = await load()
    const dawn = gallery.saveArt(drawing('Dawn'))!
    const stop = cloud.watchLibrary(() => 'u1')

    answer((fn) => (fn === 'library_drop' ? offline : ok))
    gallery.removeArt(dawn.id)
    await drain()
    expect(sent('library_drop')).toEqual(['Dawn'])

    answer(() => ok)
    gallery.saveArt(drawing('Dusk'))
    await drain()
    expect(sent('library_drop')).toEqual(['Dawn', 'Dawn'])
    stop()
  })

  it('is sent again on its own, a little later, with nothing else changing', async () => {
    vi.useFakeTimers()
    const { cloud, gallery } = await load()
    const dawn = gallery.saveArt(drawing('Dawn'))!
    const stop = cloud.watchLibrary(() => 'u1')

    answer((fn) => (fn === 'library_drop' ? offline : ok))
    gallery.removeArt(dawn.id)
    await drain()
    expect(sent('library_drop')).toEqual(['Dawn'])

    answer(() => ok)
    await vi.advanceTimersByTimeAsync(60_000)
    await drain()
    expect(sent('library_drop')).toEqual(['Dawn', 'Dawn'])
    stop()
  })

  it('does not come back on the next load', async () => {
    const first = await load()
    const dawn = first.gallery.saveArt(drawing('Dawn'))!
    const body = first.strokes.packDrawing(dawn.art)
    const stop = first.cloud.watchLibrary(() => 'u1')
    answer((fn) => (fn === 'library_drop' ? offline : ok))
    first.gallery.removeArt(dawn.id)
    await drain()
    stop()

    /* the tab closed with the delete still owed; the account still has the row */
    net.calls.length = 0
    answer((fn) =>
      fn === 'library_index'
        ? { data: [{ kind: 'art', name: 'Dawn', at: 1 }], error: null }
        : fn === 'library_bodies'
          ? { data: [{ kind: 'art', name: 'Dawn', body }], error: null }
          : ok,
    )
    const next = await load()
    await next.cloud.syncLibrary('u1')
    expect(next.gallery.gallery().map((a) => a.name)).not.toContain('Dawn')
    expect(sent('library_drop')).toEqual(['Dawn'])
  })

  it('is owed to the account that made it, not to whoever signs in next', async () => {
    const first = await load()
    const dawn = first.gallery.saveArt(drawing('Dawn'))!
    const stop = first.cloud.watchLibrary(() => 'u1')
    answer((fn) => (fn === 'library_drop' ? offline : ok))
    first.gallery.removeArt(dawn.id)
    await drain()
    stop()

    net.calls.length = 0
    answer((fn) => (fn === 'library_index' ? { data: [], error: null } : ok))
    const next = await load()
    await next.cloud.syncLibrary('u2')
    expect(sent('library_drop')).toEqual([])
  })

  it('is not sent again once it has landed', async () => {
    const { cloud, gallery } = await load()
    const dawn = gallery.saveArt(drawing('Dawn'))!
    const stop = cloud.watchLibrary(() => 'u1')
    gallery.removeArt(dawn.id)
    await drain()
    gallery.saveArt(drawing('Dusk'))
    await drain()
    expect(sent('library_drop')).toEqual(['Dawn'])
    stop()

    net.calls.length = 0
    answer((fn) => (fn === 'library_index' ? { data: [], error: null } : ok))
    const next = await load()
    await next.cloud.syncLibrary('u1')
    expect(sent('library_drop')).toEqual([])
  })

  it('stops being retried on its own after a while, and the next change tries again', async () => {
    vi.useFakeTimers()
    const { cloud, gallery } = await load()
    const dawn = gallery.saveArt(drawing('Dawn'))!
    const stop = cloud.watchLibrary(() => 'u1')
    answer((fn) => (fn === 'library_drop' ? offline : ok))
    gallery.removeArt(dawn.id)
    await drain()

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    const afterADay = sent('library_drop').length
    expect(afterADay).toBeGreaterThan(1)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(sent('library_drop').length).toBe(afterADay)

    gallery.saveArt(drawing('Dusk'))
    await drain()
    expect(sent('library_drop').length).toBe(afterADay + 1)
    stop()
  })
})

describe('an edit that did not reach the account', () => {
  it('is sent again on the next change, and what goes is the edit', async () => {
    const { cloud, gallery, strokes } = await load()
    gallery.saveArt(drawing('Dawn', '#111111'))
    const stop = cloud.watchLibrary(() => 'u1')

    answer((fn) => (fn === 'library_put' ? offline : ok))
    gallery.saveArt(drawing('Dawn', '#222222'))
    await drain()
    expect(sent('library_put')).toEqual(['Dawn'])

    answer(() => ok)
    gallery.saveArt(drawing('Dusk'))
    await drain()
    const dawnPuts = net.calls.filter((c) => c.fn === 'library_put' && c.args.p_name === 'Dawn')
    expect(dawnPuts).toHaveLength(2)
    const edited = gallery.gallery().find((a) => a.name === 'Dawn')!
    expect(dawnPuts[1].args.p_body).toEqual(strokes.packDrawing(edited.art))
    stop()
  })

  it('reaches the account on the next load, even though the account has that name', async () => {
    const first = await load()
    first.gallery.saveArt(drawing('Dawn', '#111111'))
    const stop = first.cloud.watchLibrary(() => 'u1')
    answer((fn) => (fn === 'library_put' ? offline : ok))
    first.gallery.saveArt(drawing('Dawn', '#222222'))
    await drain()
    stop()

    net.calls.length = 0
    answer((fn) =>
      fn === 'library_index' ? { data: [{ kind: 'art', name: 'Dawn', at: 1 }], error: null } : ok,
    )
    const next = await load()
    const res = await next.cloud.syncLibrary('u1')
    expect(sent('library_put')).toEqual(['Dawn'])
    expect(res.pushed).toBe(1)

    /* and once it has landed it is not owed any more */
    net.calls.length = 0
    const again = await load()
    await again.cloud.syncLibrary('u1')
    expect(sent('library_put')).toEqual([])
  })

  it('is not sent over and over when the account refused it with a reason', async () => {
    const { cloud, gallery } = await load()
    gallery.saveArt(drawing('Dawn', '#111111'))
    const stop = cloud.watchLibrary(() => 'u1')
    answer((fn) => (fn === 'library_put' ? tooBig : ok))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    gallery.saveArt(drawing('Dawn', '#222222'))
    await drain()
    gallery.saveArt(drawing('Dusk'))
    await drain()
    gallery.saveArt(drawing('Dusk', '#333333'))
    await drain()
    expect(sent('library_put').filter((n) => n === 'Dawn')).toHaveLength(1)
    warn.mockRestore()
    stop()
  })
})

describe('a change made while a send is still out', () => {
  it('is sent too, rather than lost', async () => {
    const { cloud, gallery } = await load()
    const stop = cloud.watchLibrary(() => 'u1')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    net.answer = async (fn) => {
      if (fn === 'library_put') await gate
      return ok
    }
    gallery.saveArt(drawing('Dawn'))
    await drain()
    gallery.saveArt(drawing('Dusk'))
    await drain()
    release()
    await drain()
    expect(sent('library_put')).toContain('Dusk')
    stop()
  })
})
