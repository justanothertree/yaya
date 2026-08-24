# Two rules for the word "worth" — 2026-08-24

## The contradiction

Two functions in the Investments module decide what a family account is _worth_, and they
disagree about cash. Both disagreements are deliberate, and both comments defending them are
correct:

`src/finance/portfolio.ts` — `accountValue()`:

> ⚠️ Cash from sales is deliberately kept OUT of the headline and shown beside it as "still to
> be invested". Folding it in asserts money is theirs that may since have been spent … never
> overstate what somebody has.

`src/finance/timeline.ts` — `buildDailySeries()`:

> Cash counts. Without it the "Worth" line dropped by the whole position every time something
> was sold, which is the same money-disappearing bug the accounts had.

Both are right _for their own job_. A headline figure should be conservative. A time series must
not fall off a cliff the day something is sold. The problem is that both were labelled **Worth**
and shown on the same screen, one directly above the other.

## What it would have looked like

Buy 10 shares at $10, then sell 4 of them at cost:

|                | shares | cash | chart "Worth" | card "in the fund" |
| -------------- | ------ | ---- | ------------- | ------------------ |
| after the buy  | $100   | $0   | $100          | $100               |
| after the sale | $60    | $60  | **$120**      | **$60**            |

A two-times discrepancy between two numbers a few hundred pixels apart, with nothing on screen
accounting for it.

**It has not fired yet** — family cash is $0.00 today, so the two agree by accident. It fires the
first time Evan sells something for the family, which he has said he intends to do ("i want any
profits of a sale to be cash for them to be reinvested").

The chart's own legend hint had already gone stale from the same cause: it read "What the
holdings are worth at each day's prices", which stopped being true when cash was folded in.

## The fix

Neither number changes — changing either would break the reasoning that produced it. Instead the
chart shows its working.

`SeriesPoint` carries `shares` and `cash` alongside `value`, so the tooltip can say where the
total came from:

> **Worth $120.00**
> $60.00 in shares + $60.00 cash

Rendered only when there is cash — otherwise it is a breakdown of a number into itself. The
legend hint now reads "…plus cash from any sales".

## Verified

Against the real module through the dev server, with a buy then a partial sale:

| date                  | invested | value | shares | cash |
| --------------------- | -------- | ----- | ------ | ---- |
| before the buy        | 0        | null  | null   | 0    |
| after buying 10 @ $10 | 100      | 100   | 100    | 0    |
| after selling 4 @ $10 | 100      | 120   | 60     | 60   |
| price rises to $15    | 100      | 150   | 90     | 60   |

`invested` correctly stays at $100 across the sale — a sale is not a withdrawal of Evan's money,
it moves theirs into cash. The signed-out demo still renders with no breakdown line, because it
has no sells and therefore no cash.
