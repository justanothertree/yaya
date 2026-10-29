-- ✅ APPLIED 29 Oct 2026 as `admin_recent_reviews`.
--
-- Part E §1.2: "After a reload, an answered trade is gone for good (`reviewed_at` set) and no UI
-- can revisit it. … add a 'Recently answered (last 30)' list with a Change button. That needs a
-- small `admin_recent_reviews` RPC."
--
-- The answer to a trade is one tap and there is currently no way back to it. `reviewed_at` is
-- what takes a row out of `trades_needing_review`, so the moment it is stamped the trade leaves
-- the only list that ever showed it — a mis-tap on "All theirs" for a $31,966 sell is invisible
-- and permanent from the screen's point of view.
--
-- ⚠️ IT READS THE ANSWER BACK OFF THE ALLOCATIONS RATHER THAN STORING ONE. Nothing records the
-- fraction that was chosen; `admin_set_trade_allocation` deletes the trade's allocations, stamps
-- `reviewed_at` and inserts `units × fraction` split across eligible accounts. So the honest way
-- to say what the answer WAS is to sum what is there now. That also means the list cannot drift
-- from reality: if something else changed those allocations, this shows the change.
--
-- ⚠️ AND THE FRACTION IS NULL FOR A RESTATEMENT, WHICH IS NOT THE SAME AS ZERO. For an ordinary
-- trade, `sum(allocations) / units_acquired` is the fraction that was answered. For a zero-dollar
-- row — a split, a symbol change — `admin_set_trade_allocation` scales by `family_share_at`
-- first, so the same division gives a number that was never typed and would read as an answer
-- somebody gave. Those report `familyUnits` and no fraction, and the screen shows units instead.
--
-- No new write path: "Change" calls `admin_set_trade_allocation` again, which already replaces
-- rather than adds ("start clean: changing your mind replaces the answer, never adds to it").
-- So this file adds one read and nothing else.

create or replace function public.admin_recent_reviews(p_limit integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'date', t.execution_time::date,
      'reviewedAt', t.reviewed_at,
      'symbol', t.asset_symbol,
      'platform', t.platform,
      'dollars', round(t.dollar_amount, 2),
      'units', t.units_acquired,
      'isFamilySymbol', coalesce(sd.is_family, false),
      'familyUnits', round(coalesce(a.units, 0), 6),
      /* see the header: a zero-dollar restatement has no answerable fraction */
      'fraction', case
        when t.dollar_amount = 0 then null
        when t.units_acquired = 0 then null
        else round(coalesce(a.units, 0) / t.units_acquired, 6) end
    ) order by t.reviewed_at desc, t.id)
    from (
      select et.*
      from finance.executed_trades et
      where et.user_id = v_uid and et.reviewed_at is not null
      order by et.reviewed_at desc, et.id
      limit greatest(1, least(coalesce(p_limit, 30), 200))
    ) t
    left join finance.symbol_designations sd
      on sd.asset_symbol = t.asset_symbol and sd.platform = t.platform
    left join lateral (
      select sum(al.units_allocated) as units
      from finance.allocations al
      where al.executed_trade_id = t.id
    ) a on true
  ), '[]'::jsonb);
end $function$;

-- §3: `revoke … from public` does not cover `anon` in this project — it holds execute directly on
-- much of this schema — so both are named. `authenticated` keeps it because the admin signs in as
-- a member like everybody else; the gate is `is_admin()` on the first line.
revoke all on function public.admin_recent_reviews(integer) from public, anon;
grant execute on function public.admin_recent_reviews(integer) to authenticated, service_role;
