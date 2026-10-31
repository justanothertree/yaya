import { describe, it, expect } from 'vitest'
import {
  TIER_ORDER,
  TIER_LABEL,
  TIER_HINTS,
  openness,
  offeredTiers,
  isOverCeiling,
} from './visibilityLabels'
import type { VisibilityTier } from '../circuit/types'

/**
 * What a picker is allowed to offer.
 *
 * These exist because the Browser pane structurally cannot answer the question: `previewMember`
 * has no session, so `my_visibility_ceiling` returns nothing there and every picker in the
 * workbench renders unnarrowed. A screenshot of that proves the component mounts and nothing
 * else — so the narrowing is asserted here or not at all.
 *
 * The expectations are written from the LADDER's shape rather than from the function's own sums:
 * "an account capped at X is offered X and everything below it, and nothing above" is a claim
 * about the product, and it would catch the filter being written with the comparison reversed.
 */
describe('openness', () => {
  it('orders the ladder from closed to open', () => {
    expect(openness('private')).toBeLessThan(openness('friends'))
    expect(openness('friends')).toBeLessThan(openness('members'))
    expect(openness('members')).toBeLessThan(openness('public'))
  })

  it('agrees with TIER_ORDER for every tier, so nothing is unranked', () => {
    for (const t of TIER_ORDER) expect(openness(t)).toBeGreaterThanOrEqual(0)
  })
})

describe('offeredTiers', () => {
  it('offers the whole ladder while the ceiling is unknown', () => {
    expect(offeredTiers(undefined, 'private')).toEqual(TIER_ORDER)
  })

  it('offers the ceiling and everything below it, and nothing above', () => {
    // asserted against the ladder, not against the filter: count what SHOULD be reachable
    const cases: [VisibilityTier, VisibilityTier[]][] = [
      ['public', ['private', 'friends', 'members', 'public']],
      ['members', ['private', 'friends', 'members']],
      ['friends', ['private', 'friends']],
      ['private', ['private']],
    ]
    for (const [ceiling, expected] of cases) {
      expect(offeredTiers(ceiling, 'private')).toEqual(expected)
    }
  })

  it('never offers a level above the ceiling when the stored value is reachable', () => {
    for (const ceiling of TIER_ORDER) {
      for (const t of offeredTiers(ceiling, 'private')) {
        expect(openness(t)).toBeLessThanOrEqual(openness(ceiling))
      }
    }
  })

  it('still offers a stored value that sits above the ceiling', () => {
    // Josh's blocks are exactly this: stored `public` on an account capped at `members`
    const offer = offeredTiers('members', 'public')
    expect(offer).toContain('public')
    expect(offer).toContain('members')
    expect(offer).toContain('private')
  })

  it('keeps the stored value selectable in every ceiling/value pair, so the control is never blank', () => {
    for (const ceiling of TIER_ORDER) {
      for (const value of TIER_ORDER) {
        expect(offeredTiers(ceiling, value)).toContain(value)
      }
    }
  })

  it('adds the over-ceiling value without also letting anything else through', () => {
    // `public` stored under a `friends` ceiling must not drag `members` in with it
    expect(offeredTiers('friends', 'public')).toEqual(['private', 'friends', 'public'])
  })

  it('returns tiers in ladder order whatever the stored value', () => {
    const offer = offeredTiers('friends', 'public')
    const ranks = offer.map(openness)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

describe('isOverCeiling', () => {
  it('is false while the ceiling is unknown, so nothing is accused prematurely', () => {
    expect(isOverCeiling(undefined, 'public')).toBe(false)
  })

  it('is true only when the stored value is strictly wider', () => {
    expect(isOverCeiling('members', 'public')).toBe(true)
    expect(isOverCeiling('members', 'members')).toBe(false)
    expect(isOverCeiling('members', 'friends')).toBe(false)
    expect(isOverCeiling('friends', 'members')).toBe(true)
    expect(isOverCeiling('public', 'public')).toBe(false)
  })
})

describe('the copy covers the ladder', () => {
  it('names every tier, so no option renders blank', () => {
    for (const t of TIER_ORDER) {
      expect(TIER_LABEL[t] ?? '').not.toBe('')
    }
  })

  it('has a hint for every tier in both kinds', () => {
    for (const kind of ['circuit', 'snake'] as const) {
      for (const t of TIER_ORDER) {
        expect(TIER_HINTS[kind][t]).toBeTruthy()
      }
    }
  })

  it('shows a database name to nobody', () => {
    for (const t of TIER_ORDER) expect(TIER_LABEL[t]).not.toBe(t)
  })
})
