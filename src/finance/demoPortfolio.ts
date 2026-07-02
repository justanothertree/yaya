// Sample portfolio for the signed-out Investments demo, so a visitor can see how the
// dollar-a-day fund works without an account or login. Not real data. Start date is
// fixed to Jan 1 so "promised to date" (and the ahead/behind schedule) stay live.
import type { AccountPortfolio } from './portfolio'

const START = '2026-01-01'

export const DEMO_PORTFOLIO: AccountPortfolio[] = [
  {
    id: 'demo-1',
    name: 'Mom',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'AAPL', assetType: 'stock', units: 0.42, cost: 92 },
      { symbol: 'VOO', assetType: 'stock', units: 0.15, cost: 78 },
      { symbol: 'BTC', assetType: 'crypto', units: 0.0006, cost: 41 },
    ],
  },
  {
    id: 'demo-2',
    name: 'Dad',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'MSFT', assetType: 'stock', units: 0.16, cost: 71 },
      { symbol: 'NVDA', assetType: 'stock', units: 0.38, cost: 52 },
      { symbol: 'VOO', assetType: 'stock', units: 0.05, cost: 27 },
    ],
  },
  {
    id: 'demo-3',
    name: 'Ava',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'AAPL', assetType: 'stock', units: 0.27, cost: 60 },
      { symbol: 'BTC', assetType: 'crypto', units: 0.0009, cost: 62 },
      { symbol: 'MSFT', assetType: 'stock', units: 0.13, cost: 60 },
    ],
  },
  {
    id: 'demo-4',
    name: 'You',
    dollarPerDay: 1,
    startDate: START,
    holdings: [
      { symbol: 'VOO', assetType: 'stock', units: 0.22, cost: 120 },
      { symbol: 'NVDA', assetType: 'stock', units: 0.5, cost: 70 },
      { symbol: 'BTC', assetType: 'crypto', units: 0.0007, cost: 50 },
    ],
  },
]
