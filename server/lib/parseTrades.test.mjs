import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTrades } from './parseTrades.mjs'

/**
 * The broker-export parser, asked the questions its own fixtures were built to ask.
 *
 * ⚠️ THE SPECIFICATION ALREADY EXISTED AND NOTHING READ IT. `scripts/fixtures/README.md` describes
 * seven files and gives an exact expected result for each — "Expected: 6 rows, 5 kept, 2
 * adjustments, 1 skipped" — and even says what a regression means: "If the summary says anything
 * other than 6 rows, that parser has regressed." Those are assertions written in prose. Nothing
 * in the repository referenced `fixtures/` at all; they were run by hand, by typing a CLI command
 * and reading the output.
 *
 * So this is 514 lines of pure parser, feeding real money into the live fund through
 * `admin_import_trades`, with every one of its cases documented and none of them checked. It is
 * the shape CLAUDE.md describes about the park's pure modules: they said in their own comments
 * that they were pure so they could be asked a question, and for a long time nothing asked.
 *
 * ⚠️ THE NUMBERS BELOW ARE THE README'S, NOT THE PARSER'S. They were written from the fixtures'
 * contents by the person who made them. Reading them out of `parseTrades` and asserting them back
 * would be the parser agreeing with itself — green whatever it does.
 */

const FIXTURES = new URL('../../scripts/fixtures/', import.meta.url)
const load = (name) => readFileSync(new URL(name, FIXTURES), 'utf8')

describe('the Robinhood shape', () => {
  const { summary, trades } = parseTrades(load('robinhood-sample.csv'))

  /**
   * ⚠️ THIS ONE COUNT IS THE RFC-4180 PARSER'S ALARM. Robinhood wraps a multi-line
   * name / class / CUSIP blob inside a quoted Description field, so a naive line-split shreds
   * that row and every row after it. The README says so: anything other than 6 rows means the
   * hand-written CSV parser has regressed.
   */
  it('finds all six rows across a multi-line quoted field', () => {
    expect(summary.dataRows).toBe(6)
  })

  it('keeps five and skips one', () => {
    expect(summary.kept).toBe(5)
    expect(summary.skippedTotal).toBe(1)
  })

  it('counts the reverse-split pair as adjustments rather than as buys', () => {
    expect(summary.adjustments).toBe(2)
    /* an adjustment moves units and no money — that is what makes it not a buy */
    const adj = trades.filter((t) => t.dollars === 0 && t.units !== 0)
    expect(adj).toHaveLength(2)
    expect(adj.reduce((n, t) => n + t.dollars, 0)).toBe(0)
  })

  /**
   * ⚠️ A SKIP IT UNDERSTANDS IS NAMED IN WORDS; ONE IT DOES NOT IS NAMED BY ITS RAW CODE. This
   * test first asserted `/CDIV/` and went red, because the parser is better than that — `CDIV`
   * becomes "cash dividend" while the unknown `ZZZZ` further down stays `ZZZZ`. The distinction
   * is the whole value: "1 skipped" tells nobody anything, "cash dividend" needs no action, and a
   * bare transaction code is the signal that a rule is missing.
   */
  it('skips the cash dividend, and says so in words', () => {
    expect(Object.keys(summary.skips)).toContain('cash dividend')
    expect(summary.skips['cash dividend']).toBe(1)
  })
})

describe('the Cash App shape', () => {
  const { summary } = parseTrades(load('cashapp-sample.csv'))

  it('keeps four of five and knows one is a reinvestment', () => {
    expect(summary.dataRows).toBe(5)
    expect(summary.kept).toBe(4)
    expect(summary.reinvestments).toBe(1)
    expect(summary.skippedTotal).toBe(1)
  })

  /** a dividend taken as cash is not a trade; one taken as shares is */
  it('tells a reinvested dividend from one paid out', () => {
    expect(summary.reinvestments).toBe(1)
    expect(summary.skippedTotal).toBe(1)
  })
})

describe('the three ways a sell arrives', () => {
  const { summary, trades } = parseTrades(load('sell-shapes.csv'))

  /**
   * ⚠️ DIRECTION COMES FROM THE TRANSACTION TYPE, NOT FROM A SIGN. A Cash App sell can arrive
   * with positive units, with a negative net amount, or with a negative `Asset Amount` — and the
   * last used to be dropped as "unparsed sell" because the guard rejected `units <= 0`. A dropped
   * sell is money the family is shown as still holding.
   */
  it('parses all three and drops none', () => {
    expect(summary.dataRows).toBe(3)
    expect(summary.kept).toBe(3)
    expect(summary.skippedTotal).toBe(0)
  })

  it('calls all three sells', () => {
    expect(trades.filter((t) => t.kind === 'sell')).toHaveLength(3)
    expect(summary.sells.count).toBe(3)
  })
})

