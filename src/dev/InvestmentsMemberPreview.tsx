import { AccountCard } from '../sections/Investments'
import type { AccountPortfolio } from '../finance/portfolio'
import type { Timeline } from '../finance/timeline'

/**
 * DEV-only workbench for what a FAMILY MEMBER sees.
 *
 * ⚠️ This is the highest-value screen on the site and the hardest one to look at. It needs a
 * real member session, and it renders on the ONE-ACCOUNT path — which Evan's own view never
 * takes, because he owns 33 accounts and always goes through the multi-account list. The
 * signed-out demo has four accounts, so it exercises the summary card and not this one.
 *
 * Two family-facing bugs lived in that blind spot:
 *   * a member's CASH from sales appeared nowhere at all, so selling something of theirs made
 *     their number drop by the whole position with nothing saying where the money went;
 *   * the ⓘ panel said ahead/behind "compares it" to the plan — "it" being the value, the one
 *     thing Evan has said ahead/behind must never be about.
 *
 * Both were minutes of work once they could be seen. Neither was findable by reading, because
 * the code was correct in isolation — it was the composition that was wrong.
 *
 * So this file's job is to make the states reachable, especially the ones that only occur after
 * something happens: a sale, a loss, a dead price feed, an account nobody has funded yet.
 *
 * ⚠️ Every person here is invented. This ships in a public repo and must never carry a real
 * family member's name. See the same note in previewMember.ts.
 */

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString()
const isoDay = (t: number) => iso(t).slice(0, 10)

/** Yesterday — fresh enough that the staleness warning stays off unless a case wants it. */
const FRESH = iso(Date.now() - DAY)
/** Old enough to trip the two-day staleness rule in AccountCard. */
const STALE = iso(Date.now() - 6 * DAY)

/** Start far enough back that "promised to date" is a meaningful number. */
const START = isoDay(Date.now() - 250 * DAY)

type Case = { label: string; what: string; account: AccountPortfolio }

/**
 * A price history for the sparklines and the "today" delta.
 *
 * Two points minimum per symbol or `dayChange` stays null and that row of the card never
 * renders — which would quietly hide a thing this workbench exists to show.
 */
const TIMELINE: Timeline = {
  accounts: [{ dollarPerDay: 1, startDate: START }],
  events: [],
  prices: [
    { symbol: 'VOO', date: isoDay(Date.now() - 2 * DAY), price: 580 },
    { symbol: 'VOO', date: isoDay(Date.now() - DAY), price: 588 },
    { symbol: 'AAPL', date: isoDay(Date.now() - 2 * DAY), price: 250 },
    { symbol: 'AAPL', date: isoDay(Date.now() - DAY), price: 245.5 },
    { symbol: 'BTC', date: isoDay(Date.now() - 2 * DAY), price: 60000 },
    { symbol: 'BTC', date: isoDay(Date.now() - DAY), price: 61444 },
  ],
  costBasis: [],
}

const holdings = (priceAt: string = FRESH) => [
  { symbol: 'VOO', assetType: 'stock', units: 0.22, netCash: 120, price: 588, priceAt },
  { symbol: 'AAPL', assetType: 'stock', units: 0.42, netCash: 92, price: 245.5, priceAt },
  { symbol: 'BTC', assetType: 'crypto', units: 0.0006, netCash: 41, price: 61444, priceAt },
]

/** basis of the holdings above — 253, kept derived so edits above cannot desync the cases.
 *  Sound here only because these fixtures have no sells, so netCash and basis coincide. */
const COST = holdings().reduce((s, h) => s + h.netCash, 0)

const base: Omit<AccountPortfolio, 'id' | 'name'> = {
  dollarPerDay: 1,
  startDate: START,
  contributed: 260,
  cash: 0,
  heldBasis: COST,
  ready: true,
  holdings: holdings(),
}

const CASES: Case[] = [
  {
    label: 'The ordinary day',
    what: 'Shares only, no cash, prices fresh, slightly ahead of the promise. This is what most visits should look like.',
    account: { ...base, id: 'pv-1', name: 'Robin' },
  },
  {
    label: '⭐ After you sell something of theirs',
    what: 'The case that was broken until 2026-08-24. "Worth today" counts the SHARES only, so it drops by whatever was sold — the cash line under it is the only thing that says the money is still theirs.',
    account: { ...base, id: 'pv-2', name: 'Marlowe', cash: 118.4, heldBasis: COST },
  },
  {
    label: 'Down on the shares',
    what: 'Bought higher than they are now. A loss must read as a loss — and must NOT turn into "behind the promise", which is about money in, not value.',
    account: { ...base, id: 'pv-3', name: 'Wren', heldBasis: COST * 1.6 },
  },
  {
    label: 'Behind the promise, but up on the shares',
    what: 'The pair Evan most wants understood: these two numbers move independently and can disagree. Contributed less than promised, while the shares are up.',
    account: { ...base, id: 'pv-4', name: 'Idris', contributed: 140 },
  },
  {
    label: 'Nothing funded yet',
    what: 'A brand-new account. ahead/behind must be suppressed entirely rather than reading "behind by the whole promise".',
    account: {
      ...base,
      id: 'pv-5',
      name: 'Nova',
      ready: false,
      contributed: undefined,
      heldBasis: undefined,
      cash: 0,
      holdings: [],
    },
  },
  {
    label: 'Price feed has stopped',
    what: 'Prices six days old. "Worth today" is stated as fact, so the card has to say so out loud and hide the "today" delta rather than caption a days-old move as today.',
    account: { ...base, id: 'pv-6', name: 'Sable', holdings: holdings(STALE) },
  },
  {
    label: 'A holding with no price',
    what: 'One symbol the price sweep has never seen. It must not be silently counted as worth zero.',
    account: {
      ...base,
      id: 'pv-7',
      name: 'Ash',
      holdings: [
        ...holdings(),
        { symbol: 'PRIV', assetType: 'stock', units: 3, netCash: 60, price: null, priceAt: null },
      ],
    },
  },
]

export function InvestmentsMemberPreview() {
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        dev preview — #dev-investments · invented people, real components
      </p>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>What one family member sees</h3>
        <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
          Every card below is the real <code>AccountCard</code> — the same component a signed-in
          member gets, on the one-account path Evan&apos;s own view never takes. The states that
          only happen <em>after</em> something occurs (a sale, a loss, a dead price feed) are the
          ones worth checking; they are otherwise unreachable without waiting for the thing to
          happen in production.
        </p>
      </div>

      {CASES.map((c) => (
        <section key={c.account.id} style={{ display: 'grid', gap: '0.4rem' }}>
          <div className="cz-sec" style={{ margin: 0 }}>
            {c.label}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
            {c.what}
          </p>
          <AccountCard account={c.account} timeline={TIMELINE} />
        </section>
      ))}
    </div>
  )
}
