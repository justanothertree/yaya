import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dayOfStart, moveNote, perExercise, setName, type ChronSet } from './sets'

/* ⚠️ PINNED, because one of these is a LOCAL day that is not the UTC one */
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

/** every field away from its default, so a rule reading the wrong one has somewhere to be wrong */
const set = (over: Partial<ChronSet> = {}): ChronSet => ({
  id: 's1',
  entry: 'e1',
  person: 'p1',
  exercise: 'ex-quad',
  name: 'Quad Curl',
  now: 'Quad Curls',
  on: '2026-11-07',
  value: 12,
  ...over,
})

describe('what a set is called', () => {
  it("is the exercise's name today while the exercise exists", () => {
    expect(setName(set())).toBe('Quad Curls')
  })

  it('is the name it had when written, once the exercise is gone', () => {
    expect(setName(set({ now: null }))).toBe('Quad Curl')
  })
})

describe("one sitting's sets", () => {
  it('sum per exercise, in the order they were first counted', () => {
    const sets = [
      set({ id: 'a', value: 12 }),
      set({ id: 'b', exercise: 'ex-bench', name: 'Bench', now: 'Bench', value: 8 }),
      set({ id: 'c', value: 3 }),
      set({ id: 'd', entry: 'other', value: 100 }),
    ]
    expect(perExercise(sets, 'e1')).toEqual([
      { exercise: 'ex-quad', name: 'Quad Curls', total: 15 },
      { exercise: 'ex-bench', name: 'Bench', total: 8 },
    ])
  })

  /**
   * ⚠️ §15b: "Never reconnect exercises by matching names." The deleted Quad Curl and the one made
   * again in its place share a name and nothing else — two lines, never one sum.
   */
  it('keep two exercises apart that share a name', () => {
    const sets = [
      set({ id: 'old', exercise: 'ex-quad', now: null, value: 12 }),
      set({ id: 'new', exercise: 'ex-quad-2', now: 'Quad Curl', value: 5 }),
    ]
    expect(perExercise(sets, 'e1').map((x) => [x.exercise, x.name, x.total])).toEqual([
      ['ex-quad', 'Quad Curl', 12],
      ['ex-quad-2', 'Quad Curl', 5],
    ])
  })
})

describe('what the move dialog says (§15c)', () => {
  it('names the one exercise its sets stay with', () => {
    expect(moveNote([set({ now: 'Quad Curl' })], 'e1')).toBe(
      'The 12 Quad Curl stay with Quad Curl. Only the time moves.',
    )
  })

  it('lists several', () => {
    expect(
      moveNote(
        [
          set({ now: 'Quad Curl' }),
          set({ id: 'b', exercise: 'ex-bench', name: 'Bench', now: 'Bench', value: 8 }),
        ],
        'e1',
      ),
    ).toBe('Its sets stay what they are: 12 Quad Curl, 8 Bench. Only the time moves.')
  })

  it('says nothing for a sitting with no sets', () => {
    expect([moveNote([], 'e1'), moveNote([set({ entry: 'other' })], 'e1')]).toEqual([null, null])
  })
})

describe('the day a moved start sends with its sets', () => {
  it('is the local day of the new start, not the UTC one', () => {
    /* 11:30pm on 7 Nov in California is already the 8th in UTC */
    expect(dayOfStart('2026-11-08T07:30:00.000Z')).toBe('2026-11-07')
  })
})
