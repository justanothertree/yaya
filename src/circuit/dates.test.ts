import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { localISO } from './dates'

/**
 * `localISO` is the one spelling of a local calendar day, and Chronicle's own copies of it were
 * folded into it, so what it promises is written down here. Pinned to New York, where a late
 * evening is already tomorrow in UTC, because that is the mistake it exists to avoid.
 */
describe('a local calendar day, spelled YYYY-MM-DD', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'America/New_York')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('pads the month and the day to two digits', () => {
    expect(localISO(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
    expect(localISO(new Date(2026, 10, 30, 12))).toBe('2026-11-30')
  })

  it('is the local day late in the evening, when UTC has already moved on', () => {
    const lateEvening = new Date(2026, 10, 10, 23, 30)
    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-11-11')
    expect(localISO(lateEvening)).toBe('2026-11-10')
  })
})
