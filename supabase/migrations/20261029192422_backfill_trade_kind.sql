-- ✅ APPLIED 29 Oct 2026 as `backfill_trade_kind`.
--
-- Part C, P3.6: "backfill empty `kind` using the parser's rules: no money + share change =
-- adjustment, negative money = sell, otherwise buy. Leave reinvestment-vs-buy empty where it
-- can't be told."
--
-- ⚠️ THE LAST SENTENCE OVERRULES "OTHERWISE BUY", AND THAT IS WHY 1,202 ROWS ARE LEFT ALONE.
-- `classify()` in server/lib/parseTrades.mjs reads:
--
--     if (t.reinvestment) return 'drip'
--     if (t.dollars === 0 && t.units !== 0) return 'adjustment'
--     return t.dollars < 0 ? 'sell' : 'buy'
--
-- The first line is the one a stored row cannot answer. `reinvestment` comes from the broker's
-- own transaction code — CDIV, DRIP, a Cash App reinvestment flag — and none of that survives
-- into `finance.executed_trades`, which keeps money, units, price and a symbol. So from a row
-- alone, positive money is a buy OR a dividend reinvestment and there is no way to tell. Calling
-- all 1,202 of them "buy" would be inventing a fact about somebody's money, and it would be
-- invisibly wrong: 24 rows in this table are already labelled `drip`, so the shape exists.
--
-- Backfilled, because these two are decidable from the row and agree with the parser exactly:
--   dollar_amount < 0                            → sell          279 rows
--   dollar_amount = 0 and units_acquired <> 0    → adjustment       0 rows today
--
-- The adjustment clause is kept although it matches nothing, so a replay against a database that
-- does have such rows lands in the same place. All 92 adjustments here were already labelled.
--
-- ⚠️ CHECKED BEFORE WRITING, because "negative money" is a rule and not an observation: all 279
-- also have negative `units_acquired`, min −31,966.09 and max −0.99, and none has zero or
-- positive units. There is no row where the two signs disagree, which is what a fee or an odd
-- corporate action would have looked like.
--
-- Dry run in a rolled-back transaction, then applied and re-measured:
--   sells 3 → 282, adjustments 92 → 92, still empty 1,202, total 1,721
--   rows with non-positive money and no kind afterwards: 0
--
-- ⚠️ AND IT CHANGES NOTHING ON SCREEN TODAY, said plainly rather than implied. Nothing in the
-- client reads `kind` — not the member card, not the import panel, not an RPC payload. New
-- imports have carried it since `classify()` existed; this is the history catching up, so that
-- the column means the same thing for every row whenever something does read it.

update finance.executed_trades
   set kind = case when dollar_amount = 0 and units_acquired <> 0 then 'adjustment'
                   when dollar_amount < 0 then 'sell' end
 where (kind is null or btrim(kind) = '')
   and (dollar_amount < 0 or (dollar_amount = 0 and units_acquired <> 0));

do $$
declare v_bad int;
begin
  /* ⚠️ ASSERTED ON THE RULE, NOT ON THE COUNT. A row-count assertion would be a claim about this
     database on this day; this one says the invariant the backfill exists to create — nothing
     decidable is left undecided — and stays true on a replay against any data. */
  select count(*) into v_bad from finance.executed_trades
   where (kind is null or btrim(kind) = '')
     and (dollar_amount < 0 or (dollar_amount = 0 and units_acquired <> 0));
  if v_bad > 0 then
    raise exception '% trades still have no kind despite being decidable', v_bad;
  end if;
end $$;
