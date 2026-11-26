import { describe, expect, it } from 'vitest'
import type { ProfileBlock } from '../sections/ProfileBlocks'
import {
  classify,
  duplicatePositions,
  expectStored,
  ownerOf,
  preflight,
  sameStored,
  storedNames,
  missingFunction,
  pageChanged,
} from './pageStore'

/**
 * What the server says a page is. The fixture is off its defaults in every field (CLAUDE.md §2: a
 * round trip is only worth the fields its fixture fills), and each mapping was dropped once and
 * watched go red.
 */

type Block = ProfileBlock

const names = ['  Sam ', 'robin', 'SAM', ...Array.from({ length: 60 }, (_, i) => `Friend${i}`)]
const page: Block[] = [
  { block_type: 'bio', size: 'small', config: { text: 'hi', font: 'mono' }, visibility: 'public' },
  {
    block_type: 'song',
    size: 'large',
    config: { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } },
    visibility: 'certain',
    certain: names,
  },
  {
    block_type: 'status',
    size: 'medium',
    config: undefined as unknown as Block['config'],
    visibility: 'private',
  },
  { block_type: 'art', size: 'medium', config: { k: 'v' }, visibility: 'members' },
]
/* what a save of `page` answers: the second block's tier clamped to friends */
const answer = [
  { position: 1, visibility: 'public' },
  { position: 2, visibility: 'friends' },
  { position: 3, visibility: 'private' },
  { position: 4, visibility: 'members' },
]

describe('whose read it is', () => {
  it('the owner’s, when every block carries its list; anybody else’s when one does not', () => {
    expect(ownerOf([{ certain: [] }, { certain: ['sam'] }])).toBe('owner')
    expect(ownerOf([{ certain: null }, { certain: null }])).toBe('not-yours')
    expect(ownerOf([{ certain: [] }, { certain: null }])).toBe('not-yours')
    expect(ownerOf([])).toBe('empty')
    expect(ownerOf(null)).toBe('invalid')
  })
})

describe('what a save stored', () => {
  it('each block as sent, with the tier the server answered and the list as it keeps lists', () => {
    const exp = expectStored(page, answer)
    if (exp.kind !== 'ok') throw new Error(exp.kind)
    expect(exp.page.map((b) => [b.block_type, b.size, b.visibility])).toEqual([
      ['bio', 'small', 'public'],
      ['song', 'large', 'friends'],
      ['status', 'medium', 'private'],
      ['art', 'medium', 'members'],
    ])
    expect(exp.page[0].config).toEqual({ text: 'hi', font: 'mono' })
    expect(exp.page[2].config).toEqual({})
    expect(exp.narrowed).toEqual([1])
    /* clamped out of certain: no list is kept */
    expect(exp.page[1].certain).toEqual([])
    expect(exp.lists).toBe('exact')
  })

  it('a list kept the way the server keeps it: 50 at most, trimmed, lower-cased, distinct', () => {
    const keep = storedNames(names)
    expect(keep).toContain('sam')
    expect(keep.filter((n) => n === 'sam')).toHaveLength(1)
    /* the first 50 sent, of which two were the same person */
    expect(keep).toHaveLength(49)
    expect(keep.every((n) => n === n.trim().toLowerCase())).toBe(true)
    const exp = expectStored([page[1]], [{ position: 1, visibility: 'certain' }])
    if (exp.kind !== 'ok') throw new Error(exp.kind)
    expect(exp.page[0].certain).toEqual(keep)
    /* the server may drop names that are not friends, so a list with names is only "sent" */
    expect(exp.lists).toBe('sent')
  })

  it('two saves overlapping, or an answer that is not one: never believed', () => {
    expect(expectStored(page, [...answer, ...answer]).kind).toBe('collided')
    expect(
      expectStored(page, [answer[0], answer[1], answer[2], { ...answer[3], position: 5 }]).kind,
    ).toBe('collided')
    expect(expectStored(page, [answer[0], answer[0], answer[2], answer[3]]).kind).toBe('collided')
    expect(expectStored(page, null).kind).toBe('unacknowledged')
  })
})