describe('three identical Robinhood buys on one day', () => {
  const { summary } = parseTrades(load('rh-identical.csv'))

  /**
   * ⚠️ THE COLLAPSE IS REAL MONEY AND IS NOT FIXED HERE ON PURPOSE. Robinhood rows carry no
   * transaction id and `Activity Date` has no time, so the key is a hash of
   * (date, symbol, units, price, dollars) — three genuine $20 purchases are indistinguishable
   * from one row listed three times. The repair is an occurrence ordinal, which changes the key
   * of every Robinhood row already imported and would insert a second copy of the whole history
   * on the next run. That needs a migration.
   *
   * So the thing under test is the WARNING, not the dedupe: the dollars that did not make it in
   * must be named and countable.
   */
  it('collapses them to one, and says how much money that was', () => {
    expect(summary.dataRows).toBe(3)
    expect(summary.kept).toBe(1)
    expect(summary.collapsed).toHaveLength(2)
    expect(summary.collapsedDollars).toBeCloseTo(40, 6)
  })

  it('names the rows it dropped rather than only counting them', () => {
    for (const row of summary.collapsed) {
      expect(row.date).toBeTruthy()
      expect(row.symbol).toBeTruthy()
      expect(Number.isFinite(row.dollars)).toBe(true)
    }
  })

  /** the summary must not contradict itself — `kept` and the sell/net figures are post-dedupe */
  it('reports one import, not two', () => {
    expect(summary.netInvested).toBeCloseTo(
      summary.collapsedDollars / 2,
      6,
    ) /* one $20 of the three */
  })
})

describe('re-importing a wider export', () => {
  /**
   * ⚠️ THIS IS THE PROPERTY THE WHOLE "JUST RE-UPLOAD YOUR STATEMENT" IDEA RESTS ON. `import_key`
   * is what makes a re-import idempotent, and a key that changes is a NEW ROW — the unique index
   * cannot save you from that, because nothing collides. So the two rows `overlap-b` shares with
   * `overlap-a` have to hash identically, or every re-import quietly doubles the overlap.
   */
  const a = parseTrades(load('overlap-a.csv'))
  const b = parseTrades(load('overlap-b.csv'))

  it('gives the shared rows the same key in both files', () => {
    const inA = new Set(a.trades.map((t) => t.importKey))
    const shared = b.trades.filter((t) => inA.has(t.importKey))
    expect(shared).toHaveLength(a.trades.length)
    expect(a.trades.length).toBeGreaterThan(0)
  })

  it('finds the genuinely new rows and only those', () => {
    const inA = new Set(a.trades.map((t) => t.importKey))
    const fresh = b.trades.filter((t) => !inA.has(t.importKey))
    expect(fresh.length).toBe(b.trades.length - a.trades.length)
    expect(fresh.length).toBeGreaterThan(0)
  })

  it('does not reuse one key for two different trades', () => {
    for (const { trades } of [a, b]) {
      expect(new Set(trades.map((t) => t.importKey)).size).toBe(trades.length)
    }
  })
})

describe('the codes that are not buys or sells', () => {
  const { summary } = parseTrades(load('rh-corporate.csv'))

  it('handles a symbol change, a share dividend and one code it has never seen', () => {
    expect(summary.dataRows).toBe(5)
    expect(summary.kept).toBe(4)
    expect(summary.reinvestments).toBe(1)
    expect(summary.adjustments).toBe(3)
    expect(summary.skippedTotal).toBe(1)
  })

  /**
   * ⚠️ AN UNKNOWN CODE IS SKIPPED BY NAME. That is how a new export format gets noticed instead
   * of quietly losing rows — a count of "1 skipped" tells nobody which rule to write next.
   */
  it('names the code it did not recognise, as the code', () => {
    expect(Object.keys(summary.skips)).toContain('ZZZZ')
    /* ⚠️ and NOT as a tidy phrase — a reason it can word is a reason it already handles */
    expect(Object.keys(summary.skips)).not.toContain('unknown')
  })
})

