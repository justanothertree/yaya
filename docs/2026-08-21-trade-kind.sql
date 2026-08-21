-- ============================================================================
-- ✅ APPLIED 2026-08-21. Migrations: executed_trades_remembers_what_kind_of_event_it_was,
--    admin_import_trades_stores_the_kind
--
-- The importer has always known the difference between a purchase, a sale, a dividend paid in
-- shares, and a corporate action. The database had nowhere to put it, so all four arrived as
-- identical rows — the mechanical reason "dividends and splits throw the values off really bad".
--
--   * a DRIP buys shares with money the HOLDING earned. Stored as a plain buy, it looks like
--     money Evan contributed, so "invested" counts dollars he never put in.
--   * a split or symbol change moves units with no money at all. Stored as a trade it has a
--     price of 0 — true, but indistinguishable from a broken row.
--
-- PURELY ADDITIVE, and deliberately applied BEFORE the catch-up import: the column is nullable,
-- nothing reads it yet, no import_key changes, no existing row moves. The payoff is that when
-- the 50 days of missing trades land, they arrive already classified rather than needing to be
-- untangled afterwards.
--
-- ── what is backfilled, and what is not ───────────────────────────────────
-- Backfilled: 'adjustment', where dollar_amount = 0 and price = 0 and units <> 0. Nothing else
-- looks like that. 87 rows.
--
-- NOT backfilled: buy/sell by sign. A positive amount really is money in, so it would be safe on
-- its own — but it would also stamp 'buy' on every historical DRIP, asserting the one thing that
-- cannot be recovered and burying it under a value that looks authoritative. 1,481 rows stay
-- NULL, which is the honest record of "this predates classification". Recovering buy-vs-drip for
-- them needs a re-import of the original CSVs with an upsert that UPDATES kind — today's
-- on-conflict-do-nothing would skip them.
--
-- ── trust model in admin_import_trades ────────────────────────────────────
-- An explicit `kind` is honoured only if it is one of the four known values; anything else is
-- discarded and the row falls through to derivation. Derivation sets only what is certain
-- (adjustment, sell) and leaves buy-vs-drip NULL rather than guessing. A payload with no `kind`
-- at all behaves exactly as before, so an older copy of the script keeps working.
--
-- VERIFIED (rolled back, as admin): sent 'drip' -> stored drip; no kind + no money -> adjustment;
-- no kind + negative dollars -> sell; sent 'nonsense' -> NULL, not silently coerced to 'buy'.
--
-- ── client side ───────────────────────────────────────────────────────────
-- scripts/import-trades.mjs now emits `kind` from classify(). ⚠️ `kind` is NOT part of
-- importKey — it describes a row, it does not identify one. Folding it in would change the key
-- of everything already imported and make the next re-import insert duplicates of all of it.
--
-- ⚠️ classify() tests `reinvestment` BEFORE the no-money check. A Robinhood SDIV is a dividend
-- paid in shares: units move, zero dollars, so it looks exactly like a split — but the holding
-- earned it. Calling it an adjustment happens to give the right answer for "what did Evan
-- contribute" (neither counts) and the wrong one for "what have dividends earned me".
--
-- Fixture classification, all four checked:
--   rh-corporate      1 buy, 2 adjustment (SXCH pair), 1 drip (SDIV)
--   cashapp-sample    2 buy, 1 sell, 1 drip
--   robinhood-sample  2 buy, 1 sell, 2 adjustment (SPR pair)
--   sell-shapes       3 sell
-- ============================================================================

alter table finance.executed_trades
  add column if not exists kind text
  check (kind is null or kind in ('buy','sell','drip','adjustment'));

update finance.executed_trades
   set kind = 'adjustment'
 where kind is null and dollar_amount = 0 and coalesce(price,0) = 0 and units_acquired <> 0;

create index if not exists executed_trades_kind_idx
  on finance.executed_trades (kind) where kind is not null;

-- admin_import_trades body: see the migration named above.
