// Sample portfolio for the signed-out Investments demo, so a visitor can see how the
// dollar-a-day fund works without an account or login. Not real data. Start date is
// fixed to Jan 1 so "promised to date" (and the ahead/behind schedule) stay live, and
// holdings carry sample prices so current value and gain/loss render too.
import type { AccountPortfolio } from './portfolio'

const START = '2026-01-01'
const PRICED = '2026-07-01'

export const DEMO_PORTFOLIO: AccountPortfolio[] = [
  {
    id: 'demo-1',
    name: 'Mom',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'AAPL', assetType: 'stock', units: 0.42, cost: 92, price: 245.5, priceAt: PRICED },
      { symbol: 'VOO', assetType: 'stock', units: 0.15, cost: 78, price: 588, priceAt: PRICED },
      {
        symbol: 'BTC',
        assetType: 'crypto',
        units: 0.0006,
        cost: 41,
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
      { symbol: 'MSFT', assetType: 'stock', units: 0.16, cost: 71, price: 512, priceAt: PRICED },
      { symbol: 'NVDA', assetType: 'stock', units: 0.38, cost: 52, price: 118, priceAt: PRICED },
      { symbol: 'VOO', assetType: 'stock', units: 0.05, cost: 27, price: 588, priceAt: PRICED },
    ],
  },
  {
    id: 'demo-3',
    name: 'Ava',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'AAPL', assetType: 'stock', units: 0.27, cost: 60, price: 245.5, priceAt: PRICED },
      {
        symbol: 'BTC',
        assetType: 'crypto',
        units: 0.0009,
        cost: 62,
        price: 61444,
        priceAt: PRICED,
      },
      { symbol: 'MSFT', assetType: 'stock', units: 0.13, cost: 60, price: 512, priceAt: PRICED },
    ],
  },
  {
    id: 'demo-4',
    name: 'You',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'VOO', assetType: 'stock', units: 0.22, cost: 120, price: 588, priceAt: PRICED },
      { symbol: 'NVDA', assetType: 'stock', units: 0.5, cost: 70, price: 118, priceAt: PRICED },
      {
        symbol: 'BTC',
        assetType: 'crypto',
        units: 0.0007,
        cost: 50,
        price: 61444,
        priceAt: PRICED,
      },
    ],
  },
]
