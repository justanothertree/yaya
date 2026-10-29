-- ✅ APPLIED 29 Oct 2026 as `unallocated_trades_carry_eligible_count`.
--
-- Part E §1.3 asks the Part… control to show "$20 of $60 → 33% theirs ≈ 0.0101 sh each × 33"
-- before anything is written. The × 33 is the part the screen could not know: nothing in the
-- review payload said how many accounts the split would actually reach.
--
-- ⚠️ AND IT IS NOT "ALL THE ACTIVE ACCOUNTS", WHICH IS THE GUESS THE SCREEN WOULD HAVE MADE.
-- `admin_set_trade_allocation` divides by the accounts that had STARTED by the trade's date:
--
--   select count(*) into v_n from finance.family_accounts fa
--    where fa.dollar_per_day > 0 and v_trade.execution_time::date >= fa.start_date;
--
-- The same predicate is used here, so the preview cannot promise a split the server will not
-- make. Today every account shares one start date (2025-12-10) and the answer is 33 for every
-- trade, so a hard-coded 33 would have looked correct — and would have started lying the day a
-- 34th member joins with a later start date and an older export is re-imported. That is the same
-- latent bug the even-split divisor had, which is now fixed; this is the screen's half of it.
--
-- Additive: one more key in each row of the payload. Verified by putting one answered trade back
-- into the backlog in a rolled-back transaction, since the live backlog is empty — Evan answered
-- all 103 waiting trades on 29 Oct — and reading `eligibleAccounts: 33` off the result.
--
-- Everything else below is byte for byte the previous definition.

create or replace function public.admin_unallocated_trades(p_limit integer default 100, p_imported_since timestamp with time zone default null::timestamp with time zone)
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
      'importedAt', t.created_at,
      'symbol', t.asset_symbol,
      'platform', t.platform,
      'assetType', t.asset_type,
      'dollars', round(t.dollar_amount, 2),
      'units', t.units_acquired,
      'kind', t.kind,
      'isFamilySymbol', coalesce(sd.is_family, false),
      /* ⚠️ THE NUMBER THE SPLIT WILL ACTUALLY USE, PER TRADE. `admin_set_trade_allocation`
         divides by the accounts that had started by this trade's date, not by every active
         account — so a preview that said "× 33" would be guessing, and would be wrong for an
         older trade the moment a 34th member joins with a later start date. Same predicate as
         that function's own count, so the screen cannot promise a split the server will not
         make. */
      'eligibleAccounts', (
        select count(*) from finance.family_accounts fa
         where fa.dollar_per_day > 0 and t.execution_time::date >= fa.start_date),
      'alreadyHeld', coalesce((
        select round(sum(al.units_allocated), 6)
        from finance.allocations al
        join finance.executed_trades e2 on e2.id = al.executed_trade_id
        where e2.asset_symbol = t.asset_symbol and e2.platform = t.platform), 0)
    ) order by t.execution_time desc, t.id)
    from (
      select et.*
      from finance.executed_trades et
      where et.id in (select finance.trades_needing_review(v_uid))
        and (p_imported_since is null or et.created_at >= p_imported_since)
      order by et.execution_time desc, et.id
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) t
    left join finance.symbol_designations sd
      on sd.asset_symbol = t.asset_symbol and sd.platform = t.platform
  ), '[]'::jsonb);
end
$function$;
