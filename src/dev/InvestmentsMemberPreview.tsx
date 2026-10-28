import { AccountCard, SoloAccount } from '../sections/Investments'
import type { AccountPortfolio } from '../finance/portfolio'
import type { PricePoint, Timeline, TimelineEvent } from '../finance/timeline'

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
 * ⚠️ THE TIMELINE WAS TWO PRICES AND NO EVENTS, AND THAT EMPTIED HALF THE CARD WITHOUT SAYING SO.
 *
 * `events` drives `avgCostBySymbol`, which is the only source of a per-holding basis — so with
 * none, every row's gain column rendered the em dash and the expanded detail dropped its "Avg
 * cost" and "Gain / loss" figures entirely. A sweep of this bench was measuring a row whose
 * figures column held one short number, and the live row holds two long ones. The same emptiness
 * hid the chart: `SoloAccount` only draws it when there are events, so the member's three-card
 * layout could not be seen here at all.
 *
 * ⚠️ DETERMINISTIC, NEVER `Math.random()`. A fixture that draws a different chart on every reload
 * cannot be compared against the last screenshot.
 *
 * The last price of each run IS the holding's price, so the card's "worth today" and the chart's
 * last point agree — two numbers for one quantity on one screen is the bug this room keeps
 * producing. The one before it differs, so "today" is a real move rather than zero.
 */
const wobble = (i: number) => Math.sin(i * 0.7) * 0.035 + Math.sin(i * 0.23) * 0.055

const priceRun = (symbol: string, now: number, days = 120): PricePoint[] =>
  Array.from({ length: days }, (_, k) => ({
    symbol,
    date: isoDay(Date.now() - (days - 1 - k) * DAY),
    price:
      k === days - 1
        ? now
        : Math.round(now * (0.82 + (0.18 * k) / (days - 1) + wobble(k)) * 1e4) / 1e4,
  }))

/**
 * Buys spread across the fund's life, with the units chosen from a TARGET average cost so the
 * percentages on screen are the ones this file claims: VOO +13%, AAPL −6%, BTC +18%. Deriving
 * the units is what keeps that true — typing them in and asserting the percentage separately is
 * how a fixture comes to disagree with its own comment.
 */
const AVG_COST: Record<string, number> = { VOO: 520, AAPL: 262, BTC: 52000, NWL: 6.1 }
const ORDER = 4.1

const EVENTS: TimelineEvent[] = [
  ...Array.from({ length: 30 }, (_, k): TimelineEvent => {
    const symbol = ['VOO', 'AAPL', 'BTC', 'NWL'][k % 4]
    return {
      date: isoDay(Date.now() - (238 - k * 8) * DAY),
      symbol,
      units: ORDER / AVG_COST[symbol],
      cost: ORDER,
    }
  }),
  /* one sale, so "money put in" is not simply the sum of the buys — and so the cash cases have
     something in the timeline that explains where their cash came from */
  { date: isoDay(Date.now() - 36 * DAY), symbol: 'AAPL', units: -0.02, cost: -5.24 },
]

