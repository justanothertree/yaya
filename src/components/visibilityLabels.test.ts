import { describe, it, expect } from 'vitest'
import {
  TIER_ORDER,
  TIER_LABEL,
  TIER_HINTS,
  TIER_SHORT,
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
    expect(openness('private')).toBeLessThan(openness('certain'))
    expect(openness('certain')).toBeLessThan(openness('friends'))
    expect(openness('friends')).toBeLessThan(openness('members'))
    expect(openness('members')).toBeLessThan(openness('public'))
  })

  /**
   * ⚠️ `certain` BELOW `friends` IS WHAT MAKES THE LIST RULE NECESSARY, and asserting it
   * here is asserting the product rather than the array. A list naming somebody who is not an
   * accepted friend would make the narrow level reach further than the broad one directly above
   * it -- so every comparison built on this order would quietly mean the wrong thing, and the
   * server drops a non-friend name in both `visibility_certain_set` and `save_my_profile_blocks`
   * for exactly this reason.
   */
  it('puts certain below friends, which is why its list may only hold friends', () => {
    expect(openness('certain')).toBeLessThan(openness('friends'))
    expect(openness('private')).toBeLessThan(openness('certain'))
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
      ['public', ['private', 'certain', 'friends', 'members', 'public']],
      ['members', ['private', 'certain', 'friends', 'members']],
      ['friends', ['private', 'certain', 'friends']],
      ['certain', ['private', 'certain']],
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
    expect(offeredTiers('friends', 'public')).toEqual(['private', 'certain', 'friends', 'public'])
  })

  /**
   * `omit` is for a level the SURFACE cannot store, which is a different question from the
   * ceiling. Chronicle caps at friends by CHECK; a chronicle profile block cannot be public
   * because `get_member_chronicle` refuses an unauthenticated caller; a snake handle has no
   * `certain` because one setter moves every handle at once. Each of those was a hand-written
   * `.filter()` at its own call site before this argument existed.
   */
  describe('omit', () => {
    it('leaves out what the surface cannot store', () => {
      expect(offeredTiers('public', 'private', ['members', 'public'])).toEqual([
        'private',
        'certain',
        'friends',
      ])
      expect(offeredTiers('public', 'private', ['certain'])).toEqual([
        'private',
        'friends',
        'members',
        'public',
      ])
    })

    it('still offers an omitted level when that is what is stored, so nothing renders blank', () => {
      // a block saved as `public` before the chronicle rule existed is exactly this row
      expect(offeredTiers('public', 'public', ['public'])).toContain('public')
      expect(offeredTiers('public', 'certain', ['certain'])).toContain('certain')
    })

    it('applies the ceiling and the omission together', () => {
      expect(offeredTiers('friends', 'private', ['certain'])).toEqual(['private', 'friends'])
    })

    it('changes nothing when there is nothing to omit', () => {
      expect(offeredTiers('members', 'private', [])).toEqual(offeredTiers('members', 'private'))
    })
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

  it('has a hint for every tier in every kind', () => {
    for (const kind of ['circuit', 'snake', 'block', 'activity', 'chronicle'] as const) {
      for (const t of TIER_ORDER) {
        expect(TIER_HINTS[kind][t]).toBeTruthy()
      }
    }
  })

  it('shows a database name to nobody', () => {
    for (const t of TIER_ORDER) expect(TIER_LABEL[t]).not.toBe(t)
  })
})

/**
 * The short names, and the order they come out in.
 *
 * ⚠️ THE KEY ORDER IS LOAD-BEARING AND NOTHING ELSE WOULD CATCH IT. `Profile.tsx` and
 * `ProfileBlocks.tsx` both build a control by iterating this map with `Object.keys`, so its
 * insertion order IS the order of a dropdown and a row of buttons on screen. These lived as two
 * identical literals inside those components until they moved here; moving them was safe only
 * because the order came with them, and the next person to tidy this map alphabetically would
 * silently rearrange two controls with nothing going red.
 */
describe('TIER_SHORT', () => {
  /**
   * ⚠️ THIS USED TO ASSERT `['public','friends','members','private']` AND THE ORDER WAS LOAD-
   * BEARING, because two controls built themselves by iterating the map with `Object.keys`. Both
   * are `VisibilityPicker` now, which orders itself from `TIER_ORDER` and knows about the
   * ceiling -- so the insertion order stopped being a thing on screen, and the map is words
   * only. Asserted against the ladder instead, so the two cannot drift apart.
   */
  it('comes out in ladder order, and covers the ladder exactly', () => {
    expect(Object.keys(TIER_SHORT)).toEqual(TIER_ORDER)
  })

  it('names every tier, so no option renders blank', () => {
    for (const t of TIER_ORDER) expect((TIER_SHORT[t] ?? '').trim()).not.toBe('')
  })

  it('shows a database name to nobody', () => {
    for (const t of TIER_ORDER) expect(TIER_SHORT[t]).not.toBe(t)
  })

  it('is the shorter register: members reads as one word here and a phrase in the picker', () => {
    // the whole reason both maps exist -- "Only what anyone with an account are sent" does not parse
    expect(TIER_SHORT.members).toBe('Members')
    expect(TIER_LABEL.members).not.toBe(TIER_SHORT.members)
    expect(TIER_SHORT.members.length).toBeLessThan(TIER_LABEL.members.length)
  })
})
