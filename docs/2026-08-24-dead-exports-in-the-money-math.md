# Dead exports in the money math — removed 2026-08-24

Following the same idea as `docs/removed-rpcs-2026-07-30.sql`: record what was taken out and
why, so restoring it is a copy-paste rather than an archaeology exercise.

## Why this sweep happened

`accountGain()` was found exported, carefully documented — it carries the explanation of the
"+127.8% while the holdings were down 11.9%" incident — and **imported by nothing**. The card a
family member reads had rolled its own cost basis instead, and showed no gain at all when its
data was thin.

That suggested a general check: _an exported function with a careful cautionary comment that
nothing imports is a fix that was written but never wired up._ So every exported symbol in `src`
was checked for callers outside its own file. 253 exports, 10 with no external reference, 8 of
those false positives (used internally, or by `scripts/gen-public-seed.mjs`).

The two real ones were both in `src/finance/portfolio.ts`, the highest-stakes file on the site.

## What was removed

Both summed `h.cost` across holdings. That is **net cash** — buys minus sell proceeds — and the
`heldBasis` field six lines above them says exactly why that is the wrong quantity:

> ⚠️ Not the sum of `cost` across holdings: that is net cash (buys minus sells) and for a
> churned symbol it can be negative while real shares are still held.

So the file contained two helpers computing the precise quantity another comment in the same file
warns you not to use — one of them advertising itself as "market value + gain/loss".

```ts
/** Market value + gain/loss across an account's PRICED holdings. Null until any price is
 *  cached. Deliberately separate from the ahead/behind schedule, which stays cost-vs-promised. */
export function accountMarket(a: AccountPortfolio): {
  value: number
  gain: number
  priced: number
  unpriced: number
} | null {
  let value = 0
  let cost = 0
  let priced = 0
  let unpriced = 0
  for (const h of a.holdings) {
    if (h.price == null) {
      unpriced++
      continue
    }
    priced++
    value += h.units * h.price
    cost += h.cost
  }
  if (priced === 0) return null
  return { value, gain: value - cost, priced, unpriced }
}

/** Total dollars invested (at cost) across an account's holdings. */
export const accountTotalCost = (a: AccountPortfolio): number =>
  a.holdings.reduce((s, h) => s + h.cost, 0)
```

`accountMarket`'s `gain: value - cost` is the superseded formula itself — gain measured against
money-in rather than against the basis of what is still held.

## What to use instead

| want                           | use                                                                     |
| ------------------------------ | ----------------------------------------------------------------------- |
| what an account is worth today | `accountValue(a)` — priced holdings at market, cash excluded on purpose |
| gain or loss on the shares     | `accountGain(a)` — against `heldBasis`, the server's average-cost walk  |
| how many holdings lack a price | count `a.holdings.filter(h => h.price == null)` at the call site        |

The unpriced count was the one genuinely useful thing `accountMarket` returned, and `AccountCard`
already computes it locally for its ⓘ panel.

## The other eight

Not dead, left alone: `promisedToDate` (used by `aheadBehind` and `portfolioTotals` in the same
file), `challengeLink`, `circuitJoinLink`, `itemsInGroup`, `runSupabaseDebug` (all used by other
exports beside them), `circuitSeed` (used by `scripts/gen-public-seed.mjs`, which a
`src`-only grep misses), `PRESETS`, `PREVIEW_ROOMS`.

⚠️ `circuitSeed` is the one to be careful with in any future sweep of this kind — its only
consumer is a build script outside `src`.
