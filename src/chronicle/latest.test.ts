import { describe, expect, it } from 'vitest'
import { latestOnly } from './latest'

/**
 * Overlapping loads in Chronicle's room: only the newest one may set what the room shows.
 * Modelled as the room runs them — each load takes a ticket as it starts, awaits, then asks.
 */
describe('which load gets to speak', () => {
  /** two loads, the older answering last: what ends up on screen */
  function race(older: boolean, newer: boolean) {
    const loads = latestOnly()
    let shown: boolean | null = null
    const a = loads.start()
    const b = loads.start()
    /* the newer answers first */
    if (loads.current(b)) shown = newer
    /* then the older, late */
    if (loads.current(a)) shown = older
    return shown
  }

  it('an older load whose marks read worked does not switch − and + back on after a newer one failed', () => {
    expect(race(true, false)).toBe(false)
  })

  it('an older failure does not block − and + again after a newer read (a Retry) worked', () => {
    expect(race(false, true)).toBe(true)
  })

  it('a load on its own always speaks', () => {
    const loads = latestOnly()
    const t = loads.start()
    expect(loads.current(t)).toBe(true)
  })
})