describe('the rounding a symbol change leaves behind', () => {
  const { summary, trades } = parseTrades(load('rh-cciv-rounding.csv'))

  /**
   * ⚠️ ROBINHOOD ROUNDS THE REMOVAL TO FOUR DECIMALS AND THE PURCHASES ARE NOT ROUNDED, SO
   * THE TWO DO NOT CANCEL. CCIV→LCID is the real case: 6 + 0.286364 bought, then "6.2864S"
   * removed by the symbol change. The residue is −0.000036 — a position that is very slightly
   * NEGATIVE, for ever, on a stock that no longer exists under that name.
   *
   * ⚠️ AND THE PARSER MUST NOT TIDY IT. It reports what the broker said; inventing the
   * difference here would hide it from the one place that can see the whole position, which is
   * the database. `admin_import_trades` absorbs it (plan P3.1) by removing exactly what is held
   * when the incoming row would otherwise overshoot. This test pins the parser's faithfulness so
   * that fix stays necessary and visible rather than being quietly duplicated in two places.
   */
  it('reports the rounded removal rather than correcting it', () => {
    expect(summary.dataRows).toBe(4)
    expect(summary.kept).toBe(4)
    const cciv = trades.filter((t) => t.symbol === 'CCIV')
    const bought = cciv.filter((t) => t.dollars !== 0).reduce((n, t) => n + t.units, 0)
    const removed = cciv.filter((t) => t.dollars === 0).reduce((n, t) => n + t.units, 0)
    expect(bought).toBeCloseTo(6.286364, 9)
    expect(removed).toBeCloseTo(-6.2864, 9)
    /* the whole point: what the broker's own numbers leave behind */
    expect(bought + removed).toBeCloseTo(-0.000036, 9)
    expect(bought + removed).toBeLessThan(0)
  })

  it('counts the two zero-dollar rows as adjustments and moves no money on them', () => {
    expect(summary.adjustments).toBe(2)
    const adj = trades.filter((t) => t.dollars === 0)
    expect(adj).toHaveLength(2)
    expect(adj.reduce((n, t) => n + t.dollars, 0)).toBe(0)
    /* one out of CCIV, one into LCID — a symbol change is a pair, not a sale */
    expect(adj.map((t) => t.symbol).sort()).toEqual(['CCIV', 'LCID'])
  })

  /** ⚠️ the new name arrives with the ROUNDED quantity, which is what the family then holds */
  it('opens the new symbol at the figure the broker actually gave', () => {
    const lcid = trades.filter((t) => t.symbol === 'LCID')
    expect(lcid).toHaveLength(1)
    expect(lcid[0].units).toBeCloseTo(6.2864, 9)
  })
})

describe('what it refuses and what it survives', () => {
  it('says which broker it could not identify rather than guessing', () => {
    expect(() => parseTrades('a,b,c\n1,2,3\n')).toThrow(/Robinhood or Cash App/)
  })

  it('parses a header-only file to nothing without crashing', () => {
    const header = load('robinhood-sample.csv').split('\n')[0] + '\n'
    const { summary } = parseTrades(header)
    expect(summary.dataRows).toBe(0)
    expect(summary.kept).toBe(0)
  })

  /**
   * ⚠️ ASKED OF EVERY FIXTURE, because a parser that invents a trade is worse than one that drops
   * it: a dropped row shows up as a gap against a statement, and an invented one becomes units
   * somebody is told they own. Every row of every file must be accounted for exactly once.
   */
  it('accounts for every row of every fixture, once', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.csv'))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const { summary } = parseTrades(load(f))
      expect(
        summary.kept + summary.skippedTotal + summary.collapsed.length,
        `${f}: ${summary.kept} kept + ${summary.skippedTotal} skipped + ${summary.collapsed.length} collapsed != ${summary.dataRows} rows`,
      ).toBe(summary.dataRows)
    }
  })

  it('never reports money moving on an adjustment, in any fixture', () => {
    for (const f of readdirSync(FIXTURES).filter((x) => x.endsWith('.csv'))) {
      const { trades } = parseTrades(load(f))
      for (const t of trades) {
        if (t.dollars === 0) expect(t.kind, `${f} ${t.symbol}`).not.toBe('sell')
        expect(Number.isFinite(t.dollars), `${f} ${t.symbol} dollars`).toBe(true)
        expect(Number.isFinite(t.units), `${f} ${t.symbol} units`).toBe(true)
      }
    }
  })
})
