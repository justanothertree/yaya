import { describe, expect, it } from 'vitest'
import {
  answerLabel,
  brokerName,
  groupForReview,
  partOf,
  partPreview,
  type ReviewTrade,
} from './reviewGroups'

/**
 * ⚠️ THE FIXTURE IS THE LIVE FUND'S SHAPE, because the cases that matter here are the ones it
 * actually has: PEP designated on Robinhood and untouched on Cash App, a zero-dollar restatement,
 * and a sell in the same symbol as a buy.
 */
const t = (over: Partial<ReviewTrade>): ReviewTrade => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-09-29',
  symbol: 'SOFI',
  platform: 'robinhood',
  dollars: 60,
  units: 6,
  isFamilySymbol: false,
  alreadyHeld: 0,
  eligibleAccounts: 33,
  ...over,
})

describe('grouping the backlog', () => {
  /**
   * ⚠️ THE ONE THAT WOULD BE WRONG AND LOOK RIGHT. Designation is keyed (symbol, platform), so
   * one "All theirs" across both brokers would answer two different holdings at once. PEP is
   * exactly this on the live fund: family on Robinhood, four unallocated trades on Cash App.
   */
  it('splits one symbol across two brokers', () => {
    const g = groupForReview([
      t({ symbol: 'PEP', platform: 'robinhood', dollars: 100, units: 1 }),
      t({ symbol: 'PEP', platform: 'cashapp', dollars: 50, units: 0.5 }),
    ])
    expect(g).toHaveLength(2)
    expect(g.map((x) => x.key).sort()).toEqual(['PEP|cashapp', 'PEP|robinhood'])
    expect(g.map((x) => x.broker).sort()).toEqual(['Cash App', 'Robinhood'])
  })

  it('sums the money and units inside a group', () => {
    const [g] = groupForReview([t({ dollars: 60, units: 6 }), t({ dollars: 40, units: 4 })])
    expect(g.trades).toHaveLength(2)
    expect(g.dollars).toBe(100)
    expect(g.units).toBe(10)
  })

  /** ⚠️ SIGNED, so a buy and a sell do not add up to a bigger buy */
  it('keeps a sell negative rather than counting it as more bought', () => {
    const [g] = groupForReview([t({ dollars: 60, units: 6 }), t({ dollars: -20, units: -2 })])
    expect(g.dollars).toBe(40)
    expect(g.units).toBe(4)
  })

  /**
   * ⚠️ `alreadyHeld` IS A FACT ABOUT THE SYMBOL, NOT ABOUT THE TRADE. Every row in a group
   * carries the same figure, so summing it would multiply the family's holding by the number of
   * trades waiting — a number that grows as the backlog grows and shrinks as it is answered.
   */
  it('does not multiply the already-held figure by the number of trades', () => {
    const [g] = groupForReview([t({ alreadyHeld: 12.5 }), t({ alreadyHeld: 12.5 })])
    expect(g.alreadyHeld).toBe(12.5)
  })

  it('leaves an unknown broker as it found it', () => {
    expect(brokerName('vanguard')).toBe('vanguard')
    expect(brokerName('cashapp')).toBe('Cash App')
  })

  it('returns nothing for an empty backlog rather than a group of nothing', () => {
    expect(groupForReview([])).toEqual([])
  })
})

