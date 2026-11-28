import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMyAllocations, fetchMyTrades } from './portfolio'

/**
 * The trades ledger's two reads, asked what they say when the sign-in check fails.
 *
 * ⚠️ THE BUG THIS PINS (audit of 27 Nov 2026, `portfolio.ts:252`): supabase-js answers a failed
 * `auth.getUser()` — a timeout, a 5xx, a dropped connection — as `{ data: { user: null }, error }`
 * rather than throwing, and `fetchMyAllocations` read that `null` as "nobody is signed in, so
 * there is nothing to show" and resolved `[]`. The ledger then said "Nothing assigned yet — all N
 * units are still yours" about every trade, and `insert_allocation` ADDS rows, so an admin
 * re-assigning what looked lost wrote a second copy of it. A failure must arrive as a failure.
 *
 * The client is a stand-in shaped like supabase-js's own answers, so the question is only about
 * what these functions do with them.
 */

type Answer = { data: unknown; error: unknown }

const fake = vi.hoisted(() => ({
  user: { data: { user: { id: 'evan' } }, error: null } as Answer,
  /** one answer per page, in order; a page past the end is an empty one */
  pages: [] as Answer[],
  asked: [] as Array<{ fn: string; uid: unknown; from: number; to: number }>,
}))

vi.mock('./client', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => fake.user },
    rpc: (fn: string, args: { uid?: unknown }) => ({
      range: async (from: number, to: number) => {
        fake.asked.push({ fn, uid: args.uid, from, to })
        return fake.pages.shift() ?? { data: [], error: null }
      },
    }),
  }),
}))

/** what supabase-js hands back when the round trip to /auth/v1/user did not work */
const SIGN_IN_CHECK_FAILED: Answer = {
  data: { user: null },
  error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
}

const allocation = (n: number) => ({
  id: `a${n}`,
  family_account_id: `acct-${n % 3}`,
  executed_trade_id: `t${n}`,
  units_allocated: n + 0.5,
})

beforeEach(() => {
  fake.user = { data: { user: { id: 'evan' } }, error: null }
  fake.pages = []
  fake.asked = []
})

describe('the allocations read, when the sign-in check fails', () => {
  it('is a failure, never an empty list of allocations', async () => {
    fake.user = SIGN_IN_CHECK_FAILED
    await expect(fetchMyAllocations()).rejects.toMatchObject({ message: 'Failed to fetch' })
    // and it never went on to ask for allocations as nobody
    expect(fake.asked).toEqual([])
  })

  it('is a failure when the check names no user, even without an error', async () => {
    fake.user = { data: { user: null }, error: null }
    await expect(fetchMyAllocations()).rejects.toThrow()
  })

  it('is a failure when a later page fails, not the pages before it', async () => {
    fake.pages = [
      { data: Array.from({ length: 1000 }, (_, i) => allocation(i)), error: null },
      { data: null, error: { message: 'canceling statement due to statement timeout' } },
    ]
    await expect(fetchMyAllocations()).rejects.toMatchObject({
      message: 'canceling statement due to statement timeout',
    })
  })
})

describe('the allocations read, when it works', () => {
  it('returns every row across pages, for the signed-in owner', async () => {
    // the control: the stand-in is faithful enough that a good read comes back whole
    fake.pages = [
      { data: Array.from({ length: 1000 }, (_, i) => allocation(i)), error: null },
      { data: [allocation(1000), allocation(1001)], error: null },
    ]
    const rows = await fetchMyAllocations()
    expect(rows).toHaveLength(1002)
    expect(rows[1001]).toEqual({
      id: 'a1001',
      familyAccountId: 'acct-2',
      executedTradeId: 't1001',
      unitsAllocated: 1001.5,
    })
    expect(fake.asked.map((a) => [a.fn, a.uid, a.from])).toEqual([
      ['get_allocations', 'evan', 0],
      ['get_allocations', 'evan', 1000],
    ])
  })

  it('an owner with no allocations at all is an empty list, and only then', async () => {
    fake.pages = [{ data: [], error: null }]
    await expect(fetchMyAllocations()).resolves.toEqual([])
  })
})

describe('the trades read beside it, when the sign-in check fails', () => {
  // the same load fills the ledger's trade list; a failure read "No trades yet" (audit :233)
  it('is a failure, never an empty trade history', async () => {
    fake.user = SIGN_IN_CHECK_FAILED
    await expect(fetchMyTrades()).rejects.toMatchObject({ message: 'Failed to fetch' })
    expect(fake.asked).toEqual([])
  })
})
