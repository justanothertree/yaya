import { describe, expect, it } from 'vitest'
import { DAY_MINS, scoreOf, type Counted } from './score'

const row = (cat: Counted['cat'], mins: number): Counted => ({ cat, mins })

describe("a day's score", () => {
  /**
   * Every expectation is written as the sentence the rail says, not as the sum the function makes:
   * ninety minutes of a two-hour day is three quarters of it, and two hours of a day is a twelfth
   * of twenty-four.
   */
  it('adds up every minute written down', () => {
    const s = scoreOf([row('locked', 90), row('free', 20), row('life', 10)])
    expect(s.logged).toBe(120)
  })

  it('counts only Locked In as focused', () => {
    const s = scoreOf([row('locked', 90), row('free', 20), row('life', 10)])
    expect(s.focused).toBe(90)
    /* ninety of a hundred and twenty is three quarters */
    expect(s.share).toBeCloseTo(75, 6)
  })

  it('says how much of the whole day is written down', () => {
    const s = scoreOf([row('locked', 60), row('free', 60)])
    /* two hours of twenty-four */
    expect(s.covered).toBeCloseTo((2 / 24) * 100, 6)
    expect(DAY_MINS).toBe(1440)
  })

  /**
   * ⚠️ THE ONE THAT MATTERS ON THE FIRST SCREEN. A new member has recorded nothing, so this is
   * 0/0 — and "NaN%" at the top of the rail is worse than any number it could show.
   */
  it('has no share at all on a day with nothing in it, rather than NaN or zero', () => {
    const s = scoreOf([])
    expect(s).toEqual({ logged: 0, focused: 0, share: null, covered: 0 })
  })

  it('is zero and not null when a real amount was logged and none of it was focused', () => {
    const s = scoreOf([row('free', 45)])
    expect(s.share).toBe(0)
    expect(s.logged).toBe(45)
  })

  /**
   * ⚠️ THE ONE THE ROOM ACTUALLY SHOWED. Two seconds after pressing Start the rail read "100%
   * Locked In" above "Focused 0s" and "Written down 0s" — right arithmetic, four contradicting
   * statements. A proportion needs something to be a proportion of, and a minute is the unit this
   * room writes everything else in.
   */
  it('has no share under a minute, however focused that scrap was', () => {
    expect(scoreOf([row('locked', 2 / 60)]).share).toBe(null)
    expect(scoreOf([row('locked', 0.99)]).share).toBe(null)
    /* and the minutes themselves are still counted — only the proportion is withheld */
    expect(scoreOf([row('locked', 0.5)]).logged).toBeCloseTo(0.5, 6)
  })

  it('has a share from exactly a minute', () => {
    expect(scoreOf([row('locked', 1)]).share).toBeCloseTo(100, 6)
    expect(scoreOf([row('free', 1)]).share).toBe(0)
  })

  /** totals list every activity, including ones with no time — those are not a day's worth of 0s */
  it('ignores rows with no minutes in them', () => {
    const s = scoreOf([row('locked', 60), row('free', 0), row('life', 0)])
    expect(s.logged).toBe(60)
    expect(s.share).toBeCloseTo(100, 6)
  })

  /**
   * ⚠️ OVERLAPPING SESSIONS ARE ALLOWED, so an unclamped day can read "137% written down" — a
   * number that looks like a fault rather than a full one. The same clamp the week grid keeps.
   */
  it('never claims more than a whole day is written down', () => {
    const s = scoreOf([row('locked', DAY_MINS), row('free', 600)])
    expect(s.covered).toBe(100)
    /* but the minutes themselves are not clamped — the day really does hold that much */
    expect(s.logged).toBe(DAY_MINS + 600)
  })

  it('treats a day that is exactly full as full', () => {
    expect(scoreOf([row('locked', DAY_MINS)]).covered).toBe(100)
  })
})
