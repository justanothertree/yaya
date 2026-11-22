import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  EMPTY,
  allCodes,
  consistent,
  dailySeed,
  guessFor,
  mark,
  randomCode,
  readSaved,
  seeded,
  valid,
  type Code,
  type Level,
  type Mark,
} from './codebreaker'

/** how many guesses a level takes to find `secret`, playing from every code there is */
function solve(secret: Code, level: Level, seed: number) {
  const rand = seeded(seed)
  let possible = allCodes(DEFAULT_RULES)
  for (let n = 1; n <= 20; n++) {
    const g = guessFor(possible, level, rand)
    const m = mark(secret, g)
    if (m.exact === DEFAULT_RULES.length) return n
    possible = consistent(possible, [{ guess: g, mark: m }])
    expect(possible).toContainEqual(secret)
  }
  throw new Error('never found it')
}

describe('marking a guess', () => {
  it('counts the right colour in the right place, then the right colour elsewhere, each peg once', () => {
    expect(mark([0, 0, 1], [0, 1, 1])).toEqual({ exact: 2, near: 0 })
    expect(mark([0, 1, 2, 3], [3, 2, 1, 0])).toEqual({ exact: 0, near: 4 })
    expect(mark([0, 0, 0, 1], [1, 1, 0, 0])).toEqual({ exact: 1, near: 2 })
    expect(mark([2, 2, 2, 2], [2, 2, 2, 2])).toEqual({ exact: 4, near: 0 })
    expect(mark([0, 1, 2, 3], [4, 5, 4, 5])).toEqual({ exact: 0, near: 0 })
  })
  it('is the same whichever way round, and never adds up to more than the code', () => {
    const rand = seeded(9)
    for (let k = 0; k < 400; k++) {
      const a = randomCode(DEFAULT_RULES, rand)
      const b = randomCode(DEFAULT_RULES, rand)
      const m: Mark = mark(a, b)
      expect(mark(b, a)).toEqual(m)
      expect(m.exact + m.near).toBeLessThanOrEqual(4)
    }
  })
})

describe('codes', () => {
  it('lists every code the rules allow, and no other', () => {
    expect(allCodes(DEFAULT_RULES)).toHaveLength(6 ** 4)
    const none = { ...DEFAULT_RULES, repeats: false }
    expect(allCodes(none)).toHaveLength(6 * 5 * 4 * 3)
    for (const c of allCodes(none)) expect(valid(c, none)).toBe(true)
    expect(valid([0, 0, 1, 2], none)).toBe(false)
    expect(valid([0, 1, 2], DEFAULT_RULES)).toBe(false)
    expect(valid([0, 1, 2, 6], DEFAULT_RULES)).toBe(false)
  })
  it("the day's code is the same all day and changes with the day", () => {
    const morning = new Date(2026, 10, 10, 7, 5)
    const night = new Date(2026, 10, 10, 23, 55)
    const tomorrow = new Date(2026, 10, 11, 7, 5)
    expect(dailySeed(morning)).toBe(dailySeed(night))
    expect(dailySeed(tomorrow)).not.toBe(dailySeed(morning))
    const a = randomCode(DEFAULT_RULES, seeded(dailySeed(morning)))
    expect(randomCode(DEFAULT_RULES, seeded(dailySeed(night)))).toEqual(a)
  })
})

describe('the computer', () => {
  // Measured over every one of the 1,296 codes: clever needed 4.48 guesses on average and 6 at
  // most; lucky (any code still possible) 4.67 and 7. With five places and eight colours, clever
  // averaged 5.8 and its slowest guess took 113 ms.
  it('always keeps your code among the possible ones, and clever finds it in six', () => {
    const rand = seeded(21)
    const codes = allCodes(DEFAULT_RULES)
    let clever = 0
    let lucky = 0
    for (let k = 0; k < 24; k++) {
      const secret = codes[Math.floor(rand() * codes.length)]
      const c = solve(secret, 'clever', k + 1)
      expect(c).toBeLessThanOrEqual(6)
      clever += c
      lucky += solve(secret, 'lucky', k + 1)
    }
    expect(clever).toBeLessThan(lucky)
  }, 60000)
})

describe('codebreaker saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      rules: { length: 5, colours: 8, repeats: false, tries: 12 },
      level: 'lucky',
      pegs: 'shapes',
      counting: true,
      spread: [2, 0, 1, 3, 9, 7, 4, 1, 0, 0, 0, 0, 0],
      daily: { day: '2026-11-10', guesses: 5 },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad, and never keeps impossible rules', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    const back = readSaved(
      JSON.stringify({
        rules: { length: 5, colours: 4, repeats: false },
        daily: { day: 'today', guesses: 3 },
        counting: true,
      }),
    )
    expect(back.rules).toEqual({ length: 5, colours: 4, repeats: true, tries: 10 })
    expect(back.daily).toBeNull()
    expect(back.counting).toBe(true)
  })
})
