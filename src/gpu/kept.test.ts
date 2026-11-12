import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadKept, storeKept, whole } from './kept'

/** a stand-in for the browser's store, or one that refuses as private mode does */
function store(refuse = false) {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (refuse) throw new Error('denied')
      return m.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (refuse) throw new Error('denied')
      m.set(k, v)
    },
  })
  return m
}
afterEach(() => vi.unstubAllGlobals())

describe('what a toy keeps', () => {
  const read = (text: string | null) => (text ? (JSON.parse(text) as { n: number }) : { n: 0 })
  it('reads what was stored under its key, through the toy’s own reader', () => {
    const m = store()
    m.set('lab_x_v1', '{"n":7}')
    expect(loadKept('lab_x_v1', read)).toEqual({ n: 7 })
    expect(loadKept('lab_y_v1', read)).toEqual({ n: 0 })
  })
  it('stores it as JSON, to be read back the same', () => {
    const m = store()
    storeKept('lab_x_v1', { n: 3 })
    expect(m.get('lab_x_v1')).toBe('{"n":3}')
    expect(loadKept('lab_x_v1', read)).toEqual({ n: 3 })
  })
  it('falls back to nothing kept when the store refuses, and stores nothing without a fuss', () => {
    store(true)
    expect(loadKept('lab_x_v1', read)).toEqual({ n: 0 })
    expect(() => storeKept('lab_x_v1', { n: 1 })).not.toThrow()
    // and with no store at all, as in a test or a page without one
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', undefined)
    expect(loadKept('lab_x_v1', read)).toEqual({ n: 0 })
    expect(() => storeKept('lab_x_v1', { n: 1 })).not.toThrow()
  })
})

describe('a whole number kept', () => {
  it('is a whole number from nought up to just under its limit, or nought', () => {
    expect(whole(7)).toBe(7)
    expect(whole(0)).toBe(0)
    expect(whole(999_999)).toBe(999_999)
    // the limit is a million unless the toy says otherwise
    expect(whole(1_000_000)).toBe(0)
    expect(whole(1_000_000, 1e9)).toBe(1_000_000)
    expect(whole(297, 298)).toBe(297)
    expect(whole(298, 298)).toBe(0)
    for (const bad of [-1, 2.5, NaN, Infinity, '7', null, undefined, {}, [3]])
      expect(whole(bad)).toBe(0)
  })
})
