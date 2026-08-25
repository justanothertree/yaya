# A buy whose amount would not parse became free shares — 2026-08-25

`server/lib/parseTrades.mjs`. Found by review, each case reproduced against the real parser
before and after.

## 1. Unreadable money imported as a corporate action, at zero cost

The Robinhood path validated the trans code, the symbol and the quantity — and never the money:

```js
if (code !== 'Buy' || !symbol || units <= 0) { …skip… }
…
dollars: Math.abs(money(row[at('Amount')])),
```

`money()` returns `0` for anything it cannot read, and `classify()` reads zero dollars with
non-zero units as a corporate action. So the row imported as an `adjustment`, **at zero cost
basis**, counted as neither a trade nor a skip. The Cash App path has had the guard all along
(`if (units <= 0 || dollars <= 0 || price <= 0) skip(...)`); the two brokers disagreed about
whether an unreadable amount was an error.

Three real shapes, all ordinary `Buy` rows:

| Amount       | old                             | new              |
| ------------ | ------------------------------- | ---------------- |
| `$(50.00)`   | 10 units, $0, kind `adjustment` | $50.00 buy       |
| _(empty)_    | 10 units, $0, kind `adjustment` | skipped, counted |
| `-USD 50.00` | 10 units, $0, kind `adjustment` | skipped, counted |

Measured: `kept 3, skips {}, net $0, zero-cost rows 3` → `kept 1, skips {"buy with unreadable
amount": 2}, net $50, zero-cost rows 0`.

`$(50.00)` was a second bug in its own right: `money()` tested for parentheses **before**
stripping the `$`, so the negative branch was missed and `parseFloat("(50.00)")` came back `NaN`.
The `$` comes off first now. The sell path had the same hole and now has the same guard.

`moneyOrNull()` exists so a caller handling money must decide what unreadable means; `money()`
keeps returning `0` for fees and display figures, where that is fine.

## 2. An unparseable date sailed past `--since` and imported undated

```js
const date = toISODate(row[at('Activity Date')], 'robinhood')  // null when it cannot parse
if (since && date && date < since) { …skip… }                  // null date → not filtered
```

Nothing anywhere rejected a null date. Measured with `--since 2026-06-01` over a blank date, an
ISO-shaped date and one real May row: `kept 2, skips {"before 2026-06-01": 1}` — the one row the
filter should have kept was the only one dropped, and both undated rows were imported with
`date: null`.

That poisons everything dated downstream: the holding-period and wash-sale work shipped the same
day, the crossing calendar, `account_ledger` walking a date order to decide whose cash paid for
what. `importKey` also folds the date in via `.join('|')`, which stringifies `null` to empty — so
undated rows collapse against each other on symbol/units/price alone.

Now: `kept 0, skips {"unreadable date": 2, "before 2026-06-01": 1}`. Both parsers, same guard.

## 3. The summary described a different import from the one that happened

`s.sells` was incremented inside the row loop while `kept` and `netInvested` were measured after
de-duplication. Three identical same-day sells reported **"Sells: 3 (−$33.00)"** over an $11 net
— the very collapse the `⚠️ COLLAPSED` block exists to make loud, contradicted by the line above
it. Sells and adjustments are now derived from the de-duplicated `trades` array, so no summary
field can disagree with what was imported: `sells {count: 1, dollars: 11}` against `net -11`.

## Regression check

All seven fixtures in `scripts/fixtures/` parse **identically** before and after — kept, net,
sells, adjustments, DRIPs, skips, first/last date and collapsed dollars all unchanged.
