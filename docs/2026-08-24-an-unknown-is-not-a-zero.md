# An unknown is not a zero — 2026-08-24

## What was on screen

The signed-out Investments demo — the first thing any visitor sees, and the page Evan would
show a family member — said this:

> There's **$803.85** invested for 4 people right now. That's **$940.00** short of the
> dollar-a-day promise so far.
>
> GAIN ON HOLDINGS **+$803.85** · BEHIND THE PROMISE **−$940.00** · DAYS BEHIND **≈ 235**

Directly beneath it, its own chart read **Worth $803.85 · Net in $783.00 · Promised $940.00**.

Three things wrong at once:

1. **Behind by $940** is the _entire_ promise. The chart's own figures give $940 − $783 = **$157**.
2. **Gain +$803.85** is the _entire_ portfolio. A gain can only equal the whole value if the
   shares cost nothing.
3. **235 days behind** is the whole life of the fund — it believed nothing had ever been put in.

## Why

`portfolioTotals()` in `src/finance/portfolio.ts`:

```ts
invested += a.contributed ?? 0
basis += a.heldBasis ?? 0
```

`?? 0` turns "we don't know what was put in" into "nothing was put in". Ahead/behind then
becomes `0 − promised` — behind by everything — and gain becomes `value − 0` — up by everything.
Both wrong in the most alarming possible direction, and stated with total confidence.

⚠️ **The single-account function three lines above already got this right**:

```ts
export function aheadBehind(a: AccountPortfolio): number | null {
  ...
  if (a.contributed == null) return null   // "no answer beats a wrong one"
}
```

So the module held two opinions about the same unknown: refuse to answer, and answer zero.
**That is the second time this exact drift has shipped here** — `get_my_portfolio` and
`admin_get_portfolios` did it before, and produced "Put in $0.00". Two functions answering one
question have to agree about what they _don't_ know, not just about what they do.

## Why the demo was the thing that exposed it

`src/finance/demoPortfolio.ts` predates `contributed` / `cash` / `heldBasis` entirely, and
nothing made it keep up. The real accounts have all three, so the bug was invisible in every
signed-in view — it only surfaced where the data was older than the model.

Worth remembering: **the demo is not decoration, it is the only place the code runs against
incomplete data.** It caught a rollup bug that would have hit any real account whose ledger
hadn't been walked yet.

## The fix

- `portfolioTotals()` returns `invested`, `aheadBehind`, `basis`, `gain` and `gainPercent` as
  **nullable**. One account with an unknown contribution nulls the whole total rather than
  quietly counting itself as zero — verified, see below.
- `ScheduleSummary` treats `aheadBehind == null` the same as the server's existing
  "not ready" flag and renders **"Still being set up"** instead of numbers. The gain tile is
  suppressed when the basis is unknown.
- Demo money-in figures are **derived from the holdings**, never typed beside them:

  ```ts
  export const DEMO_PORTFOLIO = DEMO_ACCOUNTS.map((a) => {
    const cost = a.holdings.reduce((s, h) => s + h.cost, 0)
    return { ...a, contributed: cost, heldBasis: cost, cash: 0, ready: true }
  })
  ```

  `demoTimeline()` builds the chart's "Net in" line by summing those same `cost` values, so the
  sentence and the chart cannot disagree however the sample holdings are edited later.

- **Wording.** "There's $803.85 invested … That's $157.00 short" made "that's" refer to a figure
  the sentence never showed; a reader subtracting the two visible numbers gets $136.15. Now:
  "There's $803.85 **in the fund** … **The money put in so far** is $157.00 short."

## Verified

Against the real module, through the dev server (`import('/src/finance/portfolio.ts')`):

| accounts         | invested | aheadBehind | basis    | gain     | gain % |
| ---------------- | -------- | ----------- | -------- | -------- | ------ |
| one, fully known | 100      | −135        | 100      | +50      | 50%    |
| one, unknown     | **null** | **null**    | **null** | **null** | null   |
| one of each      | **null** | **null**    | **null** | **null** | null   |

`value` and `promised` stay real throughout — they are independently knowable.

And the rendered demo now reconciles end to end at 375px, no sideways scroll:

> There's $803.85 in the fund for 4 people right now — those shares are +2.7% up on the $783.00
> they cost. The money put in so far is $157.00 short of the dollar-a-day promise.
>
> GAIN ON HOLDINGS +$20.85 · BEHIND THE PROMISE −$157.00 · DAYS BEHIND ≈ 39

803.85 − 783.00 = 20.85 ✓ · 940 − 783 = 157 ✓ · 157 ÷ 4 = 39 ✓ · per-person −24, −85, −53, +5
sums to −157 ✓
