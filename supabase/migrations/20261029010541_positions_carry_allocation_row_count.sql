-- `familyRows`: how many allocation rows a symbol's designation is holding up.
--
-- ⚠️ IT EXISTS BECAUSE ONE CLICK DELETES THEM ALL AND NOTHING SAYS HOW MANY. Turning a symbol
-- off runs `delete from finance.allocations ... where et.asset_symbol = v_sym`, unconditionally,
-- across every family account. Measured today: SPCE on Cash App is **6,006 rows across all 33
-- accounts**, BTC is 1,320, OCCI 297. The toggle had no confirmation of any kind.
--
-- ⚠️ ROWS, NOT `familyUnits`, AND THE DIFFERENCE IS THE WHOLE POINT. Net units can be zero for a
-- position that was bought and sold out, while thousands of allocation rows still carry the cost
-- history that `avgCostBySymbol` and `heldBasis` are built from. A confirmation that said "0 units
-- at stake" about 6,000 rows of basis would be worse than none.
--
-- ⚠️ ADDITIVE, AND PROVED SO. Behavioural baseline taken in a simulated admin session before
-- replacing: 196 rows, md5 e35e18f4754969dd7904b0b049f379cb. After, with `familyRows` stripped
-- back out of every element, the md5 is identical — so nothing else about this function moved.
-- The client mapper picks fields by name, so an older bundle ignores the new key.
create or replace function public.admin_list_positions()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'symbol', s.asset_symbol,
      'platform', s.platform,
      'assetType', s.asset_type,
      'units', s.units,
      'dollars', s.dollars,
      'trades', s.n,
      'price', pc.price,
      'value', case when pc.price is null then null else s.units * pc.price end,
      'isFamily', coalesce(sd.is_family, false),
      -- what the family actually owns of this position, and what that is worth. A null price
      -- stays null in both: an unpriced holding is not worth nothing.
      'familyUnits', coalesce(f.units, 0),
      'familyValue', case when pc.price is null then null else coalesce(f.units, 0) * pc.price end,
      -- and how many allocation rows that ownership is made of — see the header
      'familyRows', coalesce(f.n_rows, 0)
    ) order by (case when pc.price is null then null else s.units * pc.price end) desc nulls last,
               s.dollars desc)
    from (
      select et.asset_symbol, et.platform, max(et.asset_type) as asset_type,
             sum(et.units_acquired) as units, sum(et.dollar_amount) as dollars, count(*) as n
      from finance.executed_trades et
      where et.user_id = v_uid
      group by et.asset_symbol, et.platform
    ) s
    left join finance.symbol_designations sd
      on sd.asset_symbol = s.asset_symbol and sd.platform = s.platform
    left join finance.price_cache pc on pc.asset_symbol = s.asset_symbol
    left join (
      select et.asset_symbol, et.platform,
             sum(al.units_allocated) as units, count(*) as n_rows
        from finance.allocations al
        join finance.executed_trades et on et.id = al.executed_trade_id
       group by et.asset_symbol, et.platform
    ) f on f.asset_symbol = s.asset_symbol and f.platform = s.platform
  ), '[]'::jsonb);
end $function$;
