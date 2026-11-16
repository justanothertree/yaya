-- ⛔ NOT APPLIED. Proposed only — this file is the reasoning, and nothing in it has been run
-- against production. Applying it is `apply_migration`, after which this header becomes
-- ✅ APPLIED with the migration name, per CLAUDE.md §4.
--
-- ── WHY ───────────────────────────────────────────────────────────────────────────────────────
--
-- `admin_correct_position` asserts the true unit count for a position (the tool for a split the
-- broker export missed) by inserting a zero-dollar delta, and then decides whether the family
-- gets a share of that delta:
--
--     select coalesce(sd.is_family, false) into v_family ... from finance.symbol_designations sd
--     if v_family then
--       v_share := finance.family_share_at(v_sym, v_plat, now());
--       ...
--
-- The gate is the SYMBOL'S DESIGNATION. The share underneath it is the family's ACTUAL OWNERSHIP.
-- Those are two different facts, and they come from two different write paths:
--
--   * `admin_set_symbol_designation` writes the designation and even-splits the trades.
--   * `admin_set_trade_allocation` — the "Theirs" button on one trade — writes the allocations
--     and stamps `reviewed_at`, and never touches `symbol_designations` at all.
--
-- So a position can be 100% owned by all 33 family accounts with no designation row anywhere, and
-- a correction to it hands them NONE of the delta. The units stay with Evan; the family's share
-- of the position silently shrinks by whatever the split was worth. Nothing on screen says so,
-- because `familyUnits` does not change — the denominator does.
--
-- ⚠️ MEASURED 14 Nov 2026, and this is not hypothetical. Five held positions are in exactly that
-- state right now, every one of them allocated to all 33 accounts by per-trade answers:
--
--     AKAM  1.0883 units   CURI  33 units   GENI  33 units   MNRO  3.3 units   SKHY  1 unit
--     79.956946 units between them, $813.84 at cost.
--
-- A 2-for-1 on GENI today, corrected with ✏️, would create a +33 unit delta and give the family
-- 0 of it — taking them from 100% of that position to 50% without a word. The function's own
-- comment already names the neighbouring version of this mistake ("THE DELTA IS A CORRECTION TO
-- THE WHOLE POSITION, NOT TO THE FAMILY'S SHARE OF IT ... WEN is 53% family"), which is the half
-- that was fixed. This is the other half: the share is computed correctly and then not asked for.
--
-- ── THE FIX ───────────────────────────────────────────────────────────────────────────────────
--
-- Ask ownership, not the flag. `finance.family_share_at` already returns the fraction of the
-- position the family held immediately before the correction, clamped to 1 and zero when they
-- hold none — so it IS the gate, and the designation lookup has nothing left to decide.
--
-- Behaviour for every other case is unchanged, which is the point:
--   * designated family, family holds units  → identical (the share was already what it used).
--   * designated family, family holds none   → share 0, allocates nothing. Identical. This is
--                                              NFLX and AEON, whose trades are all pre-fund.
--   * designated personal, family holds none → share 0. Identical.
--   * no designation, family holds units     → THE CHANGE: they get their share.
--
-- ⚠️ `familyShare` was already in the return value and read 0 for these; it now carries the real
-- figure, so the admin screen can say what a correction did rather than reporting a confident
-- zero. `allocated` still counts the accounts that received a row.
--
-- ── A SECOND, SMALLER PIECE ───────────────────────────────────────────────────────────────────
--
-- Check 10 below makes the state above findable instead of remembered. The read side of it is
-- already fixed in the page (the positions row names the units the family holds when the symbol
-- is still marked Personal), but the page is a screen somebody has to be looking at;
-- `finance.integrity_checks` is what the Reconcile banner and the attention badge are built on,
-- and it is the honest home for "these two write paths disagree".
--
-- Not an error — the state is legitimate and Evan may well want it. It is a thing to be told.

create or replace function public.admin_correct_position(
  p_symbol text, p_platform text, p_true_units numeric
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_sym text := btrim(p_symbol);
  v_plat text := btrim(p_platform);
  v_current numeric;
  v_delta numeric;
  v_trade_id uuid;
  v_share numeric := 0;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(v_sym,'')='' or coalesce(v_plat,'')='' then
    raise exception 'symbol and platform required';
  end if;
  if p_true_units is null or p_true_units < 0 then raise exception 'true units must be >= 0'; end if;

  -- the WHOLE book, which is right: p_true_units is what the broker shows for the position
  select coalesce(sum(et.units_acquired),0) into v_current
  from finance.executed_trades et
  where et.user_id = v_uid and et.asset_symbol = v_sym and et.platform = v_plat;

  v_delta := p_true_units - v_current;
  if abs(v_delta) < 1e-9 then return jsonb_build_object('delta', 0, 'familyShare', 0, 'allocated', 0); end if;

  insert into finance.executed_trades (
    user_id, asset_symbol, asset_type, platform, execution_time,
    dollar_amount, price, units_acquired, fee, created_at
  )
  select v_uid, v_sym, coalesce(max(et.asset_type),'stock'), v_plat, now(),
         0, 0, v_delta, 0, now()
  from finance.executed_trades et
  where et.user_id = v_uid and et.asset_symbol = v_sym and et.platform = v_plat
  returning id into v_trade_id;

  /**
   * ⚠️ OWNERSHIP, NOT THE DESIGNATION FLAG. This used to read
   * `coalesce(sd.is_family, false)` from finance.symbol_designations and only compute the share
   * inside it — so a position the family wholly owns through per-trade answers, which writes no
   * designation row, received none of its own correction. Measured 14 Nov 2026: AKAM, CURI,
   * GENI, MNRO and SKHY, 79.96 units across all 33 accounts, every one of them exposed.
   *
   * `family_share_at` is already the complete answer: the fraction held immediately before this
   * correction, clamped to 1, and zero when they hold nothing. A symbol marked family that they
   * hold none of still gets zero, which is what the flag was achieving and all it was achieving.
   */
  v_share := finance.family_share_at(v_sym, v_plat, now());
  if v_share > 0 then
    select count(*) into v_n from finance.family_accounts fa
     where fa.dollar_per_day > 0 and now()::date >= fa.start_date;

    if v_n > 0 then
      insert into finance.allocations (family_account_id, executed_trade_id, units_allocated, user_id, created_at)
      select fa.id, v_trade_id, v_delta * v_share / v_n, v_uid, now()
        from finance.family_accounts fa
       where fa.dollar_per_day > 0 and now()::date >= fa.start_date;
    end if;
  end if;

  return jsonb_build_object('delta', v_delta, 'familyShare', v_share, 'allocated', v_n);
end $function$;

revoke all on function public.admin_correct_position(text, text, numeric) from public, anon;
grant execute on function public.admin_correct_position(text, text, numeric) to authenticated;

-- ── Check 10: the two write paths disagree about a symbol ─────────────────────────────────────
--
-- ⚠️ THE BODY OF `finance.integrity_checks()` IS NOT REPRODUCED HERE, because this file has not
-- been applied and copying 6kB of it into a proposal is how the copy and the original drift. The
-- addition is one more row in the union it already returns, in that function's own shape:
--
--     select 10, 'Held by the family, but the symbol is not marked',
--            count(*),
--            'They own units of it from per-trade answers while the symbol still reads Personal. '
--            || 'A ✏️ correction to one of these gives them none of it.'
--       from (
--         select et.asset_symbol, et.platform
--           from finance.allocations al
--           join finance.executed_trades et on et.id = al.executed_trade_id
--           left join finance.symbol_designations sd
--             on sd.asset_symbol = et.asset_symbol and sd.platform = et.platform
--          where coalesce(sd.is_family, false) = false
--          group by et.asset_symbol, et.platform
--         having sum(al.units_allocated) > 0.0001   -- DUST_UNITS; see src/finance/dust.ts
--       ) q
--
-- ⚠️ `> 0.0001` IS `DUST_UNITS` AND IT IS TYPED HERE BECAUSE SQL CANNOT IMPORT IT — the same
-- admission `ReconcilePanel` already makes about check 7's dollar. The question is whether a
-- position is OPEN, which is what DUST_UNITS answers; `DUST_USD` answers whether it is worth
-- drawing and would be the wrong constant.
--
-- ⚠️ AND IT MUST BE `coalesce(sd.is_family, false) = false`, NOT `sd.asset_symbol is null`. A
-- symbol explicitly marked Personal that nonetheless carries family allocations is the same
-- fault and the more alarming one — a null row is an omission, an explicit `false` beside live
-- allocations is a contradiction. Expected count on the live fund as of 14 Nov 2026: **5**
-- (AKAM, CURI, GENI, MNRO, SKHY on Robinhood), all of them the null kind.