const TIMELINE: Timeline = {
  accounts: [{ dollarPerDay: 1, startDate: START }],
  events: EVENTS,
  prices: [
    ...priceRun('VOO', 588),
    ...priceRun('AAPL', 245.5),
    ...priceRun('BTC', 61444),
    /* one crumb with a price history and one without, so both row states are on screen */
    ...priceRun('NWL', 4.6),
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

/**
 * ⚠️ SUB-$1 HOLDINGS, BECAUSE THE FOLD WAS UNTESTABLE WITHOUT THEM. Every seeded account held
 * three comfortable positions, so `.inv-small` never rendered and a sweep of this bench reported
 * a clean room about a feature that was not on screen. Two of these carry names the map knows and
 * two do not, so the empty-second-line path is exercised too.
 */
const CRUMBS = [
  { symbol: 'PEXNY', assetType: 'stock', units: 0.18, netCash: 0.9, price: 1.1, priceAt: FRESH },
  { symbol: 'NWL', assetType: 'stock', units: 0.14, netCash: 1.4, price: 4.6, priceAt: FRESH },
  { symbol: 'CODI', assetType: 'stock', units: 0.19, netCash: 1.1, price: 2.4, priceAt: FRESH },
  { symbol: 'OLOX', assetType: 'stock', units: 0.88, netCash: 2.1, price: 0.21, priceAt: FRESH },
  { symbol: 'RIME', assetType: 'stock', units: 0.96, netCash: 1.9, price: 0.36, priceAt: FRESH },
]

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
  {
    label: 'Mostly crumbs',
    what: 'The live fund’s real shape: 37 of 76 holdings per account are worth under $1, because at 33 accounts any buy under $33 is under a dollar a head on the day it settles. They must fold into one row that still counts them, and a holding with no price must NOT fold — unknown is not small.',
    account: {
      ...base,
      id: 'pv-8',
      name: 'Juniper',
      holdings: [
        ...holdings(),
        ...CRUMBS,
        { symbol: 'PRIV', assetType: 'stock', units: 3, netCash: 60, price: null, priceAt: null },
      ],
    },
  },
  {
    /**
     * ⚠️ SEVEN FIGURES, BECAUSE EVERY FIGURE ON THIS CARD IS LAID OUT BY ITS OWN WIDTH. The tiles
     * size to their content, the holdings row's figures column sizes to its content, and the
     * chart's y labels set the left padding — so the only way to know any of them survives a big
     * number is to put one on screen. Nobody in the fund is here yet; the layout has to be.
     */
    label: 'A number nobody has yet',
    what: 'Not a real state — a width test. $1.2m of worth, a seven-figure gain and a four-digit percentage, to check that nothing wraps mid-number or runs off its own card.',
    account: {
      ...base,
      id: 'pv-10',
      name: 'Peregrine',
      contributed: 98765.43,
      cash: 4321.09,
      heldBasis: 101234.56,
      holdings: [
        {
          symbol: 'BTC',
          assetType: 'crypto',
          units: 19.4,
          netCash: 90000,
          price: 61444,
          priceAt: FRESH,
        },
        {
          symbol: 'VOO',
          assetType: 'stock',
          units: 120.5,
          netCash: 60000,
          price: 588,
          priceAt: FRESH,
        },
        ...CRUMBS,
      ],
    },
  },
  {
    label: 'One crumb only',
    what: 'A single sub-$1 holding is just a holding. The fold is only worth its own row from two up, or it is a summary of one thing.',
    account: {
      ...base,
      id: 'pv-9',
      name: 'Rowan',
      holdings: [...holdings(), CRUMBS[0]],
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
          Each block below is the real <code>SoloAccount</code> inside the room&apos;s own{' '}
          <code>.inv-solo</code> grid — the same three cards a signed-in member gets, on the
          one-account path Evan&apos;s own view never takes. The states that only happen{' '}
          <em>after</em> something occurs (a sale, a loss, a dead price feed) are the ones worth
          checking; they are otherwise unreachable without waiting for the thing to happen in
          production.
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
          {/**
           * ⚠️ `grid inv-solo` IS NOT DECORATION — IT IS THE LAYOUT UNDER TEST. `SoloAccount`
           * returns three sibling cards and `.inv-solo` is what arranges them: one column on a
           * phone, and at 900px up a 1.35fr/1fr pair with the headline spanning both. Rendered
           * without it they would stack in whatever the parent happened to be doing, and the
           * bench would be reporting on a layout that does not ship.
           */}
          <div className="grid inv-solo" style={{ gap: '1rem' }}>
            <SoloAccount account={c.account} timeline={TIMELINE} />
          </div>
        </section>
      ))}

      {/**
       * ⚠️ AND THE NESTED SHAPE, WHICH IS A DIFFERENT COMPONENT. `AccountCard` is one card with
       * everything in it, used for an expanded row in the multi-account list and for the admin's
       * "view as any member". It shares both halves with the layout above, so a change to either
       * half lands in two places — and its heading is not second person, because in view-as this
       * is somebody else's money.
       */}
      <section style={{ display: 'grid', gap: '0.4rem' }}>
        <div className="cz-sec" style={{ margin: 0 }}>
          The admin&apos;s nested &ldquo;view as&rdquo;
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
          The same two halves in one card, which is what an expanded row in the 33-account list
          renders. No chart — it is already inside a card, and a card inside a card inside a row is
          where the width runs out.
        </p>
        <AccountCard account={CASES[0].account} timeline={TIMELINE} />
      </section>
    </div>
  )
}
