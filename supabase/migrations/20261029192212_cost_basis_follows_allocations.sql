-- ✅ APPLIED 29 Oct 2026 as `cost_basis_follows_allocations`.
--
-- Part C, P3.5: "have `_fund_timeline` build `costBasis` for every symbol with family
-- allocations, not only symbols marked family."
--
-- THE INCONSISTENCY IS BETWEEN TWO CTEs IN ONE FUNCTION. `events` is built from
-- `finance.allocations` — what the family actually owns. `costBasis` was built from
-- `finance.symbol_designations ... and d.is_family` — what somebody remembered to tag. So a
-- symbol could appear in the chart's events, with units and cost, and have no entry in the basis
-- the chart draws its cost line from. The two answers come from different questions.
--
-- ⚠️ IT IS A MEASURED NO-OP TODAY, AND THAT IS THE POINT OF RECORDING IT. Exactly one symbol
-- currently has family allocations without a family designation — LCID on robinhood, 66
-- allocation rows — and Part F of the review says in capitals **do NOT designate LCID/robinhood
-- family**, because designating it would sweep a stray −0.783975 sell into a 33-way split. So the
-- tag is not the fix and never was. LCID is also sold out (family units exactly 0), so
-- `_held_avg_costs()` emits nothing for it either way, and `finance.cost_basis_overrides` is
-- empty (0 rows). Baseline before and after, in a simulated session:
--
--   timeline   md5 81db237e987aaf1cb16e1d05198bafcf
--   costBasis  md5 7c056b126ac11073847a3ebb7d962ea0, 76 symbols, 405 events
--
-- ⚠️ SO THE TEST CANNOT BE "DID ANYTHING CHANGE", because nothing should. It is run by taking
-- KTOS's designation away in a rolled-back transaction: before this change that drops KTOS out of
-- costBasis entirely, and after it KTOS stays, because the family holds it either way. That is
-- the bug reproduced on a real symbol rather than argued about — and it is the same bug that made
-- tagging KTOS and PEP necessary to get the chart right this morning. The chart should never have
-- depended on the tag.
--
-- WHAT IS PRESERVED. The two existing sources keep priority in the order they had: an explicit
-- override on a designated symbol, then the held average on a designated symbol. Two fallbacks
-- are added below them for symbols the family holds but nobody tagged. A designated symbol
-- therefore resolves exactly as it did before, which is why the baseline is unchanged.
--
-- ⚠️ AND THE FALLBACK IS ORDERED BY PLATFORM SO IT CANNOT BE ARBITRARY. `events` is keyed by
-- SYMBOL alone while the two sources are keyed by symbol AND platform, so a symbol the family
-- holds on both brokers offers two candidate costs and `distinct on (symbol)` would pick one at
-- the planner's whim — a figure that could change between two runs with no write in between.
-- Ordering by platform makes it deterministic. It is still a choice rather than a blend; a
-- units-weighted average across platforms would be better and needs its own think, so this picks
-- one and does it the same way every time rather than pretending to be exact.

create or replace function public._fund_timeline(p_uid uuid, p_all boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
declare v_result jsonb;
begin
  with accts as (
    select fa.id, fa.display_name, fa.dollar_per_day, fa.start_date
    from finance.family_accounts fa
    where p_all or fa.user_id = p_uid
  ),
  events as (
    select et.execution_time::date as d, et.asset_symbol as symbol,
           sum(al.units_allocated) as units,
           sum(al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount) as cost
    from finance.allocations al
    join finance.executed_trades et on et.id = al.executed_trade_id
    where al.family_account_id in (select id from accts)
    group by et.execution_time::date, et.asset_symbol
  ),
  price_obs as (
    select ph.asset_symbol as symbol, ph.captured_at::date as d, ph.price, ph.captured_at as at
    from finance.price_history ph
    where ph.asset_symbol in (select distinct symbol from events)
    union all
    select et.asset_symbol, et.execution_time::date, et.price, et.execution_time
    from finance.executed_trades et
    where et.asset_symbol in (select distinct symbol from events) and et.price > 0
  ),
  prices as (
    select distinct on (symbol, d) symbol, d, price
    from price_obs order by symbol, d, at desc
  ),
  cost_basis as (
    /* ⚠️ `pri` IS THE WHOLE RULE, and 0/1 are byte for byte what this did before: a designated
       symbol still resolves to its override, then to its held average. 2/3 are new and only
       reachable for a symbol the family HOLDS and nobody tagged — the case `events` already
       knew about and this list did not. `plat` is carried solely to break ties the same way
       every time; see the header. */
    select distinct on (symbol) symbol, avg_cost from (
      select o.asset_symbol as symbol, o.platform as plat, o.avg_cost, 0 as pri
      from finance.cost_basis_overrides o
      join finance.symbol_designations d
        on d.asset_symbol = o.asset_symbol and d.platform = o.platform and d.is_family
      union all
      select h.symbol, h.platform, h.avg_cost, 1 as pri
      from finance._held_avg_costs() h
      join finance.symbol_designations d
        on d.asset_symbol = h.symbol and d.platform = h.platform and d.is_family
      union all
      select o.asset_symbol, o.platform, o.avg_cost, 2 as pri
      from finance.cost_basis_overrides o
      union all
      select h.symbol, h.platform, h.avg_cost, 3 as pri
      from finance._held_avg_costs() h
    ) x
    where symbol in (select distinct symbol from events)
    order by symbol, pri, plat
  )
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'dollarPerDay', a.dollar_per_day, 'startDate', a.start_date)) from accts a), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'date', e.d, 'symbol', e.symbol, 'units', e.units, 'cost', e.cost) order by e.d) from events e), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
        'symbol', p.symbol, 'date', p.d, 'price', p.price) order by p.d) from prices p), '[]'::jsonb),
    'costBasis', coalesce((select jsonb_agg(jsonb_build_object(
        'symbol', c.symbol, 'avgCost', c.avg_cost)) from cost_basis c), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $function$;
