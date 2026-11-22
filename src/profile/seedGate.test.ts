import { describe, expect, it } from 'vitest'
import { doorFor, seedFrom } from './seedGate'

/**
 * The editor's gate, asked with what `get_profile_blocks` really answers: the owner gets an array
 * of names in `certain` on every block (`[]` with none), a visitor gets `null` there, and an unknown
 * name gets `[]` with no error (CLAUDE.md §3: never leak whether a member exists).
 */

const mine = [
  { id: 'a', block_type: 'bio', certain: [] },
  { id: 'b', block_type: 'song', certain: ['sam', 'robin'] },
]
const theirs = [
  { id: 'c', block_type: 'bio', certain: null },
  { id: 'd', block_type: 'song', certain: null },
]

describe('what the editor may start from', () => {
  it('your page as the owner reads it', () => {
    expect(seedFrom({ data: mine, error: null })).toEqual({ ok: true, blocks: mine })
  })

  it('an empty page, on the profile’s word that it is yours', () => {
    expect(seedFrom({ data: [], error: null })).toEqual({ ok: true, blocks: [] })
  })

  it('never a read that failed, which used to leave the editor starting empty', () => {
    expect(seedFrom({ data: null, error: new Error('offline') })).toEqual({
      ok: false,
      why: 'failed',
    })
    /* an error with an array beside it is still an error */
    expect(seedFrom({ data: [], error: { message: 'nope' } })).toEqual({ ok: false, why: 'failed' })
    expect(seedFrom({ data: { not: 'a list' }, error: null })).toEqual({ ok: false, why: 'failed' })
  })

  it('never a visitor’s view of a page, which saved from would put their blocks on yours', () => {
    expect(seedFrom({ data: theirs, error: null })).toEqual({ ok: false, why: 'not-yours' })
    /* one block without its list is enough */
    expect(seedFrom({ data: [mine[0], theirs[1]], error: null })).toEqual({
      ok: false,
      why: 'not-yours',
    })
    expect(seedFrom({ data: [null], error: null })).toEqual({ ok: false, why: 'not-yours' })
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
    expect(doorFor('evan', null, { for: 'sam', why: 'failed' })).toBe('opening')
  })
})
