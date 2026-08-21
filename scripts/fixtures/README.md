# Import fixtures

Small broker-export samples for exercising `scripts/import-trades.mjs` without needing a real
statement. **Every value here is invented** — made-up tickers (ZZTOP, QUACK, WIDG), made-up
amounts, made-up transaction ids. Nothing in this folder is anyone's real financial data, which
is why it can live in a public repo.

Run any of them as a dry run — nothing is written to the database:

```bash
node scripts/import-trades.mjs scripts/fixtures/robinhood-sample.csv
```

## What each one covers

**`robinhood-sample.csv`** — the Robinhood shape (`Activity Date, Instrument, Description,
Trans Code, Quantity, Price, Amount`).

- a buy whose Description is a **multi-line quoted field** (name / class / CUSIP on separate
  lines). This is the case the hand-written RFC-4180 parser exists for; a naive line-split
  shreds it and every row after it. If the summary says anything other than 6 rows, that parser
  has regressed.
- a sell
- an `SPR` reverse-split pair (`3S` shares out, `3` shares in) → counted as adjustments, not buys
- a `CDIV` cash dividend → skipped

Expected: 6 rows, 5 kept, 2 adjustments, 1 skipped.

**`cashapp-sample.csv`** — the Cash App shape (`Date, Transaction Type, Asset Type, Notes,
Asset Amount, Asset Price, Net Amount, Amount, Fee, Transaction ID`).

- a bitcoin buy, a stock buy, a stock sell
- `Stock Dividends` **reinvested** → a DRIP, kept
- `Stock Dividends` **not** reinvested → cash, skipped

Expected: 5 rows, 4 kept incl 1 reinvestment, 1 skipped.

**`sell-shapes.csv`** — the three ways a Cash App sell can arrive: positive units, negative net
amount, and **negative `Asset Amount`**. That last one used to be dropped as "unparsed sell",
because the guard rejected `units <= 0` — direction actually comes from `Transaction Type`, not
from the sign. All three must parse.

Expected: 3 rows, 3 kept, 0 skipped.

**`rh-identical.csv`** — three byte-identical Robinhood buys on the same day.

Robinhood rows carry no transaction id, and `Activity Date` has no time on it, so the dedupe key
is a hash of (date, symbol, units, price, dollars). Three genuine $20 purchases are therefore
indistinguishable from one row listed three times, and collapse to a single $20 trade — two
thirds of the money gone.

The importer does **not** silently swallow that any more: it prints a `⚠️ COLLAPSED` block naming
the dollars that were not imported and listing the rows, so it can be checked against a statement.

Expected: 3 rows, 1 kept, ⚠️ 2 collapsed / $40.00 not imported.

⚠️ Fixing this properly means adding an occurrence ordinal to the key — which changes the key of
every Robinhood row **already imported**, so the next run would insert a second copy of the whole
Robinhood history. That needs a migration, not a patch. Until then the warning is the safeguard.
