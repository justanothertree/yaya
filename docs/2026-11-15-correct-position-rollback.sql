-- ROLLBACK for `20261116020828_correction_follows_ownership`, applied 16 Nov 2026 02:08:28 UTC.
--
-- ⚠️ This file was written on 15 Nov, before the apply was refused and then approved, so it named
-- the migration `20261115_correction_follows_ownership` — a version that never existed. Corrected
-- here rather than left to be discovered by somebody following it in a hurry, which is the only
-- time anybody reads a rollback.
--
-- This is the EXACT text of `public.admin_correct_position` as production ran it before that
-- migration, captured from `pg_get_functiondef` at 2026-11-15 14:03 UTC (09:03 Eastern) and
-- fingerprinted so it can be proved to be that text rather than a retyping of it. The forward
-- migration left the function at md5 `5f10f7e40e747bc4294b3c634a95ea57`, so the two are
-- distinguishable by a single query before and after either direction:
--
--   md5(pg_get_functiondef(oid)) = b209b089d5a5da4d563f6303a7a124ba
--   octet_length                 = 2816 bytes  (length() says 2812 — CHARACTERS, not bytes:
--                                  the one ⚠️ in the body is 2 characters and 6 bytes, and the
--                                  4-byte gap is the whole of the difference. Same trap as
--                                  `octet_length` vs `JSON.stringify().length` in CLAUDE.md §4.)
--   verified by extracting the body below and md5-ing it: the hashes match, so this file is
--   production's own text and not a transcription of it.
--
-- To undo: run the body below as a migration of its own. It is a `create or replace`, so it
-- restores behaviour and touches no rows — the same reason the forward migration is safe.
--
-- ⚠️ ROLLING THIS BACK RE-OPENS THE LOSS IT CLOSED. Five positions (AKAM, CURI, GENI, MNRO, SKHY
-- on Robinhood, 79.956946 units, $813.84 at cost) are 100% owned by all 33 family accounts with no
-- `symbol_designations` row, so under the text below a ✏️ correction to any of them hands the
-- family 0% of its own delta. Measured, not supposed: `finance.family_share_at` answers 1.000000
-- for each of the five and the old gate answers false.
--
-- ⚠️ AND THE ACL IS NOT PART OF THIS FILE, deliberately. `create or replace function` preserves
-- existing privileges, so neither direction changes them. Verified before and after:
--   anon=false, authenticated=true, service_role=true
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.admin_correct_position(p_symbol text, p_platform text, p_true_units numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'finance', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_sym text := btrim(p_symbol);
  v_plat text := btrim(p_platform);
  v_current numeric;
  v_delta numeric;
  v_trade_id uuid;
  v_family boolean;
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

  select coalesce(sd.is_family, false) into v_family
  from (select 1) one
  left join finance.symbol_designations sd
    on sd.asset_symbol = v_sym and sd.platform = v_plat;

  if v_family then
    /**
     * ⚠️ THE DELTA IS A CORRECTION TO THE WHOLE POSITION, NOT TO THE FAMILY'S SHARE OF IT.
     * This used to allocate 100% of it. WEN is 53% family and 47% Evan's; correcting it handed
     * the family a delta computed over shares half of which were never theirs.
     */
    v_share := finance.family_share_at(v_sym, v_plat, now());
    select count(*) into v_n from finance.family_accounts fa
     where fa.dollar_per_day > 0 and now()::date >= fa.start_date;

    if v_share > 0 and v_n > 0 then
      insert into finance.allocations (family_account_id, executed_trade_id, units_allocated, user_id, created_at)
      select fa.id, v_trade_id, v_delta * v_share / v_n, v_uid, now()
        from finance.family_accounts fa
       where fa.dollar_per_day > 0 and now()::date >= fa.start_date;
    else
      v_n := 0;
    end if;
  end if;

  return jsonb_build_object('delta', v_delta, 'familyShare', v_share, 'allocated', v_n);
end $function$