describe('comparing a page read back', () => {
  const stored = (expectStored(page, answer) as { page: Block[] }).page
  /* the same page as the server sends it back: keys in its own order, names in its own case */
  /* every object's keys in reverse order, all the way down, as jsonb may hand them back */
  const reversed = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reversed)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .reverse()
              .map((k) => [k, reversed((v as Record<string, unknown>)[k])]),
          )
        : v
  const readBack: Block[] = stored.map((b) => ({
    ...b,
    config: reversed(b.config) as Block['config'],
  }))

  it('the same page whatever order its keys come back in', () => {
    expect(sameStored(readBack, stored, 'exact')).toBe(true)
    expect(
      sameStored(
        [{ ...stored[0], config: { font: 'mono', text: 'hi' } }, ...stored.slice(1)],
        stored,
        'exact',
      ),
    ).toBe(true)
  })

  it('a different page when any one thing differs', () => {
    expect(sameStored([{ ...stored[0], size: 'large' }, ...stored.slice(1)], stored, 'exact')).toBe(
      false,
    )
    expect(
      sameStored([{ ...stored[0], block_type: 'status' }, ...stored.slice(1)], stored, 'exact'),
    ).toBe(false)
    expect(
      sameStored(
        [{ ...stored[0], config: { text: 'hj', font: 'mono' } }, ...stored.slice(1)],
        stored,
        'exact',
      ),
    ).toBe(false)
    expect(
      sameStored([{ ...stored[0], visibility: 'members' }, ...stored.slice(1)], stored, 'exact'),
    ).toBe(false)
    expect(sameStored(stored.slice(1), stored, 'exact')).toBe(false)
  })

  it('a list read back shorter than the one sent only when the comparison allows for it', () => {
    const sent: Block[] = [
      { ...page[1], visibility: 'certain', certain: ['Sam', 'robin', 'stranger'] },
    ]
    const back: Block[] = [{ ...sent[0], certain: ['robin', 'Sam'] }]
    expect(sameStored(back, sent, 'exact')).toBe(false)
    expect(sameStored(back, sent, 'sent')).toBe(true)
    /* but never a name that was not sent */
    expect(sameStored([{ ...sent[0], certain: ['someone else'] }], sent, 'sent')).toBe(false)
  })

  it('a tier read back narrower only for a save whose answer never came', () => {
    const sent: Block[] = [{ ...page[0], visibility: 'public' }]
    const back: Block[] = [{ ...sent[0], visibility: 'friends' }]
    expect(sameStored(back, sent, 'sent')).toBe(false)
    expect(sameStored(back, sent, 'at-most')).toBe(true)
    expect(sameStored(sent, back, 'at-most')).toBe(false)
  })
})

describe('what an answer means', () => {
  it('no answer and a failed server are unreachable; a refusal is not', () => {
    expect(classify({ status: 0, error: { message: 'Failed to fetch' } })).toBe('unreachable')
    expect(classify({ status: 503, error: { message: 'down' } })).toBe('unreachable')
    expect(classify({ status: 520, error: { message: 'x' } })).toBe('unreachable')
    expect(classify({ status: 400, error: { message: 'invalid block' } })).toBe('refused')
    expect(classify({ status: 401, error: { message: 'x' } })).toBe('auth')
    expect(classify({ status: 200, error: null })).toBe('ok')
  })
})

describe('what is refused before it is sent', () => {
  it('names what to fix', () => {
    const big = {
      block_type: 'bio' as const,
      size: 'medium' as const,
      visibility: 'members' as const,
      config: { text: 'x'.repeat(70000) },
    }
    expect(preflight([page[0], big])).toEqual({ why: 'block too big', at: 1 })
    expect(preflight(Array.from({ length: 21 }, () => page[0]))).toEqual({ why: 'too many blocks' })
    const songs = Array.from({ length: 25 }, () => ({}))
    expect(preflight([{ ...page[1], config: { songs } }])).toEqual({ why: 'too many songs', at: 0 })
    expect(preflight(page)).toBeNull()
  })

  it('a page saved twice at once shows its rows twice', () => {
    expect(
      duplicatePositions([
        { ...page[0], position: 1 } as Block,
        { ...page[1], position: 1 } as Block,
      ]),
    ).toBe(true)
    expect(
      duplicatePositions([
        { ...page[0], position: 1 } as Block,
        { ...page[1], position: 2 } as Block,
      ]),
    ).toBe(false)
  })
})

describe('the answers that are not about the page', () => {
  it("knows PostgREST's no-such-function, and nothing else, as missing", () => {
    expect(
      missingFunction({
        status: 404,
        error: {
          code: 'PGRST202',
          message:
            'Could not find the function public.my_profile_page_version without parameters in the schema cache',
        },
      }),
    ).toBe(true)
    /* a rollback, in the moment PostgREST's cache still lists the function */
    expect(
      missingFunction({
        status: 404,
        error: {
          code: '42883',
          message:
            'function public.save_my_profile_blocks(p_blocks => jsonb, p_expected_page => text) does not exist',
        },
      }),
    ).toBe(true)
    expect(missingFunction({ status: 200, error: null })).toBe(false)
    expect(missingFunction({ status: 404, error: { code: 'PGRST116', message: 'no rows' } })).toBe(
      false,
    )
    expect(
      missingFunction({ status: 409, error: { code: 'PT409', message: 'page changed' } }),
    ).toBe(false)
  })

  it("knows the save's own refusal as page changed, and no other refusal", () => {
    expect(
      pageChanged({
        status: 409,
        error: { code: 'PT409', message: 'page changed', hint: 'read the page again' },
      }),
    ).toBe(true)
    expect(pageChanged({ status: 400, error: { code: 'P0001', message: 'invalid block' } })).toBe(
      false,
    )
    expect(
      pageChanged({ status: 400, error: { code: 'P0001', message: 'profile too large' } }),
    ).toBe(false)
    expect(pageChanged({ status: 200, error: null })).toBe(false)
  })
})
