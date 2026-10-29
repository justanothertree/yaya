-- ✅ APPLIED 29 Oct 2026 as `ktos_pep_are_family`.
--
-- Part C of Yaxa's review, "Family tags: KTOS and PEP (decided Oct 28)": both confirmed 100%
-- family, their Robinhood trades already split 33 ways, and only the tag missing.
--
-- ⚠️ IT GOES THROUGH THE ADMIN RPC, NOT AN INSERT, which is why the session is simulated rather
-- than the row written directly. `admin_set_symbol_designation` upserts the designation AND calls
-- `admin_even_split_trades` for the caller, and that second half is the whole risk — so running
-- the table write by hand would be testing something other than what the admin UI does. The draft
-- said the UI was the better route "because that path is the one a second person could repeat";
-- this is that path, with the repeat written down.
--
-- The uuid is looked up rather than pasted, so this stays replayable.
--
-- CHECKED FIRST, as the review asks ("Check whether they're already set before you change
-- anything"), and re-checked today rather than trusting the draft's table:
--
--   symbol  platform    is_family  has_row  trades  earliest     latest       unallocated  after fund start
--   KTOS    robinhood   null       0        1       2026-08-24   2026-08-24   0            0
--   PEP     robinhood   null       0        3       2026-08-20   2026-09-10   0            0
--   PEP     cashapp     null       0        4       2020-07-01   2025-10-13   4            0
--
-- ⚠️ THERE IS A **PEP ON CASHAPP** AND THE DRAFT NEVER MENTIONED IT. Four trades, net zero units —
-- a position bought and sold out — with all four unallocated. The calls below name `robinhood`
-- explicitly, so it is untouched, which is correct: it is a different holding on a different
-- platform and nobody has decided anything about it. Named here so the next person does not read
-- "PEP is family" and assume both.
--
-- ⚠️ AND THE REAL QUESTION IS NOT ABOUT THESE TWO SYMBOLS. `admin_set_symbol_designation`
-- delegates to `admin_even_split_trades(v_uid, true)`, which sweeps EVERY unallocated
-- family-designated trade for that user — not only the symbol pressed. That is the failure mode
-- Part F warns about for LCID. Enumerated before running: **159 unallocated designated trades**
-- across 39 symbol/platform pairs (97 SPCE, 12 BTC, 3 FHTX, the rest ones and twos), and every
-- single one dated **before the fund's start of 2025-12-10** — so the per-trade eligible count is
-- zero for all of them and the sweep allocates nothing. The query is in docs/2026-10-29-*.md.
--
-- DRY RUN FIRST, in a rolled-back transaction, because this is a live write to the fund:
--
--   KTOS said   {"family": true, "allocationsCreated": 0, "allocationsRemoved": 0}
--   PEP  said   {"family": true, "allocationsCreated": 0, "allocationsRemoved": 0}
--   allocations 14,223 before → 14,223 after
--   cost basis  74 symbols → 76: KTOS at avgCost 56.1606 and PEP at 142.2719 appear, and every
--               other symbol's avgCost is byte for byte what it was
--
-- ⚠️ THAT LINE FIRST SAID "76 → 78" AND NOBODY HAD COUNTED, including me. The dry run printed the
-- two cost-basis arrays and I read the change off them by eye, then wrote a figure. Counted
-- afterwards with `jsonb_array_length` it is 76 TOTAL, with both new symbols already in it — so
-- the before was 74. The arrays were right and the sentence about them was invented, which is
-- §2's own rule turned on its author: a count used as evidence is a measured number, and nothing
-- downstream would ever have contradicted this one.
--
-- That last line is what the tag buys: `_fund_timeline` joins `symbol_designations … and
-- d.is_family`, so until these rows existed both symbols were left out of the chart's cost basis
-- (Part C P3.5). Future PEP dividend reinvestments will also auto-split instead of queuing for
-- review (P3.4).

select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from public.admin_users order by user_id limit 1),
                    'role', 'authenticated')::text, true);

select public.admin_set_symbol_designation('KTOS', 'robinhood', true);
select public.admin_set_symbol_designation('PEP', 'robinhood', true);

do $$
declare v_rows int; v_allocs int;
begin
  select count(*) into v_rows from finance.symbol_designations
   where platform = 'robinhood' and asset_symbol in ('KTOS','PEP') and is_family;
  if v_rows <> 2 then raise exception 'expected 2 family designations, found %', v_rows; end if;

  /* ⚠️ ASSERTED, BECAUSE THE SWEEP IS THE PART THAT COULD SURPRISE. If a later import has left an
     unallocated designated trade dated on or after the fund's start, this number moves and the
     dry run above no longer describes what happened. */
  select count(*) into v_allocs from finance.allocations;
  if v_allocs <> 14223 then
    raise exception 'allocations moved from 14223 to % — the sweep caught something; read the header',
      v_allocs;
  end if;
end $$;
