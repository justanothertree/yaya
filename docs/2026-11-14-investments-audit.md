# Reconciling the fund against the brokers — 14 Nov 2026

Evan read the two broker apps on the evening of Sat 14 Nov 2026, right after importing both
exports, and asked what the site disagreed with. Everything below is measured against production
by replaying the RPCs' own bodies in SQL; nothing was written.

The import landed at **02:12–02:13 UTC on 15 Nov** (≈21:12 ET Saturday). The four price-sweep
crons run at **21:10, 21:12, 21:14 and 21:16 UTC**, so the day's last sweep was ~5 hours _before_
the import. That one fact is most of what follows.

## The numbers

Page figures are from the Admin → Investments hero and the Reconcile table's "everything you
hold" total — the same arithmetic, read two ways, agreeing to the cent.

| Number                     | Page           | Broker app     | Gap         | Cause                                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------- | -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cash App — stocks          | $13,563.93     | $13,527.00     | **+36.93**  | Price source. Every Cash App stock is quoted at Friday's 16:12 ET close (today is Saturday — identical to Friday's capture, to the cent, on 13 of 14 symbols). Cash App shows its own last price, which includes Friday's extended-hours session. 0.27% — seven cents on BRCB alone covers it. |
| Cash App — bitcoin         | $2,532.46      | $2,558.30      | **−25.84**  | Price timing. BTC cached at 64,301 (21:16 UTC); Evan's figure implies 64,958 — +1.0% over ~6 hours. Crypto trades round the clock and the sweep is once a day. Units agree: 0.039384.                                                                                                          |
| Robinhood — stocks         | $6,281.87      | $7,259.00 ¹    | **−977.13** | **Seven positions imported after the day's last sweep have no price at all, so they are excluded.** $813.84 at cost, plus ~7 weeks of movement since late September. This is the real finding.                                                                                                 |
| Robinhood — crypto         | $32.65         | $35.00         | −2.35       | Same-day crypto timing, and the app figure is rounded.                                                                                                                                                                                                                                         |
| **Everything (portfolio)** | **$22,410.91** | **$23,379.30** | **−968.39** | Sum of the above; 98% of it is the Robinhood row.                                                                                                                                                                                                                                              |
| Family fund (worth)        | $12,534.59     | —              | —           | Understated by the same cause: six of the seven unpriced positions are split across all 33 accounts.                                                                                                                                                                                           |

¹ Robinhood's "total value" may or may not include the $35 of crypto. Excluding it the gap is
$977.13; including it, $944.48. Either reading is explained by the same seven positions.

⚠️ **Two figures in this table were corrected on 15 Nov**, re-measured against an unchanged
`price_cache` (its newest row is still 14 Nov 21:16 UTC, so nothing moved underneath them): Robinhood
crypto is **$32.65**, not $34.65, and the portfolio total is therefore **$22,410.91**, not $22,412.91.
The four coins are DOGE $16.1451, ZORA $14.0271, ETH $1.4988 and XRP $0.9777 — the original figure was
an addition slip of exactly $2.00 on my part, carried straight into the total beneath it. Nothing else in
the audit depended on it, and the Robinhood stock row — the finding — is unchanged. Recorded rather than
quietly edited, because §2 is about my own numbers too.

**The verdict: no number on the page is wrong. One number is incomplete, and says so.**

## The seven

All imported at 02:12:54 UTC, all new symbols to the fund, all with trades dated 30 Jun – 25 Sep.

| Symbol | Units    | Cost    | Family                        |
| ------ | -------- | ------- | ----------------------------- |
| GENI   | 33       | $209.39 | all 33 accounts               |
| SKHY   | 1        | $191.58 | all 33                        |
| AKAM   | 1.0883   | $132.00 | all 33                        |
| PRGO   | 8.568646 | $132.00 | all 33                        |
| CURI   | 33       | $102.80 | all 33                        |
| MNRO   | 3.3      | $46.07  | all 33                        |
| IRLA   | 2        | $0.00   | personal (symbol-change pair) |

`finance.refresh_prices` orders its work `by staleness asc nulls first`, so a symbol with no
cached price is already first in the queue — the 55-a-run cap cannot starve them. They were
simply never asked, because the import happened after the last run of the day. Left alone, the
next sweep (21:10 UTC) prices them and all four figures close.

**Fixed in this change:** the import asks for a price pass of its own, from the panel, so a file
imported at any hour is worth something immediately. It is reported separately from the import,
like `splitError`, because the trades are already in by then.

## Missing, duplicated, untagged

**Duplicates: none.** Two groups of same-shape rows exist — MTCH ×4 ($50 each, 2020-07-01) and
SPCE ×2 ($100 each, 2025-09-16) — and all six carry _distinct_ `import_key`s. That is
`makeTrade` working as designed: Cash App rows are keyed on their Transaction ID
(`cashapp|id|<txid>`) precisely so genuine repeat buys are not collapsed. They are six real
transactions.

**Missing: none detectable, with one known exposure.** The import windows are continuous (Cash
App 28 Oct → 29 Oct, Robinhood overlapped back to 30 Jun and deduped on `import_key`), and the
only negative positions in the book are LCID (−0.003975) and CCIV (−0.000036), both the
documented four-decimal symbol-change residue rather than a missing buy.

The exposure is the one `parseTrades` already declares: **Robinhood rows have no transaction ID**,
so their key is a hash of (date, symbol, units, price, dollars) and Activity Date carries no time.
Three real $20 buys of the same stock on the same day collapse to one. The parser refuses to hide
it — `summary.collapsed` lists every dropped row and `collapsedDollars` totals them — but that
list lives only in the import screen at the moment of import and nothing recovers it afterwards.
**Nothing in the database can tell you whether tonight's file lost rows.** To check, re-run the
parse on the same CSV and read the collapsed block. Fixing it properly needs a migration, not a
patch: an occurrence ordinal changes the key of every Robinhood row already imported, and
`import_key` is what makes re-imports idempotent.

