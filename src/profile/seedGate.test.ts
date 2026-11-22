import { describe, expect, it } from 'vitest'
import { doorFor, proveEmpty } from './seedGate'

/**
 * The editor's gate. Whose a read of blocks is (the owner gets an array in `certain` on every block,
 * a visitor `null`) is the page writer's `ownerOf` now, tested in pageStore.test.ts; what is left
 * here is the proof an empty page needs and what stands in the editor's place.
 */

describe('an empty page', () => {
  it('is yours only when get_member_profile, asked after the read, says so', () => {
    expect(proveEmpty({ data: { username: 'evan', is_me: true }, error: null })).toBe('yours')
  })

  it('is not yours for a name nobody has, or after the account was switched', () => {
    /* the server answers [] for both, and get_member_profile says which */
    expect(proveEmpty({ data: null, error: null })).toBe('not-yours')
    expect(proveEmpty({ data: { username: 'evan', is_me: false }, error: null })).toBe('not-yours')
    expect(proveEmpty({ data: { username: 'evan', is_me: 'true' }, error: null })).toBe('not-yours')
    expect(proveEmpty({ data: null, error: new Error('offline') })).toBe('failed')
  })
})

describe('what stands where the editor goes', () => {
  it('“Opening your page…” until a good read of THIS page has arrived', () => {
    expect(doorFor('evan', null, null)).toBe('opening')
    /* a good read of the page before is not one of this page */
    expect(doorFor('evan', 'sam', null)).toBe('opening')
    expect(doorFor('evan', 'evan', null)).toBe('editor')
  })

  it('why it did not open, for this page only', () => {
    expect(doorFor('evan', null, { for: 'evan', why: 'failed' })).toBe('failed')
    expect(doorFor('evan', null, { for: 'evan', why: 'not-yours' })).toBe('not-yours')
    expect(doorFor('evan', null, { for: 'evan', why: 'not-you' })).toBe('not-you')
    expect(doorFor('evan', null, { for: 'sam', why: 'failed' })).toBe('opening')
  })
})
