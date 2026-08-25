// Sample portfolio for the signed-out Investments demo, so a visitor can see how the
// dollar-a-day fund works without an account or login. Not real data. Start date is
// fixed to Jan 1 so "promised to date" (and the ahead/behind schedule) stay live, and
// holdings carry sample prices so current value and gain/loss render too.
import type { AccountPortfolio } from './portfolio'

const START = '2026-01-01'
/**
 * Yesterday, not a fixed date.
 *
 * The demo is meant to show the fund WORKING, and the real dashboard now says so when prices
 * stop arriving (see `pricesStale` in Investments.tsx). A hardcoded date drifts further out of
 * date every day the site is up, so a fixed value would eventually — and then permanently —
 * make the public demo advertise a broken price feed. Yesterday keeps it inside the freshness
 * window forever without pretending the sweep ran in the last minute.
 */
const PRICED = new Date(Date.now() - 86_400_000).toISOString()

const DEMO_ACCOUNTS: AccountPortfolio[] = [
  {
    id: 'demo-1',
    name: 'Mom',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      {
        symbol: 'AAPL',
        assetType: 'stock',
        units: 0.42,
        netCash: 92,
        price: 245.5,
        priceAt: PRICED,
      },
      { symbol: 'VOO', assetType: 'stock', units: 0.15, netCash: 78, price: 588, priceAt: PRICED },
      {
        symbol: 'BTC',
        assetType: 'crypto',
        units: 0.0006,
        netCash: 41,
        price: 61444,
        priceAt: PRICED,
      },
    ],
  },
  {
    id: 'demo-2',
    name: 'Dad',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'MSFT', assetType: 'stock', units: 0.16, netCash: 71, price: 512, priceAt: PRICED },
      { symbol: 'NVDA', assetType: 'stock', units: 0.38, netCash: 52, price: 118, priceAt: PRICED },
      { symbol: 'VOO', assetType: 'stock', units: 0.05, netCash: 27, price: 588, priceAt: PRICED },
    ],
  },
  {
    id: 'demo-3',
    name: 'Ava',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      {
        symbol: 'AAPL',
        assetType: 'stock',
        units: 0.27,
        netCash: 60,
        price: 245.5,
        priceAt: PRICED,
      },
      {
        symbol: 'BTC',
        assetType: 'crypto',
        units: 0.0009,
        netCash: 62,
        price: 61444,
        priceAt: PRICED,
      },
      { symbol: 'MSFT', assetType: 'stock', units: 0.13, netCash: 60, price: 512, priceAt: PRICED },
    ],
  },
  {
    id: 'demo-4',
    name: 'You',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'VOO', assetType: 'stock', units: 0.22, netCash: 120, price: 588, priceAt: PRICED },
      { symbol: 'NVDA', assetType: 'stock', units: 0.5, netCash: 70, price: 118, priceAt: PRICED },
      {
        symbol: 'BTC',
        assetType: 'crypto',
        units: 0.0007,
        netCash: 50,
        price: 61444,
        priceAt: PRICED,
      },
    ],
  },
]

/**
 * ⚠️ The money-in figures are DERIVED from the holdings, never typed alongside them.
 *
 * Without them the demo was showing a family "behind the promise by $940.00" — the entire
 * promise — beside its own chart reading "Net in $783.00, Promised $940.00", which is $157. And
 * a "Gain on holdings" of +$803.85, exactly the portfolio's whole value, because a missing cost
 * basis was being read as a basis of zero. Two contradictory answers and an impossible one, on
 * the first screen anybody sees, about the numbers Evan most needs people to trust.
 *
 * The cause was `contributed ?? 0` in portfolioTotals (fixed there too). The cause of it going
 * unnoticed is this file: it predates contributed/cash/heldBasis and nothing made it keep up.
 *
 * Deriving from `cost` is what stops that recurring. `demoTimeline()` builds the chart's "Net
 * in" line by summing exactly these same `cost` values, so the sentence and the chart cannot
 * disagree no matter how the sample holdings are edited later. There are no sells in the demo
 * timeline, so contributed == basis and cash is zero — the same identity the real ledger would
 * produce from the same events.
 */
export const DEMO_PORTFOLIO: AccountPortfolio[] = DEMO_ACCOUNTS.map((a) => {
  // ⚠️ netCash is buys-minus-sells, not a basis — but the demo holdings have no sells, so
  // here the two are the same number and deriving from it is what keeps the sample sentence
  // and the sample chart from drifting apart. Do not copy this identity onto real data.
  const cost = a.holdings.reduce((sum, h) => sum + h.netCash, 0)
  return { ...a, contributed: cost, heldBasis: cost, cash: 0, ready: true }
})