describe('reading a typed dollar amount', () => {
  it('takes a plain number', () => {
    const r = partOf(60, '20')
    expect(r).toEqual({ ok: true, part: 20, fraction: 20 / 60 })
  })

  it('forgives a currency sign and thousands commas, which are formatting', () => {
    expect(partOf(1200, '$1,200')).toEqual({ ok: true, part: 1200, fraction: 1 })
  })

  /**
   * ⚠️ THE BUG THE OLD `window.prompt` VERSION HAD. It stripped every character it did not like
   * — `raw.replace(/[^0-9.]/g, '')` — so "12 or 13" became 1213 and was acted on without a word.
   * A hundredfold error that nothing on screen would have shown before the split was written.
   */
  it('refuses a typo rather than stripping it into a different number', () => {
    expect(partOf(60, '12 or 13')).toEqual({ ok: false, why: 'Numbers only, please.' })
    expect(partOf(60, '1.2.3')).toEqual({ ok: false, why: 'Numbers only, please.' })
    expect(partOf(60, '20abc')).toEqual({ ok: false, why: 'Numbers only, please.' })
  })

  /** ⚠️ empty is "not yet", not "wrong" — the field starts here and backspaces back to it */
  it('says nothing at all about an empty box', () => {
    expect(partOf(60, '')).toEqual({ ok: false, why: null })
    expect(partOf(60, '   ')).toEqual({ ok: false, why: null })
  })

  it('refuses zero and refuses more than the trade, and names the trade', () => {
    expect(partOf(60, '0').ok).toBe(false)
    const over = partOf(60, '61')
    expect(over.ok).toBe(false)
    expect(over.ok === false && over.why).toMatch(/\$60/)
  })

  /** ⚠️ BOTH ENDS OF THE BAND: exactly the whole trade is a legitimate answer, not an overflow */
  it('accepts exactly the whole trade', () => {
    expect(partOf(60, '60')).toEqual({ ok: true, part: 60, fraction: 1 })
  })

  /** a sell's dollars are negative; the question is still "how much of it", so compare on size */
  it('reads a sell by its size rather than its sign', () => {
    expect(partOf(-60, '30')).toEqual({ ok: true, part: 30, fraction: 0.5 })
  })
})

describe('the sentence under the box', () => {
  /** ⚠️ the per-account share is the number nobody has in their head — see the module header */
  it('spells out what each account gets, using the server’s own count', () => {
    const s = partPreview({ dollars: 60, units: 6, eligibleAccounts: 33 }, 1 / 3)
    expect(s).toContain('$20.00 of $60.00')
    expect(s).toContain('33% theirs')
    expect(s).toContain('× 33')
    /* 6 units × 1/3 = 2, across 33 accounts */
    expect(s).toContain((2 / 33).toFixed(4))
  })

  /**
   * ⚠️ NO COUNT MEANS NO "EACH", rather than a division by zero printed as Infinity or NaN. An
   * older bundle, or a trade dated before any account started, has nothing to divide by.
   */
  it('falls back to a total when no account is eligible', () => {
    const s = partPreview({ dollars: 60, units: 6, eligibleAccounts: 0 }, 0.5)
    expect(s).toContain('3.0000 units in total')
    expect(s).not.toMatch(/NaN|Infinity/)
    expect(partPreview({ dollars: 60, units: 6 }, 0.5)).not.toMatch(/NaN|Infinity/)
  })
})

describe('reading an answer back', () => {
  it('names the two plain answers', () => {
    expect(answerLabel({ fraction: 0, familyUnits: 0 })).toBe('kept yours')
    expect(answerLabel({ fraction: 1, familyUnits: 6 })).toBe('all theirs')
    expect(answerLabel({ fraction: 0.3333, familyUnits: 2 })).toBe('33% theirs')
  })

  /**
   * ⚠️ A RESTATEMENT HAS NO FRACTION AND MUST NOT BE GIVEN ONE. `admin_recent_reviews` sends null
   * for a zero-dollar row because the split scales by the family's share first; dividing back out
   * would print a percentage nobody typed. SGRX on the live fund is exactly this row.
   */
  it('reports units for a restatement rather than inventing a percentage', () => {
    expect(answerLabel({ fraction: null, familyUnits: 0 })).toBe('kept yours')
    expect(answerLabel({ fraction: null, familyUnits: 1.5 })).toBe('1.5000 units theirs')
  })

  /** 0.99995 rounds to 100% and is not "all" — the remainder is somebody's shares */
  it('does not round a near-miss up into "all theirs"', () => {
    expect(answerLabel({ fraction: 0.9, familyUnits: 5.4 })).toBe('90% theirs')
    expect(answerLabel({ fraction: 0.99989, familyUnits: 6 })).not.toBe('all theirs')
  })
})
