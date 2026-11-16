import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESULT_EVENT, storeKept, writeKept } from '../gpu/stored'
import { keepOnline } from './social/online'
import { resultCard } from './bests'
import { watchResult } from './resultWatch'

/* a tab with no page: an event target for `window`, and a store that does what localStorage does */
function stubTab() {
  const data = new Map<string, string>()
  const win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  })
  return { data, win }
}
const read = () => resultCard('rps', 'Rock, paper, scissors', (k) => localStorage.getItem(k))
/* what rps.ts keeps: matches won against the mind-reader, and a streak */
const won = (n: number) => JSON.stringify({ matchesWon: n, matchesLost: 1, streak: 2 })

describe('the Share box hears a result the moment it is written', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a write in this tab updates it at once, with no timer anywhere', () => {
    stubTab()
    const seen: [string | null, boolean][] = []
    const stop = watchResult(read, (card, fresh) => seen.push([card?.line ?? null, fresh]))
    expect(vi.getTimerCount()).toBe(0)
    storeKept('lab_rps_v1', JSON.parse(won(3)))
    // heard synchronously: nothing was advanced, and nothing is waiting to run
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toMatch(/^Rock, paper, scissors: /)
    expect(seen[0][1]).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })
  it('a write that changes nothing it shows is not a change', () => {
    stubTab()
    storeKept('lab_rps_v1', JSON.parse(won(3)))
    const seen: unknown[] = []
    watchResult(read, (c) => seen.push(c))
    storeKept('lab_rps_v1', JSON.parse(won(3)))
    writeKept('somebody_elses_key', '1')
    expect(seen).toHaveLength(0)
  })
  it('another tab’s write arrives as the storage event', () => {
    const { data, win } = stubTab()
    const seen: unknown[] = []
    watchResult(read, (c) => seen.push(c))
    data.set('lab_rps_v1', won(5)) // written by another tab: no lab:result here
    expect(seen).toHaveLength(0)
    win.dispatchEvent(new Event('storage'))
    expect(seen).toHaveLength(1)
  })
  it('a game finished in a call announces itself too', () => {
    stubTab()
    const seen: unknown[] = []
    const reversi = () => resultCard('reversi', 'Reversi', (k) => localStorage.getItem(k))
    watchResult(reversi, (c) => seen.push(c))
    keepOnline('reversi', 'versus', 'won')
    expect(seen).toHaveLength(1)
  })
  it('stops listening when stopped, and a refused write announces nothing', () => {
    const { win } = stubTab()
    const heard = vi.fn()
    win.addEventListener(RESULT_EVENT, heard)
    const seen: unknown[] = []
    const stop = watchResult(read, (c) => seen.push(c))
    stop()
    storeKept('lab_rps_v1', JSON.parse(won(2)))
    expect(seen).toHaveLength(0)
    expect(heard).toHaveBeenCalledTimes(1)
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('full')
      },
    })
    storeKept('lab_rps_v1', 1) // swallowed by storeKept, as before
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('every Lab write goes through writeKept', () => {
  /* a toy that writes localStorage itself is a result the Share box never hears about */
  it('no Lab source writes localStorage directly but stored.ts', () => {
    const sources = import.meta.glob<string>(['/src/gpu/**/*.{ts,tsx}', '/src/lab/**/*.{ts,tsx}'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    expect(Object.keys(sources).length).toBeGreaterThan(200)
    const offenders = Object.entries(sources)
      .filter(([p]) => !/\.test\.tsx?$/.test(p) && !p.endsWith('/stored.ts'))
      .filter(([, text]) => /localStorage\.setItem\(/.test(text))
      .map(([p]) => p)
    expect(offenders).toEqual([])
  })
})
