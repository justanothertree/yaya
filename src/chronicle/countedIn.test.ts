import { describe, expect, it } from 'vitest'
import { countedIn, type ChronSet } from './sets'

const set = (over: Partial<ChronSet>): ChronSet => ({
  id: 's',
  entry: 'e1',
  person: 'p',
  exercise: 'x',
  name: 'Run',
  now: 'Run',
  on: '2026-11-11',
  value: 1,
  counted: true,
  ...over,
})

/**
 * The floor a sitting's count may not go below, which the sitting editor disables Save under. The
 * server sums counted sets in `numeric`, exactly, so the room's copy has to land on the same number:
 * a floor of 3.3000000000000003 under an amount of 3.3 would say the sitting is already below it.
 */
describe("the floor a sitting's counted sets hold", () => {
  it('is their sum in decimals, the way the server adds them', () => {
    expect(countedIn([set({ value: 1.1 }), set({ value: 2.2 })], 'e1')).toBe(3.3)
    expect(countedIn([set({ value: 0.1 }), set({ value: 0.2 })], 'e1')).toBe(0.3)
  })

  it('and holds no set that is not counted or belongs to another sitting', () => {
    const sets = [
      set({ value: 5 }),
      set({ value: 7, counted: false }),
      set({ value: 9, entry: 'e2' }),
      set({ value: 3, entry: null }),
    ]
    expect(countedIn(sets, 'e1')).toBe(5)
  })
})