**Untagged: nothing in the queue.** `finance.trades_needing_review` returns **0**. All 53 rows of
tonight's import are answered — 43 allocated, 2 kept personal (BRCB $1,500.00 and APD $0.01), 2
IRLA adjustments personal. Of the 21 held positions worth $9,511.32 that carry no
`symbol_designations` row, every post-fund trade has been answered individually (40 trades,
$7,065.64); the 172 that were never answered are all dated before the fund started on 2025-12-10
and are correctly unanswerable.

But see the next section — _answered_ and _designated_ are not the same thing, and the screen
could not tell them apart.

## Held by the family, marked Personal

`admin_set_trade_allocation` — the "Theirs" button on one trade — creates the allocations and
stamps `reviewed_at`. It never writes `finance.symbol_designations`. The positions row and the
Reconcile table both read `isFamily`, which is the _symbol's_ designation, so five positions
rendered as 🔒 **Personal** while all 33 family accounts held units of them:

**AKAM, CURI, GENI, MNRO, SKHY** on Robinhood — 79.96 units, $813.84 at cost. (PRGO is the same
shape and escaped it only because Evan also pressed the symbol toggle, at 02:15.)

It is not a contradiction in the data; it is two write paths and one read. Three consequences:

1. The one screen built to say who owns what could not say it. **Fixed here** — the row names the
   units the family holds, and the hero lists the affected symbols.
2. `admin_even_split_trades` will not auto-split future trades of those symbols. That is arguably
   right — they come back to the review queue instead — and is left alone.
3. **`admin_correct_position` gates the family's share of a correction on that same flag.** Fixing
   a missed split on one of these hands them none of it, silently. That one is a real latent loss
   and needs SQL — see `2026-11-14-correction-follows-ownership.sql`, **not applied**.

## Two figures that described the trade history and called it holdings

`admin_list_positions` deliberately has no `units > 0` filter: the trades ledger underneath it
needs every symbol ever traded. Every count taken of it inherited that.

- Per-broker line: **Cash App read "103 holdings"** and holds **15** — 88 closed years ago.
  Robinhood read 100 and holds 91.
- The unpriced warning read **16** when **7** held positions are unpriced; 9 of the 16 are closed
  positions contributing nothing to either figure above it. The one line on the screen whose job
  is to say how much is not known was overstating itself 2.3×.
- The per-broker subtotal used `(p.value ?? 0)` — **the same `?? 0` whose removal from the hero
  stat eleven lines above is documented in that stat's own comment.** Robinhood's subtotal was
  quietly counting the seven unpriced positions as $0 with nothing said. Cause and consequence
  shipped apart; §2.

All three fixed here.

## A holding the feed gave up on

`pricedAsOf` on the member card is the **newest** price on the account, and `pricesStale` asks
"has the feed stopped" — deliberately, pinned by a test. So a single abandoned symbol is invisible
there however old it gets: it is one date among eighty and the maximum does not move.
`finance.store_prices` only writes a quote above zero, so a delisted symbol keeps its last price
and its last date for ever while every sweep passes over it.

Live: **FATAQ**, 30 units held by all 33 accounts, priced **$0.0001 on 17 September** — 58 days,
with `pricesStale` false the whole time. The admin side catches it (integrity check 6). The card a
family member reads had nothing to say about it.

Added: `stalePriced` / `stalePricedWorth` on `accountNumbers`, and a line on the card. It speaks
only above the `isDust` dollar — FATAQ is three tenths of a cent, and warning a child about that
is the checker crying wolf at its own dust — and only when `pricesStale` is **off**, because when
the feed has stopped the line above already says it. Both of those were found on screen in
`#dev-investments`, which has a case for it now.

## What the audit did not find

- **Integrity checks 1, 2, 3, 4, 7, 8 are all zero.** No over-allocation, no negative family
  holdings, nothing dated before its account, every trade split evenly, nothing credited to the
  family that Evan has since sold.
- **Cost basis is sound.** `heldBasis` $17,610.12 against a market value of $12,534.59 — a real
  28.8% loss on the shares held, measured at average cost against money-in-free arithmetic. It is
  overstated by whatever the six unpriced family positions are worth ($813.84 at cost), which the
  card discloses.
- **The cash line is $0.00 on all 33 accounts**, correctly: `account_ledger` draws sale proceeds
  down against the next buy, and everything has been reinvested.
- **Contributed $18,104.13 against $11,187.00 promised** — the fund is $6,917.13 ahead of the
  dollar-a-day promise, which is money in versus money promised and never market value.
- **Small pieces behave.** 37 of 82 holdings per account are under $1, $14.46 a head and $477.10
  across the fund; they fold into one row that still counts them, and the unpriced ones never
  fold. `dust.ts`'s own measured figures were re-taken; the denominator had moved from 76 to 82.
- **No symbol is recorded as both a stock and a coin**, which matters because `price_cache` is
  keyed on symbol alone.
- Integrity check 9 ("marked family, but nothing can be allocated") is 2: **NFLX and AEON** on
  Robinhood, $65.21, every trade pre-fund. Correctly flagged, left for Evan to undesignate.

## Still open, needing Evan

1. `2026-11-14-correction-follows-ownership.sql` — **not applied**, needs a go-ahead.
2. The Robinhood same-day collapse. Needs a migration that re-keys the history.
3. NFLX and AEON: undesignate, or leave the decision sitting there.
4. FATAQ is delisted as far as Finnhub is concerned. `admin_set_price` is the keyless fallback if
   it is worth anything; integrity check 6 will keep reporting it until something changes.
