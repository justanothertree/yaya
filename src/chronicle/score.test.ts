import { describe, expect, it } from 'vitest'
import { scoreOf, type Counted } from './score'

const row = (cat: Counted['cat'], mins: number): Counted => ({ cat, mins })

describe("a day's score", () => {
  /**
   * Every expectation is written as the sentence the rail says, not as the sum the function makes:
   * ninety minutes of a two-hour day is three quarters of it, and two hours of a day is a twelfth
   * of twenty-four.
   */
  it('adds up every minute written down', () => {
    const s = scoreOf([row('locked', 90), row('free', 20), row('life', 10)], 0)
    expect(s.logged).toBe(120)
  })

  it('counts only Locked In as focused', () => {
    const s = scoreOf([row('locked', 90), row('free', 20), row('life', 10)], 0)
    expect(s.focused).toBe(90)
    /* ninety of a hundred and twenty is three quarters */
    expect(s.share).toBeCloseTo(75, 6)
  })

  /**
   * ⚠️ `covered` IS CARRIED, NOT COMPUTED, so the only thing to assert here is that it arrives
   * untouched. It used to be `min(100, logged / 1440)` — a sum over a constant, wrong in both
   * halves — and the rule that replaced it is tested beside `coveredMs` in record.test.ts, which
   * is where the spans are. A second opinion about coverage in this file is what let the old one
   * disagree with the week grid in the first place.
   */
  it('carries the coverage it was handed, without a second opinion about it', () => {
    expect(scoreOf([row('locked', 60), row('free', 60)], 33.75).covered).toBe(33.75)
    /* and nothing about the rows can move it: these are nine hours against a 33.75% day */
    expect(scoreOf([row('locked', 540)], 33.75).covered).toBe(33.75)
  })

  /**
   * ⚠️ THE ONE THAT MATTERS ON THE FIRST SCREEN. A new member has recorded nothing, so this is
   * 0/0 — and "NaN%" at the top of the rail is worse than any number it could show.
   */
  it('has no share at all on a day with nothing in it, rather than NaN or zero', () => {
    const s = scoreOf([], 0)
    expect(s).toEqual({ logged: 0, focused: 0, share: null, covered: 0 })
  })

  it('is zero and not null when a real amount was logged and none of it was focused', () => {
    const s = scoreOf([row('free', 45)], 0)
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
    expect(scoreOf([row('locked', 2 / 60)], 0).share).toBe(null)
    expect(scoreOf([row('locked', 0.99)], 0).share).toBe(null)
    /* and the minutes themselves are still counted — only the proportion is withheld */
    expect(scoreOf([row('locked', 0.5)], 0).logged).toBeCloseTo(0.5, 6)
  })

  it('has a share from exactly a minute', () => {
    expect(scoreOf([row('locked', 1)], 0).share).toBeCloseTo(100, 6)
    expect(scoreOf([row('free', 1)], 0).share).toBe(0)
  })

  /** totals list every activity, including ones with no time — those are not a day's worth of 0s */
  it('ignores rows with no minutes in them', () => {
    const s = scoreOf([row('locked', 60), row('free', 0), row('life', 0)], 0)
    expect(s.logged).toBe(60)
    expect(s.share).toBeCloseTo(100, 6)
  })

  /**
   * ⚠️ THE MINUTES ARE NOT CLAMPED AND MUST NOT BE, which is the half of the old behaviour worth
   * keeping. Overlapping sessions are allowed — a podcast while washing up is two activities over
   * the same minutes — so a day can hold more logged time than it has hours, and "Written down
   * 34h" is the honest reading of a day somebody spent that much attention on.
   *
   * What was wrong was applying the same sum to the figure that says "of the day". That one asks
   * which MINUTES are spoken for and is now a union, so it cannot exceed its window and has
   * nothing to clamp.
   */
  it('does not clamp the minutes, however much of them there are', () => {
    const s = scoreOf([row('locked', 24 * 60), row('free', 600)], 100)
    expect(s.logged).toBe(24 * 60 + 600)
    expect(s.focused).toBe(24 * 60)
    expect(s.covered).toBe(100)
  })
})
