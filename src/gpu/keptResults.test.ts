import { describe, expect, it } from 'vitest'
import { NOTHING, easier, readSaved as readGust, scored, type Saved } from './gust'
import { EMPTY as NO_FLIGHT, keptBest, readSaved as readTunnel, slower } from './tunnel'
import { fewestBars, readBest } from './strut'
import { NO_QUIZ, answered, readQuiz } from './wallpaper'

/*
 * The four toys that keep a result only so it can be shared: what each writes, and that reading it
 * back gives the same thing. Every field of each fixture is something other than its default, so a
 * reader that drops one turns this red.
 */
describe('results kept for sharing', () => {
  it('gust: a match counts at the easiest level it was played at, and a shutout only when won 5–0', () => {
    expect(easier('sharp', 'gentle')).toBe('gentle')
    expect(easier('keen', 'sharp')).toBe('keen')
    let s: Saved = { ...NOTHING, level: 'sharp' }
    s = scored(s, 'sharp', [5, 0])
    s = scored(s, 'sharp', [5, 3])
    s = scored(s, 'gentle', [2, 5])
    expect(s.record.sharp).toEqual({ won: 2, lost: 0, shutouts: 1 })
    expect(s.record.gentle).toEqual({ won: 0, lost: 1, shutouts: 0 })
    expect(s.record.keen).toEqual({ won: 0, lost: 0, shutouts: 0 })
    expect(readGust(JSON.stringify(s))).toEqual(s)
  })
  it('gust: refuses what it did not write', () => {
    expect(readGust(null)).toEqual(NOTHING)
    expect(readGust('{')).toEqual(NOTHING)
    const odd = readGust(
      JSON.stringify({ level: 'wild', record: { keen: { won: 2, lost: -1, shutouts: 9 } } }),
    )
    expect(odd.level).toBe(NOTHING.level)
    expect(odd.record.keen).toEqual({ won: 2, lost: 0, shutouts: 2 })
  })
  it('tunnel: a streak counts at the slowest speed flown, and a best never goes down', () => {
    expect(slower('warp', 'cruise')).toBe('cruise')
    expect(slower('fast', 'warp')).toBe('fast')
    let s = keptBest(NO_FLIGHT, 'warp', 9)
    s = keptBest(s, 'cruise', 31)
    s = keptBest(s, 'fast', 4)
    s = keptBest(s, 'warp', 3)
    expect(s.best).toEqual({ cruise: 31, fast: 4, warp: 9 })
    expect(readTunnel(JSON.stringify(s))).toEqual(s)
    expect(readTunnel('{"best":{"warp":2.5,"fast":"7"}}')).toEqual(NO_FLIGHT)
  })
  it('strut: the fewest bars, kept as a positive number or nothing', () => {
    expect(fewestBars(null, 4.2)).toBe(4.2)
    expect(fewestBars(4.2, 5)).toBe(4.2)
    expect(fewestBars(4.2, 3.1)).toBe(3.1)
    expect(readBest(JSON.stringify(3.1))).toBe(3.1)
    for (const bad of [null, '{', '0', '-2', '"3"', '1e9', 'null'])
      expect(readBest(bad), String(bad)).toBeNull()
  })
  it('wallpaper: right of asked, and the best run, which no answer lowers', () => {
    let q = NO_QUIZ
    q = answered(q, true, 1)
    q = answered(q, true, 2)
    q = answered(q, false, 0)
    q = answered(q, true, 1)
    expect(q).toEqual({ right: 3, asked: 4, bestRun: 2 })
    expect(readQuiz(JSON.stringify(q))).toEqual(q)
    expect(readQuiz(JSON.stringify({ right: 9, asked: 4, bestRun: 7 }))).toEqual({
      right: 4,
      asked: 4,
      bestRun: 4,
    })
    expect(readQuiz('[]')).toEqual(NO_QUIZ)
  })
})
