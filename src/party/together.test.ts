import { afterEach, describe, expect, it, vi } from 'vitest'

/* a stand-in localStorage: the suite runs in node, where there is none */
function fakeStorage(seed: Record<string, string>) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  }
}

describe('the share-everything switch lasts one call (Evan, 13 Nov)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  it('starts off even where an old visit left it on, and forgets the old key', async () => {
    const store = fakeStorage({ party_share_all_v1: '1' })
    vi.stubGlobal('localStorage', store)
    const { together } = await import('./together')
    expect(together.getState().on).toBe(false)
    expect(store.has('party_share_all_v1')).toBe(false)
  })
  it('turning it on is not written anywhere a reload would read', async () => {
    const store = fakeStorage({})
    vi.stubGlobal('localStorage', store)
    const { together } = await import('./together')
    together.setOn(true)
    expect(together.getState().on).toBe(true)
    expect(store.has('party_share_all_v1')).toBe(false)
  })
})
