-- A correction follows OWNERSHIP, not the designation flag.
--
-- `admin_correct_position` gated the family's share of a correction on the SYMBOL'S
-- DESIGNATION while computing the share from their ACTUAL OWNERSHIP. Two different facts, from
-- two different write paths: `admin_set_symbol_designation` writes the designation, and
-- `admin_set_trade_allocation` — the "Theirs" button on one trade — writes the allocations and
-- never touches `symbol_designations` at all. So a position the family wholly owns can carry no
-- designation row anywhere, and a correction to it handed them NONE of the delta: their share of
-- the position shrank silently, because `familyUnits` does not change — the denominator does.
--
-- Measured against the whole book before applying, all 203 positions, old gate vs new: 77 + 3 +
-- 118 unchanged, and 5 that change — AKAM, CURI, GENI, MNRO, SKHY on robinhood, 79.956946 units
-- across all 33 accounts, every one of them 100% family-owned and reading 🔒 Personal to the gate.
--
-- No DML. The payload fingerprint across all 33 accounts was byte-identical either side of this
-- (4cdb5581d2c9b9c722461c375c82cbef), which is the point: it changes a decision a FUTURE
-- correction will make, not a row that exists now.
--
-- Reasoning: docs/2026-11-14-correction-follows-ownership.sql
-- Preview:   docs/2026-11-15-correction-preview.md
-- Rollback:  docs/2026-11-15-correct-position-rollback.sql (the live text this replaced,
--            md5 b209b089d5a5da4d563f6303a7a124ba, proved rather than retyped)

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
