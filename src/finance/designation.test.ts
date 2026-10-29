import { describe, expect, it } from 'vitest'
import { designationPlan, type Designated } from './designation'

/**
 * ⚠️ THE NUMBERS HERE ARE THE LIVE FUND'S, measured 28 Oct 2026, because the point of this
 * sentence is that it is true about the thing being deleted. SPCE on Cash App really is 6,006
 * allocation rows across all 33 accounts.
 */
const SPCE: Designated = {
  symbol: 'SPCE',
  platform: 'cashapp',
  familyRows: 6006,
  familyUnits: 1870.5469,
}

describe('taking a symbol back from the family', () => {
  it('always asks when there is something to delete', () => {
    const plan = designationPlan(SPCE, false)
    expect(plan.asks).toBe(true)
    expect(plan.destroys).toBe(true)
  })

  /**
   * ⚠️ THE COUNT IS IN THE SENTENCE, NOT ONLY IN THE CODE. A confirmation that says "are you
   * sure?" is a step to click through; one that says six thousand is a thing you read.
   */
  it('names how many rows go, in the sentence and on the button', () => {
    const plan = designationPlan(SPCE, false)
    expect(plan.says).toContain('6,006')
    expect(plan.go).toContain('6,006')
    expect(plan.says).toContain('SPCE')
  })

  it('says the units when there are units', () => {
    expect(designationPlan(SPCE, false).says).toContain('1,870.5469')
  })

  /**
   * ⚠️ A CLOSED POSITION IS THE CASE THAT BREAKS THE OBVIOUS IMPLEMENTATION. Net units of zero
   * with thousands of rows still on the books is real — bought and sold out — and gating the
   * confirmation on `familyUnits > 0` would wave it straight through, destroying the entire cost
   * history of a symbol while telling the admin nothing was at stake.
   */
  it('still asks about a position with no units left but rows on the books', () => {
    const closed: Designated = { ...SPCE, familyUnits: 0, familyRows: 412 }
    const plan = designationPlan(closed, false)
    expect(plan.asks).toBe(true)
    expect(plan.destroys).toBe(true)
    expect(plan.says).toContain('412')
    expect(plan.says).toMatch(/cost history/)
    /* and it must not claim a units figure it does not have */
    expect(plan.says).not.toMatch(/\b0 units\b/)
  })

  it('does not ask when the family has no share of it at all', () => {
    const none: Designated = { ...SPCE, familyRows: 0, familyUnits: 0 }
    const plan = designationPlan(none, false)
    expect(plan.asks).toBe(false)
    expect(plan.destroys).toBe(false)
    expect(plan.says).toMatch(/nothing is removed/)
  })

  it('counts one row as one, not "1 allocations"', () => {
    const one: Designated = { ...SPCE, familyRows: 1, familyUnits: 0.5 }
    expect(designationPlan(one, false).says).toContain('1 allocation for')
    expect(designationPlan(one, false).says).not.toContain('1 allocations')
    expect(designationPlan(one, false).go).not.toContain('1 allocations')
  })

  /** ⚠️ the recovery everybody reaches for does not work, so the sentence has to say so */
  it('warns that sharing it again does not bring them back', () => {
    expect(designationPlan(SPCE, false).says).toMatch(/Nothing restores them/)
  })
})

describe('giving a symbol to the family', () => {
  it('asks, even though it destroys nothing', () => {
    const plan = designationPlan(SPCE, true)
    expect(plan.asks).toBe(true)
    expect(plan.destroys).toBe(false)
  })

  /**
   * ⚠️ OFF IS NOT AN UNDO OF ON. On only picks up trades with no allocations; off deletes every
   * allocation for the symbol, including ones that predate the click. So the obvious recovery
   * from a mistaken On destroys more than the mistake did, and a person cannot guess that.
   */
  it('says that turning it off again takes more than this put in', () => {
    const says = designationPlan(SPCE, true).says
    expect(says).toMatch(/including any that were there before/)
    expect(says).toMatch(/not a step you can simply take back/)
  })
})

describe('the platform, in words a person uses', () => {
  it.each([
    ['cashapp', 'Cash App'],
    ['robinhood', 'Robinhood'],
  ])('writes %s as %s', (platform, shown) => {
    expect(designationPlan({ ...SPCE, platform }, false).title).toContain(shown)
  })

  it('leaves an unknown platform as it found it rather than inventing a name', () => {
    expect(designationPlan({ ...SPCE, platform: 'vanguard' }, false).title).toContain('vanguard')
  })
})
