import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kept, Seen } from './cloud'

/**
 * What `seen.ts` promises, asked of it directly.
 *
 * ⚠️ THE ONE QUESTION WORTH ASKING IS WHETHER ABSENCE IS CACHED FOR THE RIGHT REASON. A miss and
 * a failure arrive in the same shape — no row for that id — and the module has to treat them
 * oppositely: remember the miss, so a render loop does not ask for ever about an id that can
 * never be answered; forget the failure, so one dropped connection does not pin a real
 * photograph as missing for the next 45 minutes. A test that only checked "returns null when
 * there is nothing" would pass against both behaviours, including the wrong one.
 *
 * The transport is mocked because the thing under test is the batching and the caching, and
 * neither needs an edge function to have an opinion about it.
 */
vi.mock('./cloud', () => ({ seenPictures: vi.fn() }))

const { seenPictures } = await import('./cloud')
const { pictureById, forgetPicture, forgetAllPictures } = await import('./seen')

const asked = () => vi.mocked(seenPictures).mock.calls.map((c) => c[0])

const pic = (id: string): Kept => ({
  id,
  w: 8,
  h: 8,
  alt: null,
  bytes: 10,
  created_at: '2026-10-27T00:00:00Z',
  url: 'https://r2.example/' + id,
  thumbUrl: 'https://r2.example/' + id + '-t',
})

/** the happy transport: every id asked for exists */
const answers = (found: string[] = []): Seen => ({ pictures: found.map(pic), failed: false })

beforeEach(() => {
  vi.useFakeTimers()
  forgetAllPictures()
  vi.mocked(seenPictures).mockReset()
})
afterEach(() => void vi.useRealTimers())

/** let the 30ms debounce fire and the promises behind it settle */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(40)
}

describe('batching', () => {
  it('sends ids asked for in the same tick as ONE call', async () => {
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const both = Promise.all([pictureById('a'), pictureById('b')])
    await settle()
    await both
    expect(asked()).toHaveLength(1)
    expect(asked()[0]).toEqual(['a', 'b'])
  })

  it('asks for a repeated id once, and answers everyone who asked', async () => {
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const three = Promise.all([pictureById('a'), pictureById('a'), pictureById('a')])
    await settle()
    const got = await three
    expect(asked()[0]).toEqual(['a'])
    expect(got.map((g) => g?.id)).toEqual(['a', 'a', 'a'])
  })

  /** the cap is the op's own; a page may hold more photographs than one request carries */
  it('splits a batch over the per-call cap instead of truncating it', async () => {
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const ids = Array.from({ length: 130 }, (_, i) => 'p' + i)
    const all = Promise.all(ids.map(pictureById))
    await settle()
    const got = await all
    expect(asked().map((c) => c.length)).toEqual([60, 60, 10])
    /* every one of the 130 came back — nothing was dropped off the end */
    expect(got.filter(Boolean)).toHaveLength(130)
    expect(asked().flat().sort()).toEqual([...ids].sort())
  })
})

describe('the miss cache', () => {
  it('remembers that an id has no picture, and stops asking', async () => {
    vi.mocked(seenPictures).mockResolvedValue(answers([]))
    const first = pictureById('gone')
    await settle()
    expect(await first).toBeNull()

    const second = pictureById('gone')
    await settle()
    expect(await second).toBeNull()
    expect(asked()).toHaveLength(1)
  })

  it('serves a found picture from the cache rather than asking twice', async () => {
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const first = pictureById('a')
    await settle()
    expect((await first)?.id).toBe('a')

    const second = pictureById('a')
    await settle()
    expect((await second)?.id).toBe('a')
    expect(asked()).toHaveLength(1)
  })

  it('asks again after the id is forgotten', async () => {
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const first = pictureById('a')
    await settle()
    await first
    forgetPicture('a')
    const second = pictureById('a')
    await settle()
    await second
    expect(asked()).toHaveLength(2)
  })

  /** a signed url outlives the cache by 15 minutes, never the other way round */
  it('asks again once the entry is stale', async () => {
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const first = pictureById('a')
    await settle()
    await first

    vi.setSystemTime(new Date('2026-10-27T12:44:00Z'))
    const fresh = pictureById('a')
    await settle()
    await fresh
    expect(asked(), 'still fresh at 44 minutes').toHaveLength(1)

    vi.setSystemTime(new Date('2026-10-27T12:46:00Z'))
    const stale = pictureById('a')
    await settle()
    await stale
    expect(asked(), 'stale at 46 minutes').toHaveLength(2)
  })
})

describe('a failed call is not an answer', () => {
  it('does NOT cache absence when the call failed', async () => {
    vi.mocked(seenPictures).mockResolvedValueOnce({ pictures: [], failed: true })
    const first = pictureById('a')
    await settle()
    expect(await first, 'nothing to draw this time round').toBeNull()

    /* the id was never established as missing, so the next draw must ask again — and can win */
    vi.mocked(seenPictures).mockImplementation(async (ids) => answers(ids))
    const second = pictureById('a')
    await settle()
    expect((await second)?.id, 'the photograph was there all along').toBe('a')
    expect(asked()).toHaveLength(2)
  })

  it('keeps a failing id askable however many times it fails', async () => {
    vi.mocked(seenPictures).mockResolvedValue({ pictures: [], failed: true })
    for (let i = 0; i < 3; i++) {
      const p = pictureById('a')
      await settle()
      expect(await p).toBeNull()
    }
    expect(asked()).toHaveLength(3)
  })

  /**
   * ⚠️ ONE CHUNK FAILING MUST NOT POISON THE OTHERS. They are separate calls, so a page of 90
   * photographs can have its first 60 arrive and its last 30 not — and the 60 that arrived are
   * a real answer that should be kept.
   */
  it('caches the chunks that succeeded and leaves the failed one unknown', async () => {
    vi.mocked(seenPictures).mockImplementation(async (ids) =>
      ids.includes('p0') ? answers(ids) : { pictures: [], failed: true },
    )
    const ids = Array.from({ length: 90 }, (_, i) => 'p' + i)
    const all = Promise.all(ids.map(pictureById))
    await settle()
    await all
    expect(asked().map((c) => c.length)).toEqual([60, 30])

    vi.mocked(seenPictures).mockClear()
    const again = Promise.all(ids.map(pictureById))
    await settle()
    await again
    /* only the 30 that failed are asked for a second time */
    expect(asked()).toHaveLength(1)
    expect(asked()[0]).toHaveLength(30)
  })
})
