import { describe, expect, it } from 'vitest'
import { lowest } from './room'

/**
 * Who hosts, asked of ids alone (room.ts's `lowest`).
 *
 * ⚠️ THE EXPECTATION COMES FROM THE IDS' SHAPE, NOT FROM A SORT. An id here is what Supabase
 * issues: a uuid, 32 lowercase hex digits in fixed groups, so "lowest" is the smallest 128-bit
 * number. Each id below is made from a BigInt and the answer is the smallest BigInt, which shares
 * nothing with the string comparison the code makes — a sort in the wrong direction, or one that
 * leaves somebody out, cannot cancel out of both sides. The numbers differ in their first digit,
 * their last and the middle, and use the letters, so an id compared as anything but the whole
 * string is caught too.
 */
const N: bigint[] = [
  0x9f00_0000_0000_0000_0000_0000_0000_0001n,
  0x0000_0000_0000_0000_0000_0000_0000_000an,
  0x0000_0000_0000_0000_0000_0000_0000_00a0n,
  0x3c41_77e2_0b6d_4a1f_9e2c_5d80_17f3_aa42n,
  0x3c41_77e2_0b6d_4a1f_9e2c_5d80_17f3_aa41n,
  0xffff_ffff_ffff_ffff_ffff_ffff_ffff_fffen,
  0x0001_0000_0000_0000_0000_0000_0000_0000n,
]
const uuid = (n: bigint) => {
  const h = n.toString(16).padStart(32, '0')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const ID = N.map(uuid)
/** the id of the smallest number among `who` (indexes into N) */
const smallest = (who: number[]) => uuid(who.map((i) => N[i]).reduce((a, b) => (b < a ? b : a)))

/** every group of at least one from the call, by index */
const groups = (n: number) =>
  Array.from({ length: (1 << n) - 1 }, (_, m) =>
    Array.from({ length: n }, (_, i) => i).filter((i) => ((m + 1) >> i) & 1),
  )
/** the same people in three orders: as given, backwards, and rotated by one */
const orders = (xs: string[]) => [xs, [...xs].reverse(), [...xs.slice(1), ...xs.slice(0, 1)]]

describe('lowest: who hosts, from ids alone', () => {
  it('is the lowest id among me and the present, whoever I am and in any order', () => {
    let asked = 0
    for (const here of groups(N.length))
      for (const me of here) {
        const others = here.filter((i) => i !== me).map((i) => ID[i])
        for (const present of orders(others)) {
          expect(lowest(ID[me], present)).toBe(smallest(here))
          asked++
        }
      }
    // every group of the seven, every one of them as me, three orders each
    expect(asked).toBe(3 * 7 * 2 ** 6)
  })
  it('counts me: alone, I host; with everybody above me, I still do', () => {
    expect(lowest(ID[3], [])).toBe(ID[3])
    expect(lowest(ID[1], [ID[0], ID[5], ID[2]])).toBe(ID[1])
  })
  it('ignores anybody not present, however low their id', () => {
    // on the call, but not on this toy: ID[1] is the lowest id there is, and it is not asked
    expect(lowest(ID[0], [ID[5], ID[4]])).toBe(ID[4])
    expect(lowest(ID[0], [ID[5], ID[4]])).not.toBe(ID[1])
  })
  it('never ties: everyone works out the same host from their own seat, and only it is itself', () => {
    for (const here of groups(N.length)) {
      const others = (me: number) => here.filter((i) => i !== me).map((i) => ID[i])
      const answers = here.map((me) => lowest(ID[me], others(me)))
      expect(new Set(answers)).toEqual(new Set([smallest(here)]))
      expect(here.filter((me, k) => answers[k] === ID[me])).toHaveLength(1)
    }
  })
})
