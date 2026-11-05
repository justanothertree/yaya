



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "finance";


ALTER SCHEMA "finance" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."visibility_tier" AS ENUM (
    'private',
    'certain',
    'friends',
    'members',
    'public'
);


ALTER TYPE "public"."visibility_tier" OWNER TO "postgres";


COMMENT ON TYPE "public"."visibility_tier" IS 'Who may see a row. Ordered least to most open. Circuit group sharing is a SEPARATE mechanism layered on top of this -- see docs/visibility-tiers-design.md.';



CREATE OR REPLACE FUNCTION "finance"."_held_avg_costs"() RETURNS TABLE("symbol" "text", "platform" "text", "avg_cost" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'finance', 'public', 'pg_temp'
    AS $$
declare
  r   record;
  r2  record;
  v_u numeric;
  v_c numeric;
begin
  for r in
    select et.asset_symbol as sym, et.platform as plat,
           sum(al.units_allocated) as held
    from finance.allocations al
    join finance.executed_trades et on et.id = al.executed_trade_id
    group by et.asset_symbol, et.platform
    having sum(al.units_allocated) > 0.0001
  loop
    -- average-cost replay over what the family actually owns of this symbol
    v_u := 0; v_c := 0;
    for r2 in
      select sum(al.units_allocated) as uu,
             sum(al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount) as dd
      from finance.allocations al
      join finance.executed_trades et on et.id = al.executed_trade_id
      where et.asset_symbol = r.sym and et.platform = r.plat
      group by et.execution_time, et.id
      order by et.execution_time, et.id
    loop
      if r2.dd > 0 and r2.uu > 0 then
        v_c := v_c + r2.dd; v_u := v_u + r2.uu;                    -- buy
      elsif r2.dd < 0 and r2.uu < 0 then
        if v_u > 0 then v_c := v_c + (v_c / v_u) * r2.uu; end if;  -- sell: drop cost pro-rata
        v_u := v_u + r2.uu;
      else
        v_u := v_u + coalesce(r2.uu, 0);                            -- split: units only
      end if;
    end loop;
    if v_u > 0.0001 and v_c > 0 then
      symbol := r.sym; platform := r.plat; avg_cost := v_c / v_u; return next;
    end if;
  end loop;
end
$$;


ALTER FUNCTION "finance"."_held_avg_costs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."account_basis"("p_account" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  r        record;
  v_units  numeric;
  v_cost   numeric;
  v_avg    numeric;
  v_total  numeric := 0;
  v_sym    text := null;
begin
  for r in
    select et.asset_symbol as sym,
           et.execution_time,
           al.units_allocated                                                   as units,
           al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount as dollars
      from finance.allocations al
      join finance.executed_trades et on et.id = al.executed_trade_id
     where al.family_account_id = p_account
       and coalesce(et.units_acquired, 0) <> 0
     order by et.asset_symbol, et.execution_time asc, et.id asc
  loop
    -- symbol boundary: bank the previous symbol's remaining basis
    if v_sym is null or r.sym <> v_sym then
      if v_sym is not null and v_units > 0.000001 then
        v_total := v_total + v_cost;
      end if;
      v_sym := r.sym;
      v_units := 0;
      v_cost := 0;
    end if;

    if r.dollars > 0 and r.units > 0 then
      -- a purchase: shares and their cost both go up
      v_units := v_units + r.units;
      v_cost  := v_cost + r.dollars;

    elsif r.dollars < 0 and r.units < 0 then
      -- a sale: shares leave AT THE AVERAGE, so the profit or loss on them does not move the
      -- basis of the shares that stay
      v_avg := case when v_units > 0.000001 then v_cost / v_units else 0 end;
      v_units := v_units + r.units;                    -- r.units is negative
      v_cost  := greatest(v_cost + v_avg * r.units, 0);
      if v_units < 0.000001 then
        v_units := 0;
        v_cost := 0;
      end if;

    else
      -- a split, or an import unit-correction: the share COUNT is restated and the dollars
      -- already spent are untouched. Deliberately no clamp -- the two legs of a reverse split
      -- are separate rows, so units pass through zero between them and zeroing here would
      -- throw the basis away exactly as the old sale branch did.
      v_units := v_units + coalesce(r.units, 0);
    end if;
  end loop;

  if v_sym is not null and v_units > 0.000001 then
    v_total := v_total + v_cost;
  end if;

  return round(coalesce(v_total, 0), 2);
end
$$;


ALTER FUNCTION "finance"."account_basis"("p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."account_ledger"("p_account" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  r           record;
  v_cash      numeric := 0;
  v_contrib   numeric := 0;
  v_draw      numeric;
  v_cost      numeric;
begin
  for r in
    select et.execution_time,
           al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount as dollars,
           al.units_allocated                                                   as units
      from finance.allocations al
      join finance.executed_trades et on et.id = al.executed_trade_id
     where al.family_account_id = p_account
       and coalesce(et.units_acquired, 0) <> 0
     order by et.execution_time asc,
              (al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount) asc,
              et.id asc
  loop
    if r.dollars < 0 then
      v_cash := v_cash + abs(r.dollars);
    else
      v_cost := r.dollars;
      v_draw := least(v_cash, v_cost);
      v_cash := v_cash - v_draw;
      v_contrib := v_contrib + (v_cost - v_draw);
    end if;
  end loop;

  return jsonb_build_object('cash', round(v_cash, 2), 'contributed', round(v_contrib, 2));
end
$$;


ALTER FUNCTION "finance"."account_ledger"("p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."account_payload"("p_account" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
  select jsonb_build_object(
    'id', fa.id,
    'name', fa.display_name,
    'dollarPerDay', fa.dollar_per_day,
    'startDate', fa.start_date,
    -- "ready" is about whether there is anything to report yet, NOT whether the numbers are
    -- good. An account with allocations but no contribution is ready and reads zero; an account
    -- with nothing at all suppresses ahead/behind entirely.
    'ready', (led->>'contributed')::numeric > 0
             or (led->>'cash')::numeric > 0
             or exists (select 1 from finance.allocations al where al.family_account_id = fa.id),
    'contributed', (led->>'contributed')::numeric,
    'cash', (led->>'cash')::numeric,
    'heldBasis', finance.account_basis(fa.id),
    'holdings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'symbol', t.asset_symbol, 'assetType', t.asset_type, 'units', t.units,
               -- ⚠️ NOT a cost basis. Buys minus sells, which for a churned symbol can be
               -- negative while shares are still held. Use heldBasis above for basis.
               'netCash', t.net_cash, 'price', pc.price, 'priceAt', pc.updated_at
             ) order by t.net_cash desc)
      from (
        select et.asset_symbol, max(et.asset_type) as asset_type,
               sum(al.units_allocated) as units,
               sum(al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount) as net_cash
        from finance.allocations al
        join finance.executed_trades et on et.id = al.executed_trade_id
        where al.family_account_id = fa.id
        group by et.asset_symbol
        having abs(coalesce(sum(al.units_allocated), 0)) > 0.000001
      ) t
      left join finance.price_cache pc on pc.asset_symbol = t.asset_symbol
    ), '[]'::jsonb)
  )
  from finance.family_accounts fa
  cross join lateral (select finance.account_ledger(fa.id) as led) l
  where fa.id = p_account;
$$;


ALTER FUNCTION "finance"."account_payload"("p_account" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "finance"."account_payload"("p_account" "uuid") IS 'The one definition of an account as the UI sees it. Called by public.get_my_portfolio and public.admin_get_portfolios — add a field HERE and both get it. Adding it to only one of them is what produced "Put in $0.00" twice.';



CREATE OR REPLACE FUNCTION "finance"."family_share_at"("p_symbol" "text", "p_platform" "text", "p_at" timestamp with time zone) RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'finance', 'public', 'pg_temp'
    AS $$
  -- what fraction of this position the family owned immediately BEFORE p_at. A restatement
  -- (split, unit correction) hands them this much of itself and no more.
  select case when coalesce(whole, 0) <= 0 then 0
              else least(coalesce(fam, 0) / whole, 1) end
  from (
    select (select sum(e.units_acquired)
              from finance.executed_trades e
             where e.asset_symbol = p_symbol and e.platform = p_platform
               and e.execution_time < p_at)                     as whole,
           (select sum(al.units_allocated)
              from finance.allocations al
              join finance.executed_trades e2 on e2.id = al.executed_trade_id
             where e2.asset_symbol = p_symbol and e2.platform = p_platform
               and e2.execution_time < p_at)                    as fam
  ) q;
$$;


ALTER FUNCTION "finance"."family_share_at"("p_symbol" "text", "p_platform" "text", "p_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."fund_today"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_temp'
    AS $$ select (now() at time zone 'America/New_York')::date $$;


ALTER FUNCTION "finance"."fund_today"() OWNER TO "postgres";


COMMENT ON FUNCTION "finance"."fund_today"() IS 'The fund''s calendar date. Mirrored by fundToday() in src/finance/fundDay.ts — change both.';



CREATE OR REPLACE FUNCTION "finance"."holding_periods"() RETURNS TABLE("symbol" "text", "platform" "text", "asset_type" "text", "units_held" numeric, "fifo_basis" numeric, "long_units" numeric, "short_units" numeric, "oldest_lot" "date", "last_buy" "date", "next_cross" "date", "next_cross_units" numeric, "lots" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'finance', 'public', 'pg_temp'
    AS $$
declare
  pos     record;
  ev      record;
  ld      date[];
  lu      numeric[];
  lc      numeric[];
  i       int;
  n       int;
  take    numeric;
  need    numeric;
  tot     numeric;
  f       numeric;
  cutoff  date := (finance.fund_today() - interval '1 year 1 day')::date;
begin
  for pos in
    select et.asset_symbol as sym, et.platform as plat, max(et.asset_type) as atype
      from finance.allocations al
      join finance.executed_trades et on et.id = al.executed_trade_id
     group by et.asset_symbol, et.platform
  loop
    ld := '{}'::date[]; lu := '{}'::numeric[]; lc := '{}'::numeric[];

    for ev in
      select t.d as ed, o.ord as ord, sum(t.u) as eu, min(t.u) as emin, sum(t.c) as ec
        from (
          select et.execution_time::date as d,
                 sum(al.units_allocated) as u,
                 sum(al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount) as c
            from finance.allocations al
            join finance.executed_trades et on et.id = al.executed_trade_id
           where et.asset_symbol = pos.sym
             and et.platform = pos.plat
             and coalesce(et.units_acquired, 0) <> 0
           group by et.id, et.execution_time::date
        ) t
        cross join lateral (
          select case when abs(t.c) <= 0.005 then 3 when t.c > 0 then 1 else 2 end as ord
        ) o
       group by t.d, o.ord
       order by t.d, o.ord            -- buys, then sales, then restatements, within a day
    loop
      if ev.ord = 1 then
        ld := array_append(ld, ev.ed);
        lu := array_append(lu, ev.eu);
        lc := array_append(lc, ev.ec);

      elsif ev.ord = 2 then
        -- a sale takes the OLDEST units first: Robinhood's default is FIFO and it offers no
        -- per-lot choice at sale time, so this is what the broker does, not a preference.
        need := -ev.eu;
        i := 1;
        n := coalesce(array_length(lu, 1), 0);
        while need > 0.000000001 and i <= n loop
          take := least(lu[i], need);
          if take > 0 then
            lc[i] := lc[i] - take * (lc[i] / lu[i]);
            lu[i] := lu[i] - take;
            need  := need - take;
          end if;
          i := i + 1;
        end loop;

      else
        n := coalesce(array_length(lu, 1), 0);
        tot := 0;
        for i in 1..n loop tot := tot + lu[i]; end loop;

        if ev.emin < 0 and tot > 0.000001 then
          -- A RESTATEMENT: the day withdrew the old share count and issued a new one. Scale
          -- every open lot; dates and dollars stand, which is what keeps a reverse split from
          -- resetting the holding period or destroying the basis.
          f := (tot + ev.eu) / tot;
          if f < 0 then f := 0; end if;   -- only reachable on data removing more than is held
          for i in 1..n loop lu[i] := lu[i] * f; end loop;

        elsif ev.eu > 0 then
          -- A GRANT: units appeared and none were withdrawn. Their holding period starts here,
          -- and they carry no cost of their own.
          ld := array_append(ld, ev.ed);
          lu := array_append(lu, ev.eu);
          lc := array_append(lc, 0::numeric);
        end if;
      end if;
    end loop;

    units_held := 0; fifo_basis := 0; long_units := 0; short_units := 0;
    oldest_lot := null; last_buy := null; next_cross := null; next_cross_units := 0;
    lots := '[]'::jsonb;
    n := coalesce(array_length(lu, 1), 0);
    for i in 1..n loop
      if lu[i] > 0.000000001 then
        units_held := units_held + lu[i];
        fifo_basis := fifo_basis + greatest(lc[i], 0);
        if ld[i] <= cutoff then
          long_units := long_units + lu[i];
        else
          short_units := short_units + lu[i];
          if next_cross is null or ld[i] < (next_cross - interval '1 year 1 day') then
            next_cross := (ld[i] + interval '1 year 1 day')::date;
            next_cross_units := lu[i];
          elsif ld[i] = (next_cross - interval '1 year 1 day') then
            next_cross_units := next_cross_units + lu[i];
          end if;
        end if;
        if oldest_lot is null or ld[i] < oldest_lot then oldest_lot := ld[i]; end if;
        if last_buy is null or ld[i] > last_buy then last_buy := ld[i]; end if;
        lots := lots || jsonb_build_object('d', ld[i], 'u', round(lu[i], 8));
      end if;
    end loop;

    if units_held > 0.000001 then
      symbol := pos.sym; platform := pos.plat; asset_type := pos.atype;
      fifo_basis := round(fifo_basis, 2);
      return next;
    end if;
  end loop;
end
$$;


ALTER FUNCTION "finance"."holding_periods"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."integrity_checks"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $_$
  select jsonb_agg(c order by c->>'ord') from (
    select jsonb_build_object('ord','1','label','Family given more units than a trade held',
      'count', (select count(*) from (
         select al.executed_trade_id, sum(al.units_allocated) su, max(et.units_acquired) ua
         from finance.allocations al join finance.executed_trades et on et.id = al.executed_trade_id
         group by al.executed_trade_id) t where abs(su) > abs(ua) + 0.0001),
      'meaning','A trade was split for more than it contained. The totals would be too high.') as c
    union all
    select jsonb_build_object('ord','2','label','A family holding with negative units',
      'count', (select count(*) from (
         select et.asset_symbol, sum(al.units_allocated) u
         from finance.allocations al join finance.executed_trades et on et.id = al.executed_trade_id
         group by et.asset_symbol) h where u < -0.0001),
      'meaning','They own less than nothing of something — usually a split allocated whole to a position they only partly own.')
    union all
    select jsonb_build_object('ord','3','label','Allocation older than the account it belongs to',
      'count', (select count(*) from finance.allocations al
         join finance.executed_trades et on et.id = al.executed_trade_id
         join finance.family_accounts fa on fa.id = al.family_account_id
        where et.execution_time::date < fa.start_date),
      'meaning','An account was given a trade from before it existed — your own history counted as theirs.')
    union all
    select jsonb_build_object('ord','4','label','Trade split unevenly across accounts',
      'count', (select count(*) from (
         select executed_trade_id, count(*) n, round(min(units_allocated),8) lo, round(max(units_allocated),8) hi
         from finance.allocations group by executed_trade_id) x
        where n <> (select count(*) from finance.family_accounts where dollar_per_day > 0) or lo <> hi),
      'meaning','Someone got a different share than the rest. Everyone is meant to get the same.')
    union all
    select jsonb_build_object('ord','5','label','Family holding with no price',
      'count', (select count(*) from (
         select et.asset_symbol from finance.allocations al
         join finance.executed_trades et on et.id = al.executed_trade_id
         group by et.asset_symbol having sum(al.units_allocated) > 0.0001) h
        where not exists (select 1 from finance.price_cache pc where pc.asset_symbol = h.asset_symbol)),
      'meaning','Worth today is understated — that holding is being counted as zero.')
    union all
    select jsonb_build_object('ord','6','label','Price older than three days',
      'count', (select count(*) from finance.price_cache pc
        where pc.updated_at < now() - interval '3 days'
          and exists (select 1 from finance.allocations al
                      join finance.executed_trades et on et.id = al.executed_trade_id
                     where et.asset_symbol = pc.asset_symbol
                     group by et.asset_symbol having sum(al.units_allocated) > 0.0001)),
      'meaning','A family holding is priced from a stale quote.')
    union all
    select jsonb_build_object('ord','7','label','Family credited with more than you actually hold',
      'count', (select count(*) from finance.position_overcredit() where excess_dollars > 1),
      'meaning','You sold out of something they part-own without splitting the sale — they are holding shares you no longer have.')
    union all
    -- ⚠️ #8 EXISTS BECAUSE #7 CANNOT SEE ITS OWN SHAPE. #7 tests each symbol against a dollar,
    -- which is right for the failure it names: one sale that forgot the family. It is
    -- structurally blind to the opposite shape, a small error on many symbols at once. Measured
    -- when this was written, #7 read 0 while 23 symbols were over-credited by a total of $0.56 --
    -- the 2025-12-01 broker unit-corrections predate the fund start, so they were correctly left
    -- unallocated and nobody reduced the family's share to match. Twenty-three two-cent errors
    -- are invisible to a per-symbol threshold no matter how long they accumulate.
    select jsonb_build_object('ord','8','label','Small over-credits that add up',
      'count', (select case when coalesce((select sum(excess_dollars) from finance.position_overcredit()), 0) > 1
                            then (select count(*) from finance.position_overcredit())
                            else 0 end),
      'meaning','Individually too small for the check above, but together worth more than a dollar across the fund.')
    union all
    -- ⚠️ #9: A DECISION THAT CAN NEVER TAKE EFFECT. A symbol marked family whose every trade
    -- predates the fund start will never be allocated -- the start_date rule blocks it, correctly
    -- -- and it is invisible to trades_needing_review for exactly the same reason, so
    -- admin_attention never counts it either. AEON and NFLX have sat like this since 2025-12-05
    -- and 2025-12-08: $115.77 at cost, designated theirs, belonging to nobody, with nothing on
    -- any screen that would ever ask about them.
    select jsonb_build_object('ord','9','label','Marked family, but nothing can be allocated',
      'count', (select count(*) from (
         select sd.asset_symbol, sd.platform
           from finance.symbol_designations sd
          where sd.is_family
            and exists (select 1 from finance.executed_trades et
                         where et.asset_symbol = sd.asset_symbol and et.platform = sd.platform)
            and not exists (
              select 1 from finance.executed_trades et
               where et.asset_symbol = sd.asset_symbol and et.platform = sd.platform
                 and et.execution_time::date >= (select min(start_date) from finance.family_accounts
                                                  where dollar_per_day > 0))) z),
      'meaning','Every trade in it is older than the fund, so the family can never receive any of it. Undesignate it, or the decision just sits there.')
  ) q;
$_$;


ALTER FUNCTION "finance"."integrity_checks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."position_overcredit"() RETURNS TABLE("symbol" "text", "platform" "text", "excess_units" numeric, "excess_dollars" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'finance', 'public', 'pg_temp'
    AS $$
  select f.asset_symbol, f.platform,
         (f.u - coalesce(w.u, 0)) as excess_units,
         (f.u - coalesce(w.u, 0)) * coalesce(pc.price, 0) as excess_dollars
    from (select et.asset_symbol, et.platform, sum(al.units_allocated) u
            from finance.allocations al
            join finance.executed_trades et on et.id = al.executed_trade_id
           group by 1,2) f
    left join (select asset_symbol, platform, sum(units_acquired) u
                 from finance.executed_trades group by 1,2) w
      on w.asset_symbol = f.asset_symbol and w.platform = f.platform
    left join finance.price_cache pc on pc.asset_symbol = f.asset_symbol
   where (f.u - coalesce(w.u, 0)) > 0.0000001;
$$;


ALTER FUNCTION "finance"."position_overcredit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."refresh_prices"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'extensions', 'vault', 'pg_temp'
    AS $$
declare
  -- Finnhub's free tier is 60 calls a minute. The symbol list is STALEST FIRST, so capping each
  -- run and letting the staggered jobs cycle is what gets all of them priced without ever
  -- tripping the limit. The ordering is load-bearing; see the `order by` below.
  max_stocks constant int := 55;
  v_all       jsonb;
  v_key       text;
  v_ids       text;
  v_resp      extensions.http_response;
  v_quotes    jsonb;
  v_row       record;
  v_usd       numeric;
  v_prices    jsonb := '[]'::jsonb;
  v_crypto    int := 0;
  v_stocks    int := 0;
  v_deferred  int := 0;
  v_skipped   text[] := '{}';
  v_errors    text[] := '{}';
  v_written   int := 0;
  v_seen      int := 0;
begin
  -- Bounded, or one unresponsive host holds a cron slot open indefinitely.
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '4000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');

  -- Every symbol the fund has ever traded, stalest price first. Materialised once, with the
  -- order pinned, because that rotation is the whole reason a 55-a-run cap covers everything.
  select coalesce(
           jsonb_agg(jsonb_build_object('symbol', s.symbol, 'asset_type', s.asset_type)
                     order by s.staleness asc nulls first),
           '[]'::jsonb)
    into v_all
    from (
      select t.symbol, t.asset_type, pc.updated_at as staleness
        from (
          select distinct et.asset_symbol as symbol,
                 coalesce(et.asset_type, 'stock') as asset_type
            from finance.executed_trades et
        ) t
        left join finance.price_cache pc on pc.asset_symbol = t.symbol
    ) s;

  -- ── crypto, via CoinGecko (no key needed) ────────────────────────────────
  select string_agg(distinct c.coingecko_id, ',')
    into v_ids
    from jsonb_array_elements(v_all) e
    join finance.coingecko_ids c on c.symbol = upper(e->>'symbol')
   where e->>'asset_type' = 'crypto';

  -- a coin nobody has mapped yet: say which, rather than silently pricing nothing
  select coalesce(array_agg(e->>'symbol'), '{}')
    into v_skipped
    from jsonb_array_elements(v_all) e
   where e->>'asset_type' = 'crypto'
     and not exists (select 1 from finance.coingecko_ids c where c.symbol = upper(e->>'symbol'));

  if v_ids is not null then
    begin
      v_resp := extensions.http_get(
        'https://api.coingecko.com/api/v3/simple/price?ids=' || v_ids || '&vs_currencies=usd');
      if v_resp.status = 200 then
        v_quotes := v_resp.content::jsonb;
        for v_row in
          select e->>'symbol' as symbol, c.coingecko_id
            from jsonb_array_elements(v_all) e
            join finance.coingecko_ids c on c.symbol = upper(e->>'symbol')
           where e->>'asset_type' = 'crypto'
        loop
          v_usd := nullif(v_quotes -> v_row.coingecko_id ->> 'usd', '')::numeric;
          if v_usd is not null and v_usd > 0 then
            v_prices := v_prices
              || jsonb_build_array(jsonb_build_object('symbol', v_row.symbol, 'price', v_usd));
            v_crypto := v_crypto + 1;
          else
            v_skipped := v_skipped || v_row.symbol;
          end if;
        end loop;
      else
        v_errors := v_errors || format('coingecko %s', v_resp.status);
      end if;
    exception when others then
      v_errors := v_errors || ('coingecko: ' || sqlerrm);
    end;
  end if;

  -- ── stocks, via Finnhub ──────────────────────────────────────────────────
  -- The key lives in Vault, so it is never in a cron command, a function body, or this repo.
  -- Absent is a normal state, not an error: crypto still prices, and the summary says so.
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'finnhub_api_key' limit 1;

  for v_row in
    select e->>'symbol' as symbol
      from jsonb_array_elements(v_all) e
     where e->>'asset_type' is distinct from 'crypto'
  loop
    if v_key is null then
      v_skipped := v_skipped || v_row.symbol;
      continue;
    end if;
    v_seen := v_seen + 1;
    if v_seen > max_stocks then
      v_deferred := v_deferred + 1;
      continue;
    end if;
    begin
      v_resp := extensions.http_get(
        'https://finnhub.io/api/v1/quote?symbol=' || extensions.urlencode(v_row.symbol)
        || '&token=' || v_key);
      if v_resp.status = 200 then
        v_usd := nullif(v_resp.content::jsonb ->> 'c', '')::numeric;
        if v_usd is not null and v_usd > 0 then
          v_prices := v_prices
            || jsonb_build_array(jsonb_build_object('symbol', v_row.symbol, 'price', v_usd));
          v_stocks := v_stocks + 1;
        else
          v_skipped := v_skipped || v_row.symbol;
        end if;
      elsif v_resp.status = 429 then
        -- rate limited: stop asking. The next staggered run picks these up.
        v_errors := v_errors || format('%s: rate limited', v_row.symbol);
        exit;
      else
        v_errors := v_errors || format('%s: %s', v_row.symbol, v_resp.status);
      end if;
    exception when others then
      v_errors := v_errors || format('%s: %s', v_row.symbol, sqlerrm);
    end;
  end loop;

  if jsonb_array_length(v_prices) > 0 then
    v_written := coalesce(finance.store_prices(v_prices), 0);
  end if;

  /**
   * Fail LOUDLY, and treat an EMPTY work list as a failure too.
   *
   * This is the whole reason the feed could rot for five days: net.http_post only queues, so
   * cron.job_run_details recorded success every night while the gateway returned 401. And an
   * empty symbol list is what a gated wrapper hands back when it doesn't like the caller — a
   * fund with trades in it always has symbols, so zero means something is wrong upstream, not
   * that there was no work. Reporting ok:true for either is how this stays broken.
   */
  if jsonb_array_length(v_all) = 0 then
    raise exception 'refresh_prices found no symbols at all — finance.executed_trades is empty or unreadable from here';
  end if;
  if v_crypto + v_stocks = 0 then
    raise exception 'refresh_prices priced nothing (% symbols): %',
      jsonb_array_length(v_all),
      coalesce(nullif(array_to_string(v_errors, '; '), ''), 'no error reported');
  end if;

  return jsonb_build_object(
    'ok', true,
    'written', v_written,
    'crypto', v_crypto,
    'stocks', v_stocks,
    'deferred', v_deferred,
    'have_finnhub_key', v_key is not null,
    'skipped', to_jsonb(v_skipped),
    'errors', to_jsonb(v_errors));
end
$$;


ALTER FUNCTION "finance"."refresh_prices"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."store_prices"("p_prices" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v jsonb;
  v_symbol text;
  v_price numeric;
  v_n int := 0;
begin
  if jsonb_typeof(p_prices) is distinct from 'array' then
    raise exception 'p_prices must be a json array';
  end if;
  for v in select * from jsonb_array_elements(p_prices)
  loop
    v_symbol := nullif(btrim(v ->> 'symbol'), '');
    v_price  := nullif(v ->> 'price', '')::numeric;
    if v_symbol is null or v_price is null or v_price <= 0 then continue; end if;
    insert into finance.price_cache (asset_symbol, price, updated_at)
    values (v_symbol, v_price, now())
    on conflict (asset_symbol) do update
      set price = excluded.price, updated_at = excluded.updated_at;
    insert into finance.price_history (asset_symbol, price, captured_at)
    values (v_symbol, v_price, now())
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;


ALTER FUNCTION "finance"."store_prices"("p_prices" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "finance"."trades_needing_review"("p_user" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
  select et.id
  from finance.executed_trades et
  left join finance.symbol_designations sd
    on sd.asset_symbol = et.asset_symbol and sd.platform = et.platform
  where et.user_id = p_user
    and et.reviewed_at is null
    and not exists (select 1 from finance.allocations al where al.executed_trade_id = et.id)
    and et.execution_time::date >= (
      select min(start_date) from finance.family_accounts where dollar_per_day > 0)
    and coalesce(sd.is_family, true);
$$;


ALTER FUNCTION "finance"."trades_needing_review"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_circuit_add_self"("p_group" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_pid text;
  v_name text;
begin
  if auth.uid() is null then return; end if;

  select coalesce(nullif(btrim(first_name), ''), nullif(btrim(username), ''), 'Me')
    into v_name
  from profiles where user_id = auth.uid();

  -- (a) a board you already own (the one with the most logs = your real history)
  select cp.id into v_pid
  from circuit_people cp
  left join circuit_logs cl on cl.person_id = cp.id
  where cp.owner_user_id = auth.uid()
  group by cp.id
  order by count(cl.id) desc, cp.id
  limit 1;

  -- (b) else an UNCLAIMED person of your name already in this circuit — adopt it, so a
  -- returning member lands on their own history instead of a blank second board
  if v_pid is null and v_name is not null then
    select cp.id into v_pid
    from circuit_people cp
    join circuit_person_groups pg on pg.person_id = cp.id and pg.group_id = p_group
    left join circuit_logs cl on cl.person_id = cp.id
    where cp.owner_user_id is null and lower(btrim(cp.name)) = lower(btrim(v_name))
    group by cp.id
    order by count(cl.id) desc, cp.id
    limit 1;
    if v_pid is not null then
      update circuit_people set owner_user_id = auth.uid() where id = v_pid;
    end if;
  end if;

  -- (c) else a genuinely new member: give them a fresh board
  if v_pid is null then
    v_pid := gen_random_uuid()::text;
    insert into circuit_people (id, name, color, owner_user_id)
      values (v_pid, coalesce(v_name, 'Me'), '#7c6af7', auth.uid());
  end if;

  insert into circuit_person_groups (person_id, group_id, added_by)
    values (v_pid, p_group, auth.uid())
  on conflict do nothing;
end $$;


ALTER FUNCTION "public"."_circuit_add_self"("p_group" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_fund_timeline"("p_uid" "uuid", "p_all" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."_fund_timeline"("p_uid" "uuid", "p_all" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_self_to_circuit"("p_group" "uuid", "p_name" "text", "p_color" "text" DEFAULT '#7c6af7'::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id text;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (
    select 1 from circuit_group_members gm
    where gm.group_id = p_group and gm.user_id = auth.uid()
  ) then
    raise exception 'not a member of this circuit';
  end if;

  -- (a) reuse the caller's existing person (the one with the most logs = their real board)
  select cp.id into v_id
  from circuit_people cp
  left join circuit_logs cl on cl.person_id = cp.id
  where cp.owner_user_id = auth.uid()
  group by cp.id
  order by count(cl.id) desc, cp.id
  limit 1;

  -- (b) else claim an unclaimed, same-name person already shared into this circuit
  --     (returning crew whose caretaken record is here — don't spawn a blank beside it)
  if v_id is null and coalesce(btrim(p_name), '') <> '' then
    select cp.id into v_id
    from circuit_people cp
    join circuit_person_groups g on g.person_id = cp.id and g.group_id = p_group
    where cp.owner_user_id is null
      and lower(btrim(cp.name)) = lower(btrim(p_name))
    limit 1;
    if v_id is not null then
      update circuit_people set owner_user_id = auth.uid() where id = v_id;
    end if;
  end if;

  -- (c) else create a fresh person owned by the caller
  if v_id is null then
    if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
    v_id := gen_random_uuid()::text;
    insert into circuit_people (id, name, color, owner_user_id)
      values (v_id, btrim(p_name), coalesce(nullif(btrim(p_color), ''), '#7c6af7'), auth.uid());
  end if;

  -- share into the circuit (idempotent)
  insert into circuit_person_groups (person_id, group_id, added_by, added_at)
    values (v_id, p_group, auth.uid(), now())
    on conflict do nothing;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."add_self_to_circuit"("p_group" "uuid", "p_name" "text", "p_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_add_contribution"("p_amount" numeric, "p_on" "date", "p_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  -- a contribution dated in the future would silently inflate "ahead of schedule"
  -- ⚠️ against the fund's day, the same one "promised" is counted to. On UTC this accepted a
  -- contribution dated tomorrow for the whole evening — a day the promise had not yet reached.
  if p_on is null or p_on > finance.fund_today() then raise exception 'date cannot be in the future'; end if;

  insert into finance.family_contributions (user_id, amount, contributed_on, note)
  values (v_uid, round(p_amount, 2), p_on, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;


ALTER FUNCTION "public"."admin_add_contribution"("p_amount" numeric, "p_on" "date", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_attention"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  return jsonb_build_object(
    'integrity', (select count(*)
                    from jsonb_array_elements(coalesce(finance.integrity_checks(), '[]'::jsonb)) c
                   where (c->>'count')::int > 0),
    'messages',  (select count(*) from public.contact_messages where not handled),
    'undecided', (select count(*) from finance.trades_needing_review(v_uid))
  );
end
$$;


ALTER FUNCTION "public"."admin_attention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_correct_position"("p_symbol" "text", "p_platform" "text", "p_true_units" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."admin_correct_position"("p_symbol" "text", "p_platform" "text", "p_true_units" numeric) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "finance"."family_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "family_account_id" "uuid" DEFAULT "gen_random_uuid"(),
    "dollar_per_day" numeric DEFAULT 0 NOT NULL,
    "start_date" "date"
);


ALTER TABLE "finance"."family_accounts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_family_account"("p_owner" "uuid", "p_name" "text", "p_dollar_per_day" numeric DEFAULT 0, "p_start_date" "date" DEFAULT NULL::"date") RETURNS "finance"."family_accounts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare out_row finance.family_accounts;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;
  if p_owner is null then raise exception 'owner (member) is required'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'account name is required'; end if;
  insert into finance.family_accounts (user_id, display_name, dollar_per_day, start_date)
  values (p_owner, btrim(p_name), coalesce(p_dollar_per_day, 0), p_start_date)
  returning * into out_row;
  return out_row;
end;
$$;


ALTER FUNCTION "public"."admin_create_family_account"("p_owner" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_contribution"("p_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  delete from finance.family_contributions
   where id = p_id and user_id = auth.uid();
  get diagnostics v_n = ROW_COUNT;
  return v_n > 0;
end;
$$;


ALTER FUNCTION "public"."admin_delete_contribution"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_family_account"("p_account" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;
  delete from finance.allocations where family_account_id = p_account;
  delete from finance.family_accounts where id = p_account;
end;
$$;


ALTER FUNCTION "public"."admin_delete_family_account"("p_account" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_member"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
declare v_accounts int;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_user_id = auth.uid() then raise exception 'you cannot delete your own account'; end if;
  if exists(select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'cannot delete an admin account';
  end if;

  /* ⚠️ COUNTED AND NAMED, BEFORE ANYTHING IS DELETED. The FK would refuse this anyway now, which
     is the safety; this is so the refusal says what to do about it. `finance` is qualified because
     this function's search_path does not include it.
     "1 fund account(s)" is the sort of thing nobody notices in a migration and everybody notices
     on the screen — this is admin-facing copy, so it is written out. */
  select count(*) into v_accounts from finance.family_accounts fa where fa.user_id = p_user_id;
  if v_accounts > 0 then
    raise exception
      'that person owns % — reassign or delete % first, or their holdings go with the login',
      v_accounts || (case when v_accounts = 1 then ' fund account' else ' fund accounts' end),
      case when v_accounts = 1 then 'it' else 'them' end;
  end if;

  delete from public.invites where used_by = p_user_id; -- clears the NO ACTION FK
  delete from public.user_roles where user_id = p_user_id; -- no FK / cascade
  delete from auth.users where id = p_user_id; -- cascades profiles + account_features + auth internals
end;
$$;


ALTER FUNCTION "public"."admin_delete_member"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_even_split_trades"("p_user_id" "uuid", "p_only_active" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_accounts uuid[];
  v_n int;
  v_eligible int;
  v_rows int;
  v_trade record;
  v_per numeric;
  v_share numeric;
  v_trades int := 0;
  v_allocs int := 0;
begin
  if not (public.is_admin() or coalesce(auth.jwt() ->> 'role','') = 'service_role') then
    raise exception 'admin only';
  end if;
  if p_user_id is null then raise exception 'p_user_id is required'; end if;

  select array_agg(fa.id) into v_accounts from finance.family_accounts fa
  where (not p_only_active or fa.dollar_per_day > 0);
  v_n := coalesce(array_length(v_accounts,1),0);
  if v_n = 0 then raise exception 'no target family accounts'; end if;

  for v_trade in
    select et.id, et.units_acquired, et.execution_time, et.dollar_amount,
           et.asset_symbol, et.platform
    from finance.executed_trades et
    where et.user_id = p_user_id
      and not exists (select 1 from finance.allocations al where al.executed_trade_id = et.id)
      and coalesce((select sd.is_family from finance.symbol_designations sd
                    where sd.asset_symbol = et.asset_symbol and sd.platform = et.platform), false)
    order by et.execution_time, et.id
  loop
    /**
     * ⚠️ COUNTED PER TRADE, WITH THE INSERT'S OWN PREDICATE. Dividing by accounts that the insert
     * below then filters out is how units left the fund: `v_n` is the candidate pool, `v_eligible`
     * is who actually receives a row. The two differ the moment any account has a later
     * start_date — or a NULL one, which fails `>=` and is the quieter half of the same bug.
     *
     * Zero eligible is not a zero divisor to guard against, it is a trade that predates every
     * account: nobody had started, so there is nothing to split and the trade stays unallocated
     * for `admin_unallocated_trades` to show.
     */
    select count(*) into v_eligible
      from finance.family_accounts fa
     where fa.id = any(v_accounts)
       and v_trade.execution_time::date >= fa.start_date;
    if v_eligible = 0 then continue; end if;

    if v_trade.dollar_amount = 0 then
      -- a RESTATEMENT of a position, not a new one: theirs only in proportion to what they hold
      v_share := finance.family_share_at(v_trade.asset_symbol, v_trade.platform, v_trade.execution_time);
      if coalesce(v_share, 0) <= 0 then
        continue;   -- the family holds none of this position; the split is not theirs
      end if;
      v_per := v_trade.units_acquired * v_share / v_eligible;
    else
      -- an ordinary buy or sell: its size is its own, so split it evenly
      v_per := v_trade.units_acquired / v_eligible;
    end if;

    insert into finance.allocations (family_account_id, executed_trade_id, units_allocated, user_id, created_at)
    select fa.id, v_trade.id, v_per, p_user_id, now()
      from finance.family_accounts fa
     where fa.id = any(v_accounts)
       and v_trade.execution_time::date >= fa.start_date;
    /* ⚠️ THE ROWS, NOT THE DIVISOR. `v_allocs + v_n` reported a figure the insert never wrote,
       and that figure is shown to the admin on the import screen. */
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_trades := v_trades + 1;
      v_allocs := v_allocs + v_rows;
    end if;
  end loop;

  /* `accounts` stays the candidate pool: with per-trade eligibility, different trades can reach
     different numbers of accounts, so there is no single figure for it — `allocationsCreated` is
     the one that is now true. */
  return jsonb_build_object('accounts', v_n, 'tradesAllocated', v_trades, 'allocationsCreated', v_allocs);
end
$$;


ALTER FUNCTION "public"."admin_even_split_trades"("p_user_id" "uuid", "p_only_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_fund_status"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  select jsonb_build_object(
    'accounts',      (select count(*) from finance.family_accounts),
    -- the same day my_fund_status counts to, or the admin total and the member cards disagree
    'promised',      (select coalesce(round(sum(dollar_per_day * greatest(0,(finance.fund_today() - start_date))),2),0)
                        from finance.family_accounts),
    'contributed',   (select coalesce(round(sum(amount),2),0) from finance.family_contributions),
    'contributions', (select count(*) from finance.family_contributions),
    'lastContribution', (select max(contributed_on) from finance.family_contributions),
    'ready',         (select exists (select 1 from finance.family_contributions))
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."admin_fund_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_member"("p_user_id" "uuid") RETURNS TABLE("user_id" "uuid", "username" "text", "first_name" "text", "last_name" "text", "relation" "text", "email" "text", "phone" "text", "role" "text", "created_at" timestamp with time zone, "suspended" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  return query
  select p.user_id, p.username::text, p.first_name, p.last_name, p.relation,
         p.email, p.phone, ur.role, au.created_at, coalesce(p.suspended, false) as suspended
  from public.user_roles ur
  left join public.profiles p on p.user_id = ur.user_id
  left join auth.users au on au.id = ur.user_id
  where ur.user_id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."admin_get_member"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_portfolios"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  -- `||` merges the owner fields ON TOP of the shared payload. Restating the object here is
  -- exactly the mistake this migration exists to remove.
  select coalesce(
           jsonb_agg(
             finance.account_payload(fa.id) || jsonb_build_object(
               'ownerUserId', fa.user_id,
               'ownerName', pr.first_name,
               'ownerUsername', pr.username
             )
             order by pr.first_name nulls last, fa.display_name
           ), '[]'::jsonb)
    into v_result
    from finance.family_accounts fa
    left join public.profiles pr on pr.user_id = fa.user_id;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."admin_get_portfolios"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_get_timeline"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  return public._fund_timeline(null, true);
end $$;


ALTER FUNCTION "public"."admin_get_timeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_import_trades"("p_user_id" "uuid", "p_trades" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v jsonb;
  v_symbol text;
  v_platform text;
  v_units numeric;
  v_price numeric;
  v_dollars numeric;
  v_kind text;
  v_held numeric;
  v_inserted int := 0;
  v_skipped int := 0;
  v_trimmed int := 0;
  v_total int := 0;
begin
  if not (public.is_admin() or coalesce(auth.jwt() ->> 'role','') = 'service_role') then
    raise exception 'admin only';
  end if;
  if p_user_id is null then raise exception 'p_user_id is required'; end if;
  if jsonb_typeof(p_trades) is distinct from 'array' then
    raise exception 'p_trades must be a json array';
  end if;

  for v in select * from jsonb_array_elements(p_trades)
  loop
    v_total := v_total + 1;
    v_symbol := nullif(btrim(v ->> 'symbol'), '');
    v_platform := coalesce(nullif(btrim(v ->> 'platform'),''), 'unknown');
    v_units  := coalesce(nullif(v ->> 'units','')::numeric, 0);
    v_price  := coalesce(nullif(v ->> 'price','')::numeric, 0);
    v_dollars := coalesce(nullif(v ->> 'dollars','')::numeric, v_price * v_units);

    -- Trust the sender's classification only where it is a value we know; otherwise derive what
    -- is certain and leave buy-vs-drip unset rather than guessing it.
    v_kind := nullif(btrim(v ->> 'kind'), '');
    if v_kind is not null and v_kind not in ('buy','sell','drip','adjustment') then
      v_kind := null;
    end if;
    if v_kind is null then
      if v_dollars = 0 and v_price = 0 and v_units <> 0 then v_kind := 'adjustment';
      elsif v_dollars < 0 then v_kind := 'sell';
      end if;
    end if;

    -- buys: units>0, dollars>0. sells: units<0, dollars<0.
    -- adjustments (splits/symbol changes): units≠0, dollars=0, price=0.
    if v_symbol is null or v_units = 0
       or (v_dollars <> 0 and (v_price <= 0 or sign(v_dollars) <> sign(v_units))) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    /**
     * ⚠️ ROBINHOOD ROUNDS A SYMBOL CHANGE TO FOUR DECIMALS AND THE BUYS IT CANCELS ARE NOT
     * ROUNDED, SO THE TWO DO NOT MEET (plan P3.1). CCIV is the real case: 6 + 0.286364 bought,
     * then "6.2864S" removed when it became LCID. That leaves −0.000036 — a position very
     * slightly NEGATIVE, for ever, in a symbol that no longer exists under that name. It is the
     * "oversold?" flag on the admin screen, and it is arithmetic rather than a missing trade.
     *
     * So a zero-dollar removal that would overshoot removes exactly what is held instead. Bounded
     * deliberately:
     *   - only `dollars = 0`, so a SELL — real money, real units — is never touched;
     *   - only when something IS held, so a removal against nothing still records as it arrived
     *     and stays visible as the discrepancy it is;
     *   - only when the result would land under 0.0001 or below zero, so a genuine partial
     *     removal is left alone.
     *
     * ⚠️ AND IT IS COUNTED, because this quietly changes a number the broker sent. `trimmed` says
     * how many rows were absorbed; a reconciliation against the broker will differ by exactly
     * that rounding, which is the honest side of the trade — the alternative is a position the
     * fund knows is impossible.
     *
     * The parser does NOT do this, on purpose: it reports what the broker said, and
     * `server/lib/parseTrades.test.mjs` pins that with the CCIV fixture. Only the database can
     * see the whole position.
     */
    if v_dollars = 0 and v_units < 0 then
      select coalesce(sum(et.units_acquired), 0) into v_held
        from finance.executed_trades et
       where et.user_id = p_user_id
         and et.asset_symbol = v_symbol
         and et.platform = v_platform;
      if v_held > 0 and v_held + v_units < 0.0001 then
        v_units := -v_held;
        v_trimmed := v_trimmed + 1;
      end if;
    end if;

    insert into finance.executed_trades (
      user_id, asset_symbol, asset_type, platform, execution_time,
      dollar_amount, price, units_acquired, fee, import_key, kind, created_at
    )
    values (
      p_user_id,
      v_symbol,
      coalesce(nullif(btrim(v ->> 'assetType'),''), 'stock'),
      v_platform,
      coalesce(nullif(v ->> 'date','')::timestamptz, now()),
      v_dollars,
      greatest(v_price, 0),
      v_units,
      coalesce(nullif(v ->> 'fee','')::numeric, 0),
      nullif(btrim(v ->> 'importKey'), ''),
      v_kind,
      now()
    )
    on conflict (import_key) where import_key is not null do nothing;

    if found then v_inserted := v_inserted + 1;
    else v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                            'trimmed', v_trimmed, 'total', v_total);
end;
$$;


ALTER FUNCTION "public"."admin_import_trades"("p_user_id" "uuid", "p_trades" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_link_snake_handle"("p_registry_id" bigint, "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if not exists (select 1 from public.player_registry where id = p_registry_id) then
    raise exception 'no such handle';
  end if;
  if p_user_id is not null
     and not exists (select 1 from public.profiles where user_id = p_user_id) then
    raise exception 'no such member';
  end if;
  update public.player_registry set user_id = p_user_id where id = p_registry_id;
end;
$$;


ALTER FUNCTION "public"."admin_link_snake_handle"("p_registry_id" bigint, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_contact_messages"("p_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(m)::jsonb order by m.created_at desc)
    from (
      select id, created_at, name, email, body, handled
        from public.contact_messages
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) m
  ), '[]'::jsonb);
end
$$;


ALTER FUNCTION "public"."admin_list_contact_messages"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_contributions"() RETURNS TABLE("id" "uuid", "amount" numeric, "contributed_on" "date", "note" "text", "per_person" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
  select c.id, c.amount, c.contributed_on, c.note,
         -- what each account's equal share of this contribution came to
         round(c.amount / greatest(1, (select count(*) from finance.family_accounts)), 2)
  from finance.family_contributions c
  where public.is_admin() and c.user_id = auth.uid()
  order by c.contributed_on desc, c.created_at desc;
$$;


ALTER FUNCTION "public"."admin_list_contributions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_positions"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."admin_list_positions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_snake_handles"() RETURNS TABLE("registry_id" bigint, "registry_name" "text", "board_names" "text", "best_score" integer, "runs" integer, "owner_user_id" "uuid", "owner_username" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;

  return query
  select
    r.id,
    r.player_name::text,
    (select string_agg(distinct l.player_name, ' · ')
       from public.leaderboard l where l.player_id = r.id),
    (select max(l.score) from public.leaderboard l where l.player_id = r.id),
    (select count(*)::int from public.score_history sh where sh.player_id = r.id),
    r.user_id,
    (select p.username::text from public.profiles p where p.user_id = r.user_id)
  from public.player_registry r
  -- only handles with actual play behind them; the registry also holds unused invite
  -- placeholders, which would bury the rows that need a decision
  where (exists (select 1 from public.leaderboard l where l.player_id = r.id)
      or exists (select 1 from public.score_history sh where sh.player_id = r.id))
  order by r.user_id nulls first, 3 desc nulls last;
end;
$$;


ALTER FUNCTION "public"."admin_list_snake_handles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_member_features"("p_user_id" "uuid") RETURNS TABLE("feature" "text", "enabled" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_target_admin boolean := exists(select 1 from public.admin_users a where a.user_id = p_user_id);
  v_role text := coalesce((select ur.role from public.user_roles ur where ur.user_id = p_user_id), 'friend');
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  return query
  select f.feature,
         coalesce(
           (select af.enabled from public.account_features af
              where af.user_id = p_user_id and af.feature = f.feature),
           f.default_enabled
         ) as enabled
  from (values ('finance', (v_target_admin or v_role = 'family'))) as f(feature, default_enabled);
end;
$$;


ALTER FUNCTION "public"."admin_member_features"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_members_without_age_band"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_handles jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  /* the same member source `feed_recent` walks, so the notice cannot name somebody the feed
     was never going to consider, nor miss somebody it was */
  select coalesce(jsonb_agg(p.username::text order by p.username), '[]'::jsonb)
    into v_handles
    from public.profiles p
   where p.age_band is null
     and coalesce(p.suspended, false) = false;

  return jsonb_build_object('count', jsonb_array_length(v_handles), 'handles', v_handles);
end $$;


ALTER FUNCTION "public"."admin_members_without_age_band"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_picture_totals"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select jsonb_build_object(
    'count',   count(*),
    'ready',   count(*) filter (where ready),
    'pending', count(*) filter (where not ready),
    /* ⚠️ STALE IS AN HOUR, BECAUSE THAT IS WHAT `picture_claim` SWEEPS AT. A claim older than an
       hour is one the sweep will delete the next time its owner keeps anything -- so this counts
       quota held by pictures that do not exist, and the figure is only alarming if it stays. */
    'stale',   count(*) filter (where not ready and created_at < now() - interval '1 hour'),
    'bytes',   coalesce(sum(bytes + thumb_bytes), 0),
    'members', count(distinct owner)
  ) into v
  from public.member_pictures;

  return v
    || jsonb_build_object(
      /* over 80% of EITHER ceiling, which is `picture_claim`'s own pair: 500 rows or 50 MB */
      'members_near_cap', (
        select count(*) from (
          select owner, count(*) as n, coalesce(sum(bytes + thumb_bytes), 0) as b
            from public.member_pictures group by owner
        ) z where z.n >= 400 or z.b >= 41943040
      ),
      'orphans', (select count(*) from public.picture_orphans where swept_at is null),
      'orphans_oldest', (select min(at) from public.picture_orphans where swept_at is null)
    );
end
$$;


ALTER FUNCTION "public"."admin_picture_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reassign_family_account"("p_account" "uuid", "p_new_owner" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_account is null or p_new_owner is null then raise exception 'account and new owner required'; end if;
  if not exists (select 1 from auth.users u where u.id = p_new_owner) then
    raise exception 'no such user';
  end if;
  update finance.family_accounts set user_id = p_new_owner where id = p_account;
  if not found then raise exception 'no such account'; end if;
end $$;


ALTER FUNCTION "public"."admin_reassign_family_account"("p_account" "uuid", "p_new_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_recent_reviews"("p_limit" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."admin_recent_reviews"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reconciliation"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_symbols jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  select jsonb_agg(s order by (s->>'wholeValue')::numeric desc nulls last) into v_symbols from (
    select jsonb_build_object(
      'symbol', w.asset_symbol,
      'platform', w.platform,
      'wholeUnits', round(w.whole_units, 6),
      'familyUnits', round(coalesce(f.fam_units, 0), 6),
      'personalUnits', round(w.whole_units - coalesce(f.fam_units, 0), 6),
      'familyAvgCost', (select round(h.avg_cost, 4) from finance._held_avg_costs() h
                         where h.symbol = w.asset_symbol and h.platform = w.platform),
      'price', pc.price,
      'priceAt', pc.updated_at,
      'wholeValue', case when pc.price is null then null else round(w.whole_units * pc.price, 2) end,
      'familyValue', case when pc.price is null then null
                          else round(coalesce(f.fam_units, 0) * pc.price, 2) end,
      'isFamily', coalesce(sd.is_family, false)
    ) as s
    from (
      select et.asset_symbol, et.platform, sum(et.units_acquired) as whole_units
      from finance.executed_trades et
      where et.user_id = v_uid
      group by et.asset_symbol, et.platform
      having sum(et.units_acquired) > 0.000001
    ) w
    left join (
      select et.asset_symbol, et.platform, sum(al.units_allocated) as fam_units
      from finance.allocations al join finance.executed_trades et on et.id = al.executed_trade_id
      group by et.asset_symbol, et.platform
    ) f on f.asset_symbol = w.asset_symbol and f.platform = w.platform
    left join finance.price_cache pc on pc.asset_symbol = w.asset_symbol
    left join finance.symbol_designations sd
      on sd.asset_symbol = w.asset_symbol and sd.platform = w.platform
  ) t;

  return jsonb_build_object(
    'checks', coalesce(finance.integrity_checks(), '[]'::jsonb),
    'symbols', coalesce(v_symbols, '[]'::jsonb),
    'generatedAt', now()
  );
end
$$;


ALTER FUNCTION "public"."admin_reconciliation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_refresh_prices"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return finance.refresh_prices();
end
$$;


ALTER FUNCTION "public"."admin_refresh_prices"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_contact_handled"("p_id" "uuid", "p_handled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.contact_messages set handled = coalesce(p_handled, true) where id = p_id;
end
$$;


ALTER FUNCTION "public"."admin_set_contact_handled"("p_id" "uuid", "p_handled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_feature"("p_user_id" "uuid", "p_feature" "text", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_feature not in ('finance') then raise exception 'unknown feature'; end if;
  insert into public.account_features(user_id, feature, enabled, updated_at)
  values (p_user_id, p_feature, p_enabled, now())
  on conflict (user_id, feature) do update set enabled = excluded.enabled, updated_at = now();
end;
$$;


ALTER FUNCTION "public"."admin_set_feature"("p_user_id" "uuid", "p_feature" "text", "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_feed_consent"("p_username" "text", "p_age_band" "text" DEFAULT NULL::"text", "p_feed_opt_in" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_age_band is not null and p_age_band not in ('adult','minor','unknown') then
    raise exception 'age band must be adult, minor or unknown';
  end if;
  select user_id into v_uid from public.profiles where lower(username) = lower(p_username);
  if v_uid is null then raise exception 'no such member'; end if;
  update public.profiles
     set age_band = case when p_age_band is null then age_band
                         when p_age_band = 'unknown' then null
                         else p_age_band end,
         feed_opt_in = coalesce(p_feed_opt_in, feed_opt_in)
   where user_id = v_uid;
  return (select jsonb_build_object('username', username, 'age_band', age_band,
                                    'feed_opt_in', feed_opt_in, 'in_feed', age_band = 'adult' or feed_opt_in)
            from public.profiles where user_id = v_uid);
end $$;


ALTER FUNCTION "public"."admin_set_feed_consent"("p_username" "text", "p_age_band" "text", "p_feed_opt_in" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_price"("p_symbol" "text", "p_price" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(btrim(p_symbol), '') = '' then raise exception 'symbol required'; end if;
  if p_price is null or p_price <= 0 then raise exception 'price must be > 0'; end if;
  insert into finance.price_cache (asset_symbol, price, updated_at)
  values (btrim(p_symbol), p_price, now())
  on conflict (asset_symbol) do update set price = excluded.price, updated_at = excluded.updated_at;
  insert into finance.price_history (asset_symbol, price, captured_at)
  values (btrim(p_symbol), p_price, now())
  on conflict do nothing;
end $$;


ALTER FUNCTION "public"."admin_set_price"("p_symbol" "text", "p_price" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_suspended"("p_user_id" "uuid", "p_suspended" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if exists(select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'cannot suspend an admin account';
  end if;
  update public.profiles set suspended = p_suspended, updated_at = now() where user_id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."admin_set_suspended"("p_user_id" "uuid", "p_suspended" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_symbol_designation"("p_symbol" "text", "p_platform" "text", "p_family" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_sym text := btrim(p_symbol);
  v_plat text := btrim(p_platform);
  v_before int := 0;
  v_after int := 0;
  v_removed int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(v_sym,'')='' or coalesce(v_plat,'')='' then
    raise exception 'symbol and platform required';
  end if;

  insert into finance.symbol_designations (asset_symbol, platform, is_family, updated_at)
  values (v_sym, v_plat, p_family, now())
  on conflict (asset_symbol, platform) do update set is_family = excluded.is_family, updated_at = now();

  if p_family then
    /**
     * ⚠️ THIS USED TO HAVE ITS OWN ALLOCATION LOOP, and that loop knew neither rule: no
     * start_date filter and no restatement scaling. One click on a symbol Evan has traded for
     * years inserted its ENTIRE history -- 1,180 unallocated pre-fund trades existed across 148
     * symbols, and `U` alone would have added 127 x 33 = 4,191 rows dated back to 2020. That is
     * precisely the state the 2026-08-23 migration had to delete 3,663 rows to undo.
     *
     * It delegates now, to the one loop that has always known both rules and that the importer
     * already calls. The count is taken for THIS symbol so the number the admin reads is about
     * the button they pressed.
     */
    select count(*) into v_before from finance.allocations al
      join finance.executed_trades et on et.id = al.executed_trade_id
     where et.asset_symbol = v_sym and et.platform = v_plat;

    perform public.admin_even_split_trades(v_uid, true);

    select count(*) into v_after from finance.allocations al
      join finance.executed_trades et on et.id = al.executed_trade_id
     where et.asset_symbol = v_sym and et.platform = v_plat;
  else
    delete from finance.allocations al using finance.executed_trades et
    where al.executed_trade_id = et.id
      and et.user_id = v_uid and et.asset_symbol = v_sym and et.platform = v_plat;
    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object('family', p_family,
                            'allocationsCreated', greatest(v_after - v_before, 0),
                            'allocationsRemoved', v_removed);
end $$;


ALTER FUNCTION "public"."admin_set_symbol_designation"("p_symbol" "text", "p_platform" "text", "p_family" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_trade_allocation"("p_trade" "uuid", "p_fraction" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_trade record;
  v_n int;
  v_per numeric;
  v_share numeric;
  v_units numeric;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_fraction is null or p_fraction < 0 or p_fraction > 1 then
    raise exception 'fraction must be between 0 and 1';
  end if;

  select id, units_acquired, execution_time, dollar_amount, asset_symbol, platform
    into v_trade
    from finance.executed_trades where id = p_trade;
  if v_trade.id is null then raise exception 'no such trade'; end if;

  -- start clean: changing your mind replaces the answer, never adds to it
  delete from finance.allocations where executed_trade_id = p_trade;

  -- ⚠️ BEFORE the fraction=0 early return, not after. That return is the whole reason "mine"
  -- used to be indistinguishable from silence.
  update finance.executed_trades set reviewed_at = now() where id = p_trade;

  if p_fraction = 0 then
    return jsonb_build_object('allocated', 0, 'accounts', 0, 'reviewed', true);
  end if;

  select count(*) into v_n
    from finance.family_accounts fa
   where fa.dollar_per_day > 0 and v_trade.execution_time::date >= fa.start_date;
  if v_n = 0 then
    raise exception 'no family account existed on %', v_trade.execution_time::date;
  end if;

  /**
   * ⚠️ A zero-dollar row is a RESTATEMENT, and "all of it" means all of THEIR share of it.
   * Answering 1.0 on a reverse split of a position the family owns 86% of would have credited
   * them 3.5 units of a 3.0-unit position -- the OLOX bug, reachable from this button because
   * this was the one allocation path that never learned the rule.
   */
  v_units := v_trade.units_acquired;
  if v_trade.dollar_amount = 0 then
    v_share := finance.family_share_at(v_trade.asset_symbol, v_trade.platform, v_trade.execution_time);
    if coalesce(v_share, 0) <= 0 then
      return jsonb_build_object('allocated', 0, 'accounts', 0, 'reviewed', true,
                                'note', 'the family holds none of this position, so the restatement is not theirs');
    end if;
    v_units := v_units * v_share;
  end if;

  v_per := v_units * p_fraction / v_n;

  insert into finance.allocations (family_account_id, executed_trade_id, units_allocated, user_id, created_at)
  select fa.id, p_trade, v_per, v_uid, now()
    from finance.family_accounts fa
   where fa.dollar_per_day > 0 and v_trade.execution_time::date >= fa.start_date;

  return jsonb_build_object('allocated', v_n, 'unitsEach', v_per, 'fraction', p_fraction,
                            'reviewed', true);
end
$$;


ALTER FUNCTION "public"."admin_set_trade_allocation"("p_trade" "uuid", "p_fraction" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_tax_status"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  with hp as (
    select h.symbol, h.platform, h.asset_type, h.units_held, h.fifo_basis,
           h.long_units, h.short_units, h.oldest_lot, h.next_cross, h.next_cross_units,
           h.lots, hac.avg_cost, pc.price, pc.updated_at as price_at
      from finance.holding_periods() h
      join finance._held_avg_costs() hac
        on hac.symbol = h.symbol and hac.platform = h.platform
      left join finance.price_cache pc on pc.asset_symbol = h.symbol
  ),
  buys as (
    select t.sym, t.plat,
           max(t.d) as last_buy,
           count(*) filter (where t.d > finance.fund_today() - 30) as buys_30d,
           count(*) filter (where t.d > finance.fund_today() - 61) as buys_61d
      from (
        select et.asset_symbol as sym, et.platform as plat, et.execution_time::date as d,
               sum(al.units_allocated / nullif(et.units_acquired, 0) * et.dollar_amount) as c
          from finance.allocations al
          join finance.executed_trades et on et.id = al.executed_trade_id
         group by et.id, et.asset_symbol, et.platform, et.execution_time::date
      ) t
     where t.c > 0.005
     group by t.sym, t.plat
  ),
  rows_ as (
    select hp.*, b.last_buy, coalesce(b.buys_30d, 0) buys_30d, coalesce(b.buys_61d, 0) buys_61d,
           round(hp.units_held  * hp.avg_cost, 2) as basis,
           round(hp.long_units  * hp.avg_cost, 2) as long_basis,
           round(hp.short_units * hp.avg_cost, 2) as short_basis,
           case when hp.price is null then null else round(hp.units_held  * hp.price, 2) end as value,
           case when hp.price is null then null else round(hp.long_units  * hp.price, 2) end as long_value,
           case when hp.price is null then null else round(hp.short_units * hp.price, 2) end as short_value
      from hp left join buys b on b.sym = hp.symbol and b.plat = hp.platform
  ),
  crossings as (
    select to_char((l.d + interval '1 year 1 day'), 'YYYY-MM') as month,
           round(sum(l.u * r.avg_cost), 2) as basis
      from rows_ r
      cross join lateral (
        select (e->>'d')::date as d, (e->>'u')::numeric as u
          from jsonb_array_elements(r.lots) e
      ) l
     where l.d > (finance.fund_today() - interval '1 year 1 day')::date
     group by 1
  ),
  crossings_cum as (
    select month, basis,
           round(sum(basis) over (order by month rows between unbounded preceding and current row), 2) cumulative
      from crossings
  )
  select jsonb_build_object(
    'asOf', finance.fund_today(),
    'totals', jsonb_build_object(
      'positions',   (select count(*) from rows_),
      'unpriced',    (select count(*) from rows_ where price is null),
      -- basis is always known: it comes from the trades, not from a price feed
      'basis',       (select round(sum(basis), 2)       from rows_),
      'longBasis',   (select round(sum(long_basis), 2)  from rows_),
      'shortBasis',  (select round(sum(short_basis), 2) from rows_),
      -- ⚠️ value and its denominators cover PRICED positions only. An unpriced holding is not
      -- worth zero; it is not yet known, and saying zero turns a missing price into a loss.
      'value',       (select coalesce(round(sum(value), 2), 0)       from rows_ where price is not null),
      'longValue',   (select coalesce(round(sum(long_value), 2), 0)  from rows_ where price is not null),
      'shortValue',  (select coalesce(round(sum(short_value), 2), 0) from rows_ where price is not null),
      'pricedBasis',      (select coalesce(round(sum(basis), 2), 0)       from rows_ where price is not null),
      'pricedLongBasis',  (select coalesce(round(sum(long_basis), 2), 0)  from rows_ where price is not null),
      'pricedShortBasis', (select coalesce(round(sum(short_basis), 2), 0) from rows_ where price is not null),
      'unpricedBasis',    (select coalesce(round(sum(basis), 2), 0)       from rows_ where price is null),
      'nextCross',   (select min(next_cross) from rows_ where next_cross is not null)
    ),
    'crossings', coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'basis', basis, 'cumulative', cumulative)
                       order by month)
        from crossings_cum), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'symbol', symbol, 'platform', platform, 'assetType', asset_type,
               'units', round(units_held, 8), 'avgCost', round(avg_cost, 6),
               'price', price, 'priceAt', price_at,
               'basis', basis, 'value', value,
               'longUnits', round(long_units, 8), 'longBasis', long_basis, 'longValue', long_value,
               'shortUnits', round(short_units, 8), 'shortBasis', short_basis, 'shortValue', short_value,
               'nextCross', next_cross,
               'nextCrossBasis', round(next_cross_units * avg_cost, 2),
               'daysToNextCross', case when next_cross is null then null
                                       else next_cross - finance.fund_today() end,
               'oldestLot', oldest_lot,
               'lastBuy', last_buy,
               'daysSinceBuy', case when last_buy is null then null
                                    else finance.fund_today() - last_buy end,
               'buys30d', buys_30d,
               'buys61d', buys_61d,
               'brokerBasis', fifo_basis,
               'brokerGap', round(fifo_basis - basis, 2)
             ) order by coalesce(value, 0) desc, basis desc)
        from rows_), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;


ALTER FUNCTION "public"."admin_tax_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_unallocated_trades"("p_limit" integer DEFAULT 100, "p_imported_since" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."admin_unallocated_trades"("p_limit" integer, "p_imported_since" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_family_account"("p_account" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") RETURNS "finance"."family_accounts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare out_row finance.family_accounts;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_admin() then raise exception 'admin only'; end if;
  update finance.family_accounts set
    display_name   = coalesce(nullif(btrim(p_name), ''), display_name),
    dollar_per_day = coalesce(p_dollar_per_day, dollar_per_day),
    start_date     = p_start_date
  where id = p_account
  returning * into out_row;
  if not found then raise exception 'account not found'; end if;
  return out_row;
end;
$$;


ALTER FUNCTION "public"."admin_update_family_account"("p_account" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_member"("p_user_id" "uuid", "p_first_name" "text", "p_email" "text", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_role not in ('family','friend') then raise exception 'role must be family or friend'; end if;
  -- don't let the class of a real admin be flipped through this path
  if exists(select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'this account is an admin; manage it separately';
  end if;
  update public.profiles
     set first_name = p_first_name, email = p_email, updated_at = now()
   where user_id = p_user_id;
  update public.user_roles set role = p_role where user_id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."admin_update_member"("p_user_id" "uuid", "p_first_name" "text", "p_email" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."are_friends"("u1" "uuid", "u2" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when u1 is null or u2 is null then false
    when auth.uid() in (u1, u2) or public.is_admin()
      then exists (select 1 from public.friendships f
                    where f.user_a = least(u1, u2) and f.user_b = greatest(u1, u2)
                      and f.status = 'accepted')
    else null
  end;
$$;


ALTER FUNCTION "public"."are_friends"("u1" "uuid", "u2" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."are_friends"("u1" "uuid", "u2" "uuid") IS 'Whether two accounts are friends. ANSWERS ONLY WHEN THE CALLER IS ONE OF THEM (or is an admin); any other pairing returns NULL. Every call site in this database passes auth.uid() or a variable set from it, checked before this guard was added.';



CREATE OR REPLACE FUNCTION "public"."bug_report_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  recent int;
begin
  select count(*) into recent
    from public.bug_report
   where reporter = auth.uid()
     and created_at > now() - interval '1 hour';
  if recent >= 10 then
    raise exception 'too many reports in the last hour';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."bug_report_rate_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_see"("p_owner" "uuid", "p_tier" "public"."visibility_tier") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  /* The tier this row is actually served at: what the owner asked for, cut to what the owner is
     allowed to choose. A row stored as 'public' before the ceiling existed must not keep being
     served as public while the rule waits for somebody to re-save it -- which is why the clamp
     lives on the READ side and not only on the write side.

     p_owner null keeps its old meaning untouched: there is no owner to have a ceiling, and the
     'is this an admin' branch below still decides it. */
  with t as (
    select case when p_owner is null then p_tier
                else least(p_tier, public.visibility_ceiling(p_owner))
           end as tier
  )
  select case
    when (select tier from t) = 'public' then true
    when auth.uid() is not null and p_owner = auth.uid() then true
    when (select tier from t) = 'members' then exists (
      select 1 from public.profiles
      where user_id = auth.uid() and coalesce(suspended, false) = false)
    /* ⚠️ NO `is_admin()` HERE ANY MORE (Phase 3). Being the site owner used to be a standing
       permission to read every friends-tier row on the site, which is the opposite of "Only me
       means no one else, owner included". Moderation gets a named path when a real report needs
       one; until then reading somebody's private things is not a side effect of who you are. */
    when (select tier from t) = 'friends' then
      auth.uid() is not null and p_owner is not null
      and public.are_friends(auth.uid(), p_owner)
    /* 'certain' is narrower than 'friends' and has no circles wired to it yet, so it reaches
       nobody but the owner -- who is already answered by the branch above. Phase 5 gives it its
       own branch; until then the safe reading of an unwired level is "no". */
    when p_owner is null then public.is_admin()
    else false
  end;
$$;


ALTER FUNCTION "public"."can_see"("p_owner" "uuid", "p_tier" "public"."visibility_tier") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_see"("p_owner" "uuid", "p_tier" "public"."visibility_tier") IS 'The one place the visibility rule lives. Admin override deliberately stops at private for rows owned by another member, so private means private in the app.';



CREATE OR REPLACE FUNCTION "public"."can_see_item"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when p_tier is distinct from 'certain'::public.visibility_tier
      then public.can_see(p_owner, p_tier)
    when auth.uid() is null or p_owner is null then false
    when p_owner = auth.uid() then true
    when p_item_kind is null or p_item_id is null then false
    else coalesce(public.are_friends(auth.uid(), p_owner), false)
         and exists (
           select 1 from public.visibility_certain vc
            where vc.item_kind = p_item_kind
              and vc.item_id = p_item_id
              and vc.friend = auth.uid()
              and vc.owner = p_owner
         )
  end;
$$;


ALTER FUNCTION "public"."can_see_item"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_messages_author_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text;
begin
  select kind into v_kind from public.chat_rooms where id = new.room_id;
  if v_kind = 'lounge' then
    if new.user_id is not null then
      raise exception 'lounge messages must not carry an author id — see lounge_message_authors';
    end if;
  elsif new.user_id is null then
    raise exception 'user_id is required outside the lounge';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."chat_messages_author_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_room_for_new_group"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.chat_rooms (kind, group_id) values ('circuit', new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."chat_room_for_new_group"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_room_member"("p_room" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.chat_rooms r
    where r.id = p_room and (
      (r.kind = 'circuit' and exists (
        select 1 from public.circuit_group_members m
        where m.group_id = r.group_id and m.user_id = auth.uid()))
      or (r.kind = 'lounge' and exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and coalesce(p.suspended, false) = false
          and coalesce(p.lounge_opt_in, false) = true))
      or (r.kind = 'dm' and exists (
        select 1 from public.chat_room_members cm
        where cm.room_id = r.id and cm.user_id = auth.uid()))
    )
  );
$$;


ALTER FUNCTION "public"."chat_room_member"("p_room" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_topic_member"("p_topic" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  raw text;
begin
  raw := substring(p_topic from '^chat:([0-9a-fA-F-]{36})$');
  if raw is null then
    return false;
  end if;
  return public.chat_room_member(raw::uuid);
end;
$_$;


ALTER FUNCTION "public"."chat_topic_member"("p_topic" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_activities_mine"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'name', a.name, 'cat', a.cat, 'colour', a.colour,
             'archived', a.archived_at is not null, 'auto', a.auto, 'metric', a.metric,
             'session', a.session_mins, 'shared', a.shared,
             'visibility', a.visibility
           ) order by a.archived_at nulls first, a.auto, a.name)
      from public.chronicle_activities a where a.owner = auth.uid()
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_activities_mine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_activity_archive"("p_id" "uuid", "p_archived" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.chronicle_activities
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such activity'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_activity_archive"("p_id" "uuid", "p_archived" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_activity_save"("p_id" "uuid", "p_name" "text", "p_cat" "text", "p_colour" "text", "p_metric" "text", "p_session" integer, "p_shared" boolean DEFAULT NULL::boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id uuid; v_count int;
  v_metric text := nullif(btrim(coalesce(p_metric,'')),'');
  -- clamped rather than raised, like the estimate on a goal: losing the whole save over an
  -- optional field is a worse outcome than losing the field
  v_session int := case
                     when p_session is null then null
                     when p_session <= 0 then null
                     when p_session > 1440 then 1440
                     else p_session
                   end;
  v_clash uuid;
  v_away  boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /**
   * ⚠️ A UNIQUE INDEX IS NOT A SENTENCE. `chronicle_activities_owner_name_key` was the only
   * thing stopping two activities sharing a name, so a second "Gym" came back as
   * "duplicate key value violates unique constraint ..." — which `saveActivity` passes
   * straight to the screen. That is a reasonable thing to read in a log and not a thing to
   * hand somebody standing on a platform, and the Now room makes it a LIKELY answer rather
   * than a rare one: typing a name you already have is the obvious mistake there.
   *
   * ⚠️ AND THE ARCHIVED CASE IS A DIFFERENT SENTENCE. The index does not care, so both clashes
   * read identically — but "you already have one called Gym" is a confusing thing to be told
   * about a Gym that is not in your list. It is archived, and the control that undoes that
   * says "Bring back", so the message says so too.
   *
   * ⚠️ IT COVERS THE RENAME AS WELL AS THE INSERT, which is why it sits above the branch
   * rather than inside it: renaming Drawing to Gym hits the same index and said the same
   * thing. `id <> p_id` is what lets an activity keep its own name.
   */
  select id, archived_at is not null into v_clash, v_away
    from public.chronicle_activities
   where owner = auth.uid() and name = btrim(p_name)
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    if v_away then
      raise exception '% is archived — bring it back in Chronicle', btrim(p_name);
    else
      raise exception 'you already have one called %', btrim(p_name);
    end if;
  end if;
  if p_id is null then
    select count(*) into v_count from public.chronicle_activities where owner = auth.uid();
    if v_count >= 200 then raise exception 'that is 200 activities — archive one'; end if;
    insert into public.chronicle_activities (owner, name, cat, colour, metric, session_mins)
    values (auth.uid(), btrim(p_name), p_cat, nullif(btrim(coalesce(p_colour,'')),''),
            v_metric, v_session)
    returning id into v_id;
  else
    update public.chronicle_activities
       set name = btrim(p_name), cat = p_cat,
           /**
            * ⚠️ NULL LEAVES THE COLOUR ALONE; '' CLEARS IT. The same rule as a session's note, and
            * for the same reason: the room passes null here on every rename — it has never had a
            * colour picker — so this line read "throw away whatever colour this activity had"
            * every time somebody corrected a name or changed a category.
            *
            * ⚠️ AND IT STOPPED BEING THEORETICAL WHEN THE IMPORT SHIPPED. Nothing in the room can
            * set a colour, so for a long time there was none to lose. chronicle_export writes the
            * column and chronicle_import puts it back, so a restored file is now the one way an
            * activity can HAVE a colour — and renaming it afterwards was deleting that.
            */
           colour = case when p_colour is null then colour
                         else nullif(btrim(p_colour), '') end,
           metric = case when p_metric is null then metric else v_metric end,
           session_mins = v_session,
           shared = coalesce(p_shared, shared)
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such activity'; end if;
  end if;
  return v_id;
end $$;


ALTER FUNCTION "public"."chronicle_activity_save"("p_id" "uuid", "p_name" "text", "p_cat" "text", "p_colour" "text", "p_metric" "text", "p_session" integer, "p_shared" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_activity_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") RETURNS "public"."visibility_tier"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_id is null then raise exception 'which activity'; end if;
  update public.chronicle_activities
     set visibility = least(public.clamp_visibility(auth.uid(), p_tier),
                            'friends'::public.visibility_tier)
   where id = p_id and owner = auth.uid()
   returning visibility into v_tier;
  -- the same sentence whether it is somebody else's or does not exist
  if v_tier is null then raise exception 'no such activity'; end if;
  return v_tier;
end
$$;


ALTER FUNCTION "public"."chronicle_activity_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_activity_share"("p_id" "uuid", "p_on" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_id is null then raise exception 'which activity'; end if;
  update public.chronicle_activities
     set shared = coalesce(p_on, false)
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such activity'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_activity_share"("p_id" "uuid", "p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entries_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_to <= p_from then raise exception 'that range ends before it starts'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'that is too long a range'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'activity', e.activity, 'start', e.started_at, 'end', e.ended_at,
             'notes', coalesce((
                select jsonb_agg(jsonb_build_object('id', n.id, 'at', n.at, 'body', n.body)
                                 order by n.at, n.id)
                  from public.chronicle_notes n where n.entry = e.id
             ), '[]'::jsonb), 'picture', e.picture, 'amount', e.amount, 'quality', e.quality
           ) order by e.started_at desc)
      from public.chronicle_entries e
     where e.owner = auth.uid()
       and e.started_at < p_to
       and coalesce(e.ended_at, clock_timestamp()) > p_from
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_entries_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entry_add"("p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_to is null or p_from is null or p_to <= p_from then raise exception 'that span ends before it starts'; end if;
  if p_to - p_from > interval '24 hours' then raise exception 'that is more than a day'; end if;
  /**
   * ⚠️ YOU CANNOT HAVE SPENT TIME ON A DAY YOU HAVE NOT LIVED. The room already says this in
   * words — a future day answers "Not here yet. Plan a span below" rather than offering to fill a
   * gap — and then had two doors that wrote one anyway: ⏱ Fill a gap takes free-form datetimes,
   * and chronicle_plan_did hands this function a plan's own times. Pressing ✓ on tomorrow's plan
   * recorded a 45-minute sitting twenty-five hours ahead, counted in the day's totals.
   *
   * ⚠️ THE START, NOT THE END, and the same check chronicle_running_fix already makes in the same
   * words. A span whose END is slightly ahead is what logging a block you are in the middle of
   * looks like, and is also what a clock a couple of minutes fast produces; a span that BEGINS
   * after now is unambiguously time nobody has spent.
   *
   * ⚠️ AND IT IS LAST OF THE THREE so that nothing already refused changes its answer: every
   * input that was rejected before this is rejected with the same words. Only inputs that were
   * ACCEPTED can newly be refused, which is the whole of the behaviour change.
   */
  if p_from > clock_timestamp() then raise exception 'that is in the future'; end if;
  if not exists (select 1 from public.chronicle_activities where id = p_activity and owner = auth.uid()) then
    raise exception 'no such activity';
  end if;
  insert into public.chronicle_entries (owner, activity, started_at, ended_at)
  values (auth.uid(), p_activity, p_from, p_to)
  returning id into v_id;
  /* the note a caller handed us goes where notes live now — see chronicle_notes */
  if nullif(btrim(coalesce(p_note,'')),'') is not null then
    insert into public.chronicle_notes (owner, entry, body)
    values (auth.uid(), v_id, left(btrim(p_note), 4000));
  end if;
  return v_id;
end $$;


ALTER FUNCTION "public"."chronicle_entry_add"("p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entry_amount"("p_id" "uuid", "p_amount" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.chronicle_entries
     set amount = case when p_amount is null or p_amount < 0 then null
                       else least(p_amount, 1e9) end
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such entry'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_entry_amount"("p_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entry_drop"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_entries where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such entry'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_entry_drop"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entry_edit"("p_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text", "p_activity" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_from is null or p_to is null then raise exception 'both ends, please'; end if;
  if p_to <= p_from then raise exception 'that span ends before it starts'; end if;
  if p_to - p_from > interval '24 hours' then raise exception 'that is more than a day'; end if;
  /* ⚠️ the same rule chronicle_entry_add keeps, because a rule only one of them keeps is one you
     get around by adding a legal sitting and then editing it forward. See the note there. */
  if p_from > clock_timestamp() then raise exception 'that is in the future'; end if;

  /**
   * ⚠️ MOVING A SESSION TO ANOTHER ACTIVITY, because pressing Start on the wrong one is the
   * likeliest mistake a stopwatch allows and the only remedy was to delete it and type it in
   * again — losing the amount, the rating, and the day it was recorded.
   *
   * ⚠️ AND THE ACTIVITY IS CHECKED AGAINST THE CALLER, not against the entry. A caller who can
   * name one activity can name any uuid, and the foreign key would happily accept somebody
   * else's — which would hand them a row of their own pointing into another person's list, and
   * put their minutes into that person's totals from the other side. An ARCHIVED one of your own
   * is allowed: archived means put away, not gone, and refusing it would make a tidy-up
   * irreversible.
   */
  if p_activity is not null
     and not exists (select 1 from public.chronicle_activities a
                      where a.id = p_activity and a.owner = auth.uid()) then
    raise exception 'that is not one of your activities';
  end if;

  update public.chronicle_entries
     set started_at = p_from,
         ended_at = p_to,
         /**
          * ⚠️ NULL LEAVES THE NOTE ALONE; '' CLEARS IT. It used to mean "clear it", and the room
          * passed null on every edit — so opening a session's editor and pressing Save, changing
          * nothing, destroyed whatever you had written about it. Measured in the harness:
          * "drafted chapter three" became null with no other field touched.
          *
          * The caller was the thing that was wrong, but the CONTRACT is what made it easy: four
          * positional arguments where the fourth silently means "throw away what is there". Null
          * now means what it means for p_activity one field up — leave it as it is — so a caller
          * that forgets the note can no longer lose it, and the bundle somebody has open right
          * now stops destroying notes the moment this lands rather than when they reload.
          *
          * Clearing one stays possible, and now has to be asked for: pass an empty string.
          */
         activity = coalesce(p_activity, activity)
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such entry'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_entry_edit"("p_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text", "p_activity" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entry_picture"("p_entry" "uuid", "p_picture" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /* ⚠️ BOTH HALVES HAVE TO BE YOURS. The entry check stops a photograph being hung on somebody
     else's sitting; the picture check stops somebody else's photograph being hung on yours,
     which would put a row you own in front of a key you do not. member_pictures is deny-all, so
     neither is covered by anything else. */
  if not exists (select 1 from public.chronicle_entries e
                  where e.id = p_entry and e.owner = auth.uid()) then
    raise exception 'no such session';
  end if;
  if p_picture is not null and not exists (
       select 1 from public.member_pictures m
        where m.id = p_picture and m.owner = auth.uid() and m.ready) then
    raise exception 'no such picture';
  end if;
  update public.chronicle_entries set picture = p_picture where id = p_entry and owner = auth.uid();
end $$;


ALTER FUNCTION "public"."chronicle_entry_picture"("p_entry" "uuid", "p_picture" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_entry_quality"("p_id" "uuid", "p_quality" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_quality is not null and (p_quality < 1 or p_quality > 5) then
    raise exception 'a rating is 1 to 5';
  end if;
  update public.chronicle_entries
     set quality = p_quality::smallint
   where id = p_id and owner = auth.uid();
end $$;


ALTER FUNCTION "public"."chronicle_entry_quality"("p_id" "uuid", "p_quality" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_export"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;

  /**
   * ⚠️ ONE DOCUMENT, NOT FIVE RESULT SETS, and the reason is truncation rather than tidiness.
   * A client-side export would call five RPCs that each return a SET, and a set comes back through
   * PostgREST, which can cap rows. A cap it applies silently turns "here is everything you ever
   * recorded" into "here is some of it" — the same shape as a local ceiling under the server's,
   * where the person is told the thing succeeded. One row cannot be truncated by a row limit.
   *
   * ⚠️ EVERY LIST IS ORDERED, so two exports of unchanged data are byte-identical. Nothing here
   * needs that today; somebody diffing last month's file against this month's does, and an
   * unordered jsonb_agg would make every line look changed.
   *
   * ⚠️ `owner` IS NOT IN THE FILE. It is the same uuid on every row and it is the caller's own id,
   * so writing it out would put an account identifier in a file people are encouraged to pass
   * between machines, in exchange for nothing a restore could not work out.
   *
   * ⚠️ AND IT IS NOT BOUNDED, deliberately. An export that quietly stopped at N rows would be the
   * exact failure it exists to prevent. The ceiling is what one person has written about their own
   * days; the authenticator role's 8s statement_timeout is the backstop, and at three years of
   * three sittings a day this is a few hundred milliseconds.
   */
  return jsonb_build_object(
    'kind', 'chronicle',
    -- a future reader must be able to refuse a file that is not one of these, and to know what
    -- shape it is looking at. Bump this when a field changes meaning, never when one is added.
    'version', 1,
    'at', to_jsonb(now()),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'cat', a.cat, 'colour', a.colour,
               'archived_at', a.archived_at, 'created_at', a.created_at,
               'auto', a.auto, 'metric', a.metric, 'session_mins', a.session_mins, 'shared', a.shared,
               -- the ladder level. `shared` stays beside it because an older reader expects it,
               -- and the two cannot disagree: see chronicle_sharing_becomes_a_tier.
               'visibility', a.visibility,
               'certain', coalesce((
                  select jsonb_agg(pr.username::text order by lower(pr.username::text))
                    from public.visibility_certain vc
                    join public.profiles pr on pr.user_id = vc.friend
                   where vc.item_kind = 'chronicle_activity'
                     and vc.item_id = a.id::text and vc.owner = me
               ), '[]'::jsonb))
             order by a.created_at, a.id)
        from public.chronicle_activities a where a.owner = me), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'activity', e.activity,
               'started_at', e.started_at, 'ended_at', e.ended_at,
               'notes', coalesce((
                  select jsonb_agg(jsonb_build_object('at', nt.at, 'body', nt.body)
                                   order by nt.at, nt.id)
                    from public.chronicle_notes nt where nt.entry = e.id
               ), '[]'::jsonb), 'picture', e.picture, 'amount', e.amount, 'quality', e.quality,
               'created_at', e.created_at)
             order by e.started_at, e.id)
        from public.chronicle_entries e where e.owner = me), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'title', g.title, 'scope', g.scope, 'anchor', g.anchor,
               'repeat_every', g.repeat_every, 'target', g.target, 'unit', g.unit,
               'progress', g.progress, 'done_at', g.done_at, 'note', g.note, 'sort', g.sort,
               'activity', g.activity, 'cat', g.cat, 'counts', g.counts,
               'est_mins', g.est_mins, 'priority', g.priority,
               -- ⚠️ `shared` WAS NEVER IN HERE AT ALL, which means a goal somebody put on their
               -- profile has been coming back from a restore unshared since exports existed.
               -- Fail-closed, so nothing leaked -- but it is a setting silently lost, and the
               -- round-trip test this was found by is the one the ladder's plan asked for.
               'shared', g.shared, 'visibility', g.visibility,
               'certain', coalesce((
                  select jsonb_agg(pr.username::text order by lower(pr.username::text))
                    from public.visibility_certain vc
                    join public.profiles pr on pr.user_id = vc.friend
                   where vc.item_kind = 'chronicle_goal'
                     and vc.item_id = g.id::text and vc.owner = me
               ), '[]'::jsonb),
               'created_at', g.created_at, 'updated_at', g.updated_at)
             order by g.sort, g.created_at, g.id)
        from public.chronicle_goals g where g.owner = me), '[]'::jsonb),
    'routines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.name, 'steps', r.steps,
               'created_at', r.created_at, 'updated_at', r.updated_at)
             order by r.created_at, r.id)
        from public.chronicle_routines r where r.owner = me), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'activity', p.activity,
               'starts_at', p.starts_at, 'ends_at', p.ends_at, 'note', p.note,
               'created_at', p.created_at)
             order by p.starts_at, p.id)
        from public.chronicle_plans p where p.owner = me), '[]'::jsonb)
  );
end $$;


ALTER FUNCTION "public"."chronicle_export"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_friends_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- the window is a convenience, never a boundary -- clamped so a caller cannot ask for the
  -- whole history of everybody they know in one round trip
  v_to   := least(coalesce(p_to, clock_timestamp()), clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '7 days'), v_to - interval '31 days');
  if v_from >= v_to then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(t order by t.started_at desc, t.who, t.activity)
    from (
      select e.id::text                                     as id,
             p.username::text                               as who,
             coalesce(p.first_name, p.username::text)        as name,
             a.name                                          as activity,
             a.cat, a.colour,
             e.started_at, e.ended_at, e.amount, a.metric
        from public.chronicle_entries e
        join public.chronicle_activities a
          on a.id = e.activity and a.owner = e.owner
        join public.profiles p
          on p.user_id = e.owner and coalesce(p.suspended, false) = false
       where e.owner <> v_me
         and e.ended_at is not null
         and e.started_at < v_to
         and e.ended_at   > v_from
         and public.can_see_item(e.owner, a.visibility,
                                 'chronicle_activity', a.id::text)
         and public.are_friends(v_me, e.owner)
         and public.chronicle_shares_timeline(e.owner)
       order by e.started_at desc
       limit 400
    ) t
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_friends_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_goal_drop"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_goals where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such goal'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_goal_drop"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_goal_progress"("p_id" "uuid", "p_progress" numeric, "p_done" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.chronicle_goals
     set progress = greatest(0, least(coalesce(p_progress, progress), 1e9)),
         done_at = case when p_done then coalesce(done_at, now()) else null end,
         updated_at = now()
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such goal'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_goal_progress"("p_id" "uuid", "p_progress" numeric, "p_done" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_goal_save"("p_id" "uuid", "p_title" "text", "p_scope" "text", "p_anchor" "date", "p_repeat" integer, "p_target" numeric, "p_unit" "text", "p_note" "text", "p_sort" integer, "p_activity" "uuid", "p_cat" "text", "p_counts" "text", "p_est" integer, "p_priority" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id uuid; v_count int; v_act uuid := p_activity;
  v_counts text := case when p_counts = 'amount' then 'amount' else 'minutes' end;
  -- ⚠️ CLAMPED RATHER THAN RAISED, both of them, for the same reason the counts correction below
  -- is: a goal with a silly estimate is still a goal somebody is trying to write down, and losing
  -- the whole save over the optional field is a worse outcome than losing the field.
  v_est int := case
                 when p_est is null then null
                 when p_est <= 0 then null
                 when p_est > 10080 then 10080
                 else p_est
               end;
  v_pri smallint := least(greatest(coalesce(p_priority, 0), 0), 2)::smallint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_act is not null and not exists (
        select 1 from public.chronicle_activities where id = v_act and owner = auth.uid()) then
    v_act := null;
  end if;
  /**
   * ⚠️ AN AMOUNT NEEDS SOMETHING THAT COUNTS ONE. Counting an amount without an activity is
   * refused by a constraint, so it is corrected here rather than raised: the goal is still a goal,
   * it just measures time instead.
   *
   * ⚠️ AND AN ACTIVITY THAT NAMES NO METRIC COUNTS NOTHING EITHER, which this missed. The room
   * only offers the choice when the chosen activity has a metric — but the chooser is a separate
   * control from the source, and it keeps its answer when the source moves beneath it. Picking
   * Gym, choosing "count the reps", then changing the source to an activity that counts nothing
   * saved a goal measuring a quantity its source never records. Driven in the room: a goal
   * pointed at Dishes read "0 / 10 done" with twelve minutes of Dishes in the log, two inches
   * from another goal pointed at the same activity reading "12 / 10 minutes".
   *
   * Corrected rather than raised, like its sibling above, and here rather than only in the room,
   * because a rule the client alone keeps is a rule that lasts until the next caller.
   */
  if v_counts = 'amount' and (
       v_act is null
       or not exists (select 1 from public.chronicle_activities a
                       where a.id = v_act and a.owner = auth.uid()
                         and nullif(btrim(coalesce(a.metric, '')), '') is not null))
  then
    v_counts := 'minutes';
  end if;
  if p_id is null then
    select count(*) into v_count from public.chronicle_goals where owner = auth.uid();
    if v_count >= 500 then raise exception 'that is 500 goals — finish or delete one'; end if;
    insert into public.chronicle_goals
      (owner, title, scope, anchor, repeat_every, target, unit, note, sort, activity, cat, counts,
       est_mins, priority)
    values (auth.uid(), btrim(p_title), p_scope, p_anchor, p_repeat, p_target,
            nullif(btrim(coalesce(p_unit,'')),''), nullif(btrim(coalesce(p_note,'')),''),
            coalesce(p_sort,0),
            v_act, nullif(btrim(coalesce(p_cat,'')),''), v_counts, v_est, v_pri)
    returning id into v_id;
  else
    update public.chronicle_goals
       set title = btrim(p_title), scope = p_scope, anchor = p_anchor, repeat_every = p_repeat,
           target = p_target, unit = nullif(btrim(coalesce(p_unit,'')),''),
           /**
            * ⚠️ NULL LEAVES THE NOTE ALONE; '' CLEARS IT. This read `note = p_note`, and the room
            * has never sent one — `saveGoal` omits the field entirely — so every edit of a goal
            * said "throw away whatever was written here".
            *
            * ⚠️ IT STOPPED BEING THEORETICAL WHEN THE IMPORT SHIPPED, which is the same story as
            * the colour on an activity. Nothing in the room can write a goal's note, so there was
            * none to lose; chronicle_export carries the column and chronicle_import puts it back,
            * so a restored file is now the one way a goal can HAVE a note — and the next edit was
            * deleting it. The third instance of this shape in two days, after a session's note:
            * an optional field, a caller that does not mention it, and a function that reads
            * silence as erasure.
            */
           note = case when p_note is null then note
                       else nullif(btrim(p_note), '') end,
           sort = coalesce(p_sort, sort), activity = v_act,
           cat = nullif(btrim(coalesce(p_cat,'')),''), counts = v_counts,
           est_mins = v_est, priority = v_pri, updated_at = now()
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such goal'; end if;
  end if;
  return v_id;
end $$;


ALTER FUNCTION "public"."chronicle_goal_save"("p_id" "uuid", "p_title" "text", "p_scope" "text", "p_anchor" "date", "p_repeat" integer, "p_target" numeric, "p_unit" "text", "p_note" "text", "p_sort" integer, "p_activity" "uuid", "p_cat" "text", "p_counts" "text", "p_est" integer, "p_priority" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_goal_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") RETURNS "public"."visibility_tier"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_id is null then raise exception 'which goal'; end if;
  update public.chronicle_goals
     set visibility = least(public.clamp_visibility(auth.uid(), p_tier),
                            'friends'::public.visibility_tier),
         updated_at = now()
   where id = p_id and owner = auth.uid()
   returning visibility into v_tier;
  if v_tier is null then raise exception 'no such goal'; end if;
  return v_tier;
end
$$;


ALTER FUNCTION "public"."chronicle_goal_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_goal_share"("p_id" "uuid", "p_on" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.chronicle_goals
     set shared = coalesce(p_on, false), updated_at = now()
   where id = p_id and owner = auth.uid();
  -- the same message for "not yours" and "not there", so this cannot be used to find out which
  if not found then raise exception 'no such goal'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_goal_share"("p_id" "uuid", "p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_goals_mine"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'title', g.title, 'scope', g.scope, 'anchor', g.anchor,
             'every', g.repeat_every, 'target', g.target, 'unit', g.unit,
             'progress', g.progress, 'done', g.done_at is not null,
             'note', g.note, 'sort', g.sort,
             'activity', g.activity, 'cat', g.cat, 'counts', g.counts,
             'est', g.est_mins, 'priority', g.priority,
             -- whether this one goes on the profile, which only matters on your own page
             'shared', g.shared, 'visibility', g.visibility,
             'at', extract(epoch from g.updated_at) * 1000
           ) order by g.priority desc, g.sort, g.created_at)
      from public.chronicle_goals g where g.owner = auth.uid()
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_goals_mine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_import"("p_doc" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  me uuid := auth.uid();
  x jsonb;
  n_act int := 0; n_ent int := 0; n_goal int := 0; n_rout int := 0; n_plan int := 0;
  refused int := 0;
  total int;
  /* the two ceilings that live in a FUNCTION rather than in a constraint — see the header */
  v_acts int; v_goals int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'not a chronicle file'; end if;
  /* ⚠️ the same question `countBackup` asks of the other backup: is this one of ours at all. A
     file that is not gets a refusal, never a silent import of nothing. */
  if p_doc->>'kind' is distinct from 'chronicle' then raise exception 'not a chronicle file'; end if;
  if coalesce((p_doc->>'version')::int, 0) > 1 then raise exception 'that file is from a newer version'; end if;

  total := coalesce(jsonb_array_length(p_doc->'activities'), 0)
         + coalesce(jsonb_array_length(p_doc->'entries'), 0)
         + coalesce(jsonb_array_length(p_doc->'goals'), 0)
         + coalesce(jsonb_array_length(p_doc->'routines'), 0)
         + coalesce(jsonb_array_length(p_doc->'plans'), 0);
  /* three years of three sittings a day is ~3,300 rows; this is an outer wall, not a target */
  if total > 50000 then raise exception 'that file is too big to put back in one go'; end if;

  /**
   * ⚠️ ADDS, NEVER REPLACES, and `on conflict (id) do nothing` is doing two jobs at once.
   *
   * The first is the promise the Account page already makes about the other backup: putting one
   * back adds what is missing and leaves everything you already have alone. Restoring onto a
   * machine that has been used since must not overwrite the newer thing with the older one.
   *
   * The second is a door. The ids in the file are the ids the rows had, and a file can be edited
   * by anybody — so an import naming a row id that belongs to SOMEBODY ELSE must not write to it.
   * `do nothing` on the primary key means it cannot: the row exists, so the insert is skipped,
   * and the owner of that row is never consulted or changed. There is no code path here that
   * updates an existing row, which is why there is no code path that can update a stranger's.
   *
   * ⚠️ AND `owner` COMES FROM auth.uid(), NEVER FROM THE FILE. The export deliberately leaves it
   * out; this would ignore it if it were there.
   */

  /**
   * ⚠️ ROW BY ROW, INSIDE ITS OWN EXCEPTION BLOCK, which is slower than a set-based insert and is
   * the only honest way to do it. Every one of these tables carries check constraints — a goal's
   * unit must accompany its target, an entry must end after it starts, a category must be one of
   * three words — and a single set-based statement fails ENTIRELY on the first row that breaks
   * one. The alternative is restating those constraints as WHERE clauses up here, which is a
   * second copy of the rules that drifts from the table the moment either changes. So the table
   * stays the one authority, a row it refuses is counted, and the rest still go in.
   *
   * ⚠️ AND THAT GENEROSITY HID A PLAIN BUG FOR AS LONG AS PLANS HAVE EXISTED. The plans insert
   * below listed SEVEN columns and supplied EIGHT values — a `picture` subquery copy-pasted from
   * the entries loop, for a column `chronicle_plans` does not have. Postgres does not plan a
   * statement inside plpgsql until it runs, so the function created cleanly and every plan row
   * raised at runtime, was caught here, and was counted as `skipped`. Nobody has ever restored a
   * plan. A catch-all that turns a code error into a tally is the shape that lets that happen,
   * and the round-trip fixture test is what finally asked the question: 1 plan in, 0 plans back.
   */
  select count(*) into v_acts from public.chronicle_activities where owner = me;
  select count(*) into v_goals from public.chronicle_goals where owner = me;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'activities', '[]'::jsonb)) loop
    begin
      /**
       * ⚠️ THE CEILING chronicle_activity_save KEEPS, kept here too. It is not a CHECK — it
       * counts other rows, which a constraint cannot do — so it was enforced on exactly one way
       * in, and a file was the other. Counted once before the loop and carried, rather than a
       * count(*) per row, which would be quadratic on a large file.
       *
       * ⚠️ REFUSED PER ROW, NOT PER FILE, which is this function's own convention: the rest of
       * the restore still goes in and the refusal is reported back. Failing the whole file would
       * throw away the entries and goals that were never the problem.
       */
      if v_acts >= 200 then refused := refused + 1; continue; end if;
      insert into public.chronicle_activities
        (id, owner, name, cat, colour, archived_at, created_at, auto, metric, session_mins, shared,
         visibility)
      values (
        (x->>'id')::uuid, me, x->>'name', x->>'cat', x->>'colour',
        (x->>'archived_at')::timestamptz,
        coalesce((x->>'created_at')::timestamptz, now()),
        coalesce((x->>'auto')::boolean, false),
        x->>'metric', (x->>'session_mins')::int, (public.chronicle_tier_from_file(x->>'visibility', (x->>'shared')::boolean, me) in ('friends','members','public')),
        /* ⚠️ BOTH ARE PASSED AND THE TRIGGER RECONCILES THEM. An old file carries only `shared`,
           so chronicle_tier_from_file derives the tier from it; a new file carries `visibility`,
           so the tier decides and the trigger rewrites `shared` to match. Passing one and not
           the other would make the answer depend on which file you happened to restore. */
        public.chronicle_tier_from_file(x->>'visibility', (x->>'shared')::boolean, me))
      on conflict (id) do nothing;
      if found then
        n_act := n_act + 1; v_acts := v_acts + 1;
        /* ⚠️ THE LIST IS RE-EARNED, NOT RESTORED. Every name in the file has to still
           be an accepted friend, which is the rule `visibility_certain_set` keeps and
           the reason the file holds usernames rather than ids: a name that has drifted
           out of the friendship is simply dropped, exactly as the picker drops one
           that came from a stale circle. Capped at 50, the same per-item ceiling
           `save_my_profile_blocks` applies -- an unbounded array in a file somebody
           hands you is somebody else's denial-of-service.

           And only when the tier that was actually STORED is `certain`: an older file,
           or one whose tier was clamped on the way in, must not leave a list behind on
           a row that is not at that level. The UPDATE trigger cannot help here --
           this is an INSERT. */
        insert into public.visibility_certain (owner, item_kind, item_id, friend)
        select me, 'chronicle_activity', (x->>'id')::uuid::text, pr.user_id
          from jsonb_array_elements_text(
                 case when jsonb_typeof(x->'certain') = 'array'
                      then x->'certain' else '[]'::jsonb end
               ) with ordinality u(nm, ord)
          join public.profiles pr on lower(pr.username::text) = lower(btrim(u.nm))
         where u.ord <= 50
           and pr.user_id <> me
           and coalesce(public.are_friends(me, pr.user_id), false)
           and public.chronicle_tier_from_file(
                 x->>'visibility', (x->>'shared')::boolean, me) = 'certain'
        on conflict (item_kind, item_id, friend) do nothing;
      else refused := refused + 1; end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'routines', '[]'::jsonb)) loop
    begin
      insert into public.chronicle_routines (id, owner, name, steps, created_at, updated_at)
      values ((x->>'id')::uuid, me, x->>'name', coalesce(x->'steps', '[]'::jsonb),
              coalesce((x->>'created_at')::timestamptz, now()),
              coalesce((x->>'updated_at')::timestamptz, now()))
      on conflict (id) do nothing;
      if found then n_rout := n_rout + 1; else refused := refused + 1; end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  /**
   * ⚠️ EVERYTHING BELOW POINTS AT AN ACTIVITY, and one that is not yours is not a row to import —
   * it is a row to drop. Without this check the foreign key raises, which the block would catch
   * and count, so the difference is only in what the person is told; with it, "skipped" means a
   * row that genuinely could not be put back rather than one naming an activity that was about to
   * be inserted by the loop above. The activities go in FIRST for that reason.
   */
  for x in select * from jsonb_array_elements(coalesce(p_doc->'entries', '[]'::jsonb)) loop
    begin
      /**
       * ⚠️ THE TWO SPAN RULES THE TABLE CANNOT HOLD, restated here and nowhere else.
       *
       * The note above says restating the table's constraints as WHERE clauses up here is a
       * second copy that drifts, and it is right: "an entry must end after it starts" is
       * chronicle_entry_span's job and this loop lets the table refuse it. But a sitting no
       * longer than a day, and one that has not happened yet, are NOT table constraints — they
       * live in chronicle_entry_add and chronicle_entry_edit, and a file was the third write path
       * that kept neither. "You cannot have spent time on a day you have not lived" held
       * everywhere except through ⬆ Put one back.
       *
       * ⚠️ AND NEITHER CAN BECOME A CONSTRAINT. The future one is not immutable, so Postgres will
       * not have it. The 24-hour one could be — and must not be: chronicle_start and
       * chronicle_stop close a forgotten timer with `ended_at = clock_timestamp()`, so a timer
       * left running over a weekend would fail that constraint and lock somebody out of starting
       * anything at all. The loop is the only place either can live.
       *
       * ⚠️ A RUNNING ENTRY HAS NO END, so the duration test is NULL for one and `or` leaves the
       * decision to the other two — which is right, an open sitting has no length yet.
       *
       * Counted as refused like every other row this cannot put back, so the tally the person is
       * shown stays true.
       */
      if not exists (select 1 from public.chronicle_activities a
                      where a.id = (x->>'activity')::uuid and a.owner = me)
         or (x->>'ended_at')::timestamptz - (x->>'started_at')::timestamptz > interval '24 hours'
         or (x->>'started_at')::timestamptz > clock_timestamp() then
        refused := refused + 1;
      else
        insert into public.chronicle_entries
          (id, owner, activity, started_at, ended_at, amount, quality, created_at, picture)
        values (
          (x->>'id')::uuid, me, (x->>'activity')::uuid,
          (x->>'started_at')::timestamptz, (x->>'ended_at')::timestamptz,
          (x->>'amount')::numeric, (x->>'quality')::smallint,
          coalesce((x->>'created_at')::timestamptz, now()),
          (select m.id from public.member_pictures m
            where m.id = nullif(btrim(coalesce(x->>'picture','')),'')::uuid and m.owner = me))
        on conflict (id) do nothing;
        if found then
          n_ent := n_ent + 1;
          /* ⚠️ ONLY FOR A ROW THAT ACTUALLY WENT IN. `found` is false for an entry this file
             re-offers that the account already holds, and hanging its notes on an id that was
             skipped would attach them to the copy already there — doubling a journal on every
             put-back, which is the one thing an import that "adds what is missing" must not do. */
          if nullif(btrim(coalesce(x->>'note','')),'') is not null then
            insert into public.chronicle_notes (owner, entry, at, body)
            values (me, (x->>'id')::uuid,
                    coalesce((x->>'ended_at')::timestamptz, (x->>'started_at')::timestamptz, now()),
                    left(btrim(x->>'note'), 4000));
          end if;
          insert into public.chronicle_notes (owner, entry, at, body)
          select me, (x->>'id')::uuid,
                 coalesce((nt->>'at')::timestamptz, now()),
                 btrim(nt->>'body')
            from jsonb_array_elements(coalesce(x->'notes', '[]'::jsonb)) nt
           where btrim(coalesce(nt->>'body','')) <> ''
             and length(btrim(nt->>'body')) <= 4000;
        else refused := refused + 1; end if;
      end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'goals', '[]'::jsonb)) loop
    begin
      /* ⚠️ the same ceiling story as the activities above — chronicle_goal_save raises at 500 */
      if v_goals >= 500 then refused := refused + 1; continue; end if;
      if x->>'activity' is not null
         and not exists (select 1 from public.chronicle_activities a
                          where a.id = (x->>'activity')::uuid and a.owner = me) then
        refused := refused + 1;
      else
        insert into public.chronicle_goals
          (id, owner, title, scope, anchor, repeat_every, target, unit, progress, done_at,
           note, sort, activity, cat, counts, est_mins, priority, created_at, updated_at,
           shared, visibility)
        values (
          (x->>'id')::uuid, me, x->>'title', x->>'scope', (x->>'anchor')::date,
          (x->>'repeat_every')::int, (x->>'target')::numeric, x->>'unit',
          coalesce((x->>'progress')::numeric, 0), (x->>'done_at')::timestamptz,
          x->>'note', coalesce((x->>'sort')::int, 0), (x->>'activity')::uuid, x->>'cat',
          /**
           * ⚠️ AN AMOUNT NEEDS AN ACTIVITY THAT COUNTS ONE, and the table only knows half of it.
           * `chronicle_goal_amount_needs_one_activity` says counts='amount' needs AN activity;
           * it cannot say that activity must name a metric, and that half lives in
           * chronicle_goal_save. A file was the second way in and kept only the table's half, so
           * ⬆ Put one back could restore a goal counting a quantity its source never records —
           * one that reads 0 for ever with the minutes sitting in the totals above it.
           *
           * ⚠️ CORRECTED, NOT REFUSED, which is what chronicle_goal_save does with the same
           * pairing: the goal is still a goal somebody wrote down, it just measures time instead.
           * Refusing would drop the row out of the file and count it as skipped.
           */
          case when coalesce(x->>'counts', 'minutes') = 'amount'
                    and exists (select 1 from public.chronicle_activities a
                                 where a.id = (x->>'activity')::uuid and a.owner = me
                                   and nullif(btrim(coalesce(a.metric, '')), '') is not null)
               then 'amount' else 'minutes' end, (x->>'est_mins')::int,
          coalesce((x->>'priority')::smallint, 0),
          coalesce((x->>'created_at')::timestamptz, now()),
          coalesce((x->>'updated_at')::timestamptz, now()),
          /* ⚠️ NEITHER OF THESE WAS HERE AND `shared` NEVER HAS BEEN. A goal somebody put on
             their profile came back from every restore unshared, since exports existed. It was
             fail-closed, so nothing leaked; it was a setting silently lost, which is the §8
             shape read backwards — the caller forgot a column and the restore erased it. */
          (public.chronicle_tier_from_file(x->>'visibility', (x->>'shared')::boolean, me) in ('friends','members','public')),
          public.chronicle_tier_from_file(x->>'visibility', (x->>'shared')::boolean, me))
        on conflict (id) do nothing;
        if found then
          n_goal := n_goal + 1; v_goals := v_goals + 1;
          /* the same re-earning as the activities above */
          insert into public.visibility_certain (owner, item_kind, item_id, friend)
          select me, 'chronicle_goal', (x->>'id')::uuid::text, pr.user_id
            from jsonb_array_elements_text(
                   case when jsonb_typeof(x->'certain') = 'array'
                        then x->'certain' else '[]'::jsonb end
                 ) with ordinality u(nm, ord)
            join public.profiles pr on lower(pr.username::text) = lower(btrim(u.nm))
           where u.ord <= 50
             and pr.user_id <> me
             and coalesce(public.are_friends(me, pr.user_id), false)
             and public.chronicle_tier_from_file(
                   x->>'visibility', (x->>'shared')::boolean, me) = 'certain'
          on conflict (item_kind, item_id, friend) do nothing;
        else refused := refused + 1; end if;
      end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'plans', '[]'::jsonb)) loop
    begin
      if not exists (select 1 from public.chronicle_activities a
                      where a.id = (x->>'activity')::uuid and a.owner = me) then
        refused := refused + 1;
      else
        insert into public.chronicle_plans
          (id, owner, activity, starts_at, ends_at, note, created_at)
        values (
          (x->>'id')::uuid, me, (x->>'activity')::uuid,
          (x->>'starts_at')::timestamptz, (x->>'ends_at')::timestamptz, x->>'note',
          coalesce((x->>'created_at')::timestamptz, now()))
        on conflict (id) do nothing;
        if found then n_plan := n_plan + 1; else refused := refused + 1; end if;
      end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  return jsonb_build_object(
    'activities', n_act, 'entries', n_ent, 'goals', n_goal,
    'routines', n_rout, 'plans', n_plan, 'skipped', refused);
end $$;


ALTER FUNCTION "public"."chronicle_import"("p_doc" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_moments"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  v_to   := coalesce(p_to, clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '1 day'), v_to - interval '366 days');
  if v_from >= v_to then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(t order by t.at desc nulls first, t.title)
    from (
      select 'rating'::text                                    as kind,
             r.updated_at                                      as at,
             null::text                                        as "on",
             coalesce(nullif(btrim(m.title), ''), 'Something')  as title,
             r.score,
             m.kind                                            as about,
             null::text                                        as detail
        from public.circuit_ratings r
        left join public.circuit_movies m on m.id = r.movie_id
       where r.user_id = v_me
         and r.updated_at >= v_from
         and r.updated_at <  v_to

      union all

      select 'workout'::text,
             null::timestamptz,
             l.date::text,
             (select string_agg(x.said, ' · ')
                from (
                  select coalesce(nullif(btrim(ex.nm), ''), 'something')
                         || ' ' || trim(to_char((en->>'val')::numeric, 'FM999999990.##'))
                         || coalesce(' ' || nullif(nullif(lower(btrim(ex.un)), ''), 'other'), '') as said
                    from jsonb_array_elements(l.entries) en
                    left join lateral (
                      select e->>'name' as nm, e->>'unit' as un
                        from jsonb_array_elements(p.exercises) e
                       where e->>'id' = en->>'eid'
                       limit 1
                    ) ex on true
                   where jsonb_typeof(l.entries) = 'array'
                     and (en->>'val') ~ '^[0-9.]+$'
                     and (en->>'val')::numeric > 0
                   limit 4
                ) x),
             null::int,
             nullif(btrim(p.name), ''),
             /* how many it held in all, so a row cut at four can say it was cut */
             (select count(*)::text
                from jsonb_array_elements(l.entries) en
               where jsonb_typeof(l.entries) = 'array'
                 and (en->>'val') ~ '^[0-9.]+$'
                 and (en->>'val')::numeric > 0)
        from public.circuit_logs l
        join public.circuit_people p
          on p.id = l.person_id and p.owner_user_id = v_me
       where l.date >= (v_from - interval '1 day')::date
         and l.date <= (v_to + interval '1 day')::date
    ) t
    where t.kind = 'rating' or nullif(btrim(t.title), '') is not null
    limit 400
  ), '[]'::jsonb);
end $_$;


ALTER FUNCTION "public"."chronicle_moments"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_moods"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_to <= p_from then raise exception 'that range ends before it starts'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'that is too long a range'; end if;
  return coalesce((
    select jsonb_object_agg(k, secs / 60.0) from (
      select coalesce(d.quality::text, 'none') as k, sum(d.secs) as secs
        from public.chronicle_spread(p_from, p_to) d
       group by coalesce(d.quality::text, 'none')
    ) q
  ), '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_moods"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_note_add"("p_entry" "uuid", "p_body" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid; v_body text := btrim(coalesce(p_body, '')); v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_body = '' then raise exception 'nothing to write down'; end if;
  if length(v_body) > 4000 then raise exception 'that is longer than a note — 4000 characters'; end if;
  /* ⚠️ the entry has to be YOURS, and this is the check that makes it so — the table is
     deny-all, so without it a note could be hung on anybody's session by id */
  if not exists (select 1 from public.chronicle_entries e
                  where e.id = p_entry and e.owner = auth.uid()) then
    raise exception 'no such session';
  end if;
  /* a ceiling, for the same reason every other list here has one */
  select count(*) into v_n from public.chronicle_notes where entry = p_entry;
  if v_n >= 50 then raise exception 'that is 50 notes on one session'; end if;
  insert into public.chronicle_notes (owner, entry, body)
  values (auth.uid(), p_entry, v_body) returning id into v_id;
  return v_id;
end $$;


ALTER FUNCTION "public"."chronicle_note_add"("p_entry" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_note_drop"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_notes where id = p_id and owner = auth.uid();
end $$;


ALTER FUNCTION "public"."chronicle_note_drop"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_note_edit"("p_id" "uuid", "p_body" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /* ⚠️ EMPTY DELETES IT, which is the one place in this room where that is right: a journal
     entry you have cleared is one you did not mean to write, and leaving a blank row behind
     would be a thing to tidy up later. Everywhere else '' means "clear this field". */
  if v_body = '' then
    delete from public.chronicle_notes where id = p_id and owner = auth.uid();
    return;
  end if;
  if length(v_body) > 4000 then raise exception 'that is longer than a note — 4000 characters'; end if;
  update public.chronicle_notes set body = v_body where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such note'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_note_edit"("p_id" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_plan_did"("p_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_plan public.chronicle_plans;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_plan from public.chronicle_plans where id = p_id and owner = auth.uid();
  if v_plan.id is null then raise exception 'no such plan'; end if;
  return public.chronicle_entry_add(v_plan.activity, v_plan.starts_at, v_plan.ends_at, v_plan.note);
end $$;


ALTER FUNCTION "public"."chronicle_plan_did"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_plan_drop"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_plans where id = p_id and owner = auth.uid();
end $$;


ALTER FUNCTION "public"."chronicle_plan_drop"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_plan_save"("p_id" "uuid", "p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid; v_note text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_to is null or p_from is null or p_to <= p_from then
    raise exception 'that span ends before it starts';
  end if;
  if p_to - p_from > interval '24 hours' then raise exception 'that is more than a day'; end if;
  if not exists (
    select 1 from public.chronicle_activities where id = p_activity and owner = auth.uid()
  ) then raise exception 'no such activity'; end if;

  v_note := left(nullif(btrim(coalesce(p_note, '')), ''), 500);

  if p_id is null then
    -- ⚠️ a ceiling, like the 500 goals. A plan is ~120 bytes, so this is about 600KB a person —
    -- and a planner nobody can fill past is better than a table nobody can bound.
    if (select count(*) from public.chronicle_plans where owner = auth.uid()) >= 5000 then
      raise exception 'that is 5000 plans';
    end if;
    insert into public.chronicle_plans (owner, activity, starts_at, ends_at, note)
    values (auth.uid(), p_activity, p_from, p_to, v_note)
    returning id into v_id;
  else
    update public.chronicle_plans
       set activity = p_activity, starts_at = p_from, ends_at = p_to, note = v_note
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such plan'; end if;
  end if;
  return v_id;
end $$;


ALTER FUNCTION "public"."chronicle_plan_save"("p_id" "uuid", "p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_plans_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_to <= p_from then raise exception 'that range ends before it starts'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'that is too long a range'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'activity', p.activity, 'start', p.starts_at, 'end', p.ends_at,
             'note', p.note
           ) order by p.starts_at)
      from public.chronicle_plans p
     where p.owner = auth.uid()
       and p.starts_at < p_to
       and p.ends_at > p_from
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_plans_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_routine_drop"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_routines where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such routine'; end if;
end $$;


ALTER FUNCTION "public"."chronicle_routine_drop"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_routine_save"("p_id" "uuid", "p_name" "text", "p_steps" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_id uuid; v_count int; v_clean jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then raise exception 'steps must be a list'; end if;
  if jsonb_array_length(p_steps) > 40 then raise exception 'that is more than forty steps'; end if;

  /**
   * ⚠️ EVERY STEP'S ACTIVITY IS CHECKED AGAINST THE CALLER'S OWN, and a step naming anybody
   * else's is dropped rather than stored. A routine is a list of ids somebody can type, so
   * trusting it would let a request point a routine at another member's activity — and a tap on
   * that step would then try to start it. The join does the filtering; nothing is raised, because
   * a routine missing a step is still a routine and refusing the whole save would be worse.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'activity', a.id,
           'mins', case when (s->>'mins') ~ '^[0-9]+$' then least((s->>'mins')::int, 600) else null end
         ) order by s.ord), '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(p_steps) with ordinality s(s, ord)
    join public.chronicle_activities a
      on a.id = (s->>'activity')::uuid and a.owner = auth.uid();

  if p_id is null then
    select count(*) into v_count from public.chronicle_routines where owner = auth.uid();
    if v_count >= 40 then raise exception 'that is forty routines — delete one'; end if;
    insert into public.chronicle_routines (owner, name, steps)
    values (auth.uid(), btrim(p_name), v_clean) returning id into v_id;
  else
    update public.chronicle_routines
       set name = btrim(p_name), steps = v_clean, updated_at = now()
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'no such routine'; end if;
  end if;
  return v_id;
end $_$;


ALTER FUNCTION "public"."chronicle_routine_save"("p_id" "uuid", "p_name" "text", "p_steps" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_routines_mine"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'steps', r.steps) order by r.name)
      from public.chronicle_routines r where r.owner = auth.uid()
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_routines_mine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_running_fix"("p_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_activity" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  /**
   * ⚠️ THE SESSION YOU ARE IN THE MIDDLE OF, which until now could not be corrected at all. The
   * editor in the room needs both ends of a span, so it was offered only on finished ones — a
   * mechanical reason rather than a principled one, and the cost was that the two mistakes you
   * notice WHILE WORKING both had the same remedy: press Stop. That ends the session at a moment
   * you did not choose and leaves you starting a second one, which is a worse record of the day
   * than the one you were trying to fix.
   *
   * Pressing Start on the wrong activity, and pressing it twenty minutes after you actually
   * began, are the two. This takes either, or both.
   *
   * ⚠️ NO `p_to`. The one open entry is open BECAUSE it has no end; typing one in is what Stop is
   * for, and a function that could close it would be a second way to do the thing the room
   * already has a button for — with none of Stop's own rules about notes and short sittings.
   */
  select id into v_id
    from public.chronicle_entries
   where owner = auth.uid() and ended_at is null;
  if v_id is null then raise exception 'nothing is running'; end if;

  /**
   * ⚠️ NULL LEAVES EACH ONE ALONE, the rule every save path in this module now keeps: silence
   * means "I am not talking about this", never "throw it away".
   */
  if p_from is not null then
    -- a session cannot have begun in the future, and the ones the room can show begin today or
    -- yesterday; a day is the same ceiling chronicle_entry_edit puts on a finished span
    if p_from > clock_timestamp() then raise exception 'that is in the future'; end if;
    if clock_timestamp() - p_from > interval '24 hours' then raise exception 'that is more than a day ago'; end if;
  end if;

  /**
   * ⚠️ AND THE ACTIVITY IS CHECKED AGAINST THE CALLER, not against the entry — a uuid naming
   * somebody else's activity is a real row the foreign key would accept, which would leave this
   * person's session pointing into another member's list and their minutes in that member's
   * totals. The same check chronicle_entry_edit makes.
   */
  if p_activity is not null
     and not exists (select 1 from public.chronicle_activities a
                      where a.id = p_activity and a.owner = auth.uid()) then
    raise exception 'that is not one of your activities';
  end if;

  update public.chronicle_entries
     set started_at = coalesce(p_from, started_at),
         activity = coalesce(p_activity, activity)
   where id = v_id;
end $$;


ALTER FUNCTION "public"."chronicle_running_fix"("p_from" timestamp with time zone, "p_activity" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_share_timeline"("p_on" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me  uuid := auth.uid();
  v_id  uuid;
  v_pos int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  select id into v_id
    from public.profile_blocks
   where user_id = v_me and block_type = 'chronicle'
   order by position
   limit 1;

  if v_id is null then
    /* No card yet. Switching OFF without one is already the answer, so nothing is created --
       otherwise a toggle you never turned on would leave a card on your page. */
    if not coalesce(p_on, false) then return false; end if;
    select coalesce(max(position), 0) + 1 into v_pos
      from public.profile_blocks where user_id = v_me;
    /* ⚠️ 'friends', AND THE EDITOR WILL NOT OFFER 'public' FOR THIS TYPE EITHER. A timeline is
       friends-only wherever it is switched on, and a card created by this switch must not start
       wider than the thing it is being created to carry. */
    insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
    values (v_me, 'chronicle', v_pos, 'medium', '{"timeline": true}'::jsonb, 'friends');
    return true;
  end if;

  update public.profile_blocks
     set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('timeline', coalesce(p_on, false))
   where id = v_id and user_id = v_me;

  return coalesce(p_on, false);
end $$;


ALTER FUNCTION "public"."chronicle_share_timeline"("p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_shares_timeline"("p_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.profile_blocks b
     where b.user_id = p_owner
       and b.block_type = 'chronicle'
       and coalesce((b.config->>'timeline')::boolean, false)
       and public.can_see_item(p_owner, b.visibility, 'profile_block', b.id::text));
$$;


ALTER FUNCTION "public"."chronicle_shares_timeline"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_sharing_mine"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select jsonb_build_object(
    /* THE TICK, NOT THE REACH -- see `timelineReaches` below for whether it arrives anywhere */
    'timeline', public.chronicle_shares_timeline(auth.uid()),
    'hasCard', exists (select 1 from public.profile_blocks
                        where user_id = auth.uid() and block_type = 'chronicle'),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'cat', a.cat,
                                          'colour', a.colour, 'shared', a.shared,
                                          'reaches', public.item_reaches_anyone(
                                            auth.uid(), a.visibility,
                                            'chronicle_activity', a.id::text),
                                          'visibility', a.visibility)
                       order by public.item_reaches_anyone(
                                  auth.uid(), a.visibility,
                                  'chronicle_activity', a.id::text) desc,
                                a.name)
        from public.chronicle_activities a
       where a.owner = auth.uid() and a.archived_at is null), '[]'::jsonb),
    /* the SECOND switch -- a block asking for goals, which is not the timeline's */
    'wantsGoals', exists (select 1 from public.profile_blocks
                            where user_id = auth.uid() and block_type = 'chronicle'
                              and coalesce((config->>'goals')::boolean, false)),
    /* whether the card carrying each switch reaches anybody at all. `item_reaches_anyone`, never
       `can_see_item`: the owner is asking about themselves and can always see their own block. */
    'timelineReaches', exists (select 1 from public.profile_blocks b
                                where b.user_id = auth.uid() and b.block_type = 'chronicle'
                                  and coalesce((b.config->>'timeline')::boolean, false)
                                  and public.item_reaches_anyone(
                                        auth.uid(), b.visibility,
                                        'profile_block', b.id::text)),
    'goalsReach', exists (select 1 from public.profile_blocks b
                           where b.user_id = auth.uid() and b.block_type = 'chronicle'
                             and coalesce((b.config->>'goals')::boolean, false)
                             and public.item_reaches_anyone(
                                   auth.uid(), b.visibility,
                                   'profile_block', b.id::text)),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title,
                                          'done', g.done_at is not null,
                                          'shared', g.shared,
                                          'reaches', public.item_reaches_anyone(
                                            auth.uid(), g.visibility,
                                            'chronicle_goal', g.id::text),
                                          'visibility', g.visibility)
                       order by public.item_reaches_anyone(
                                  auth.uid(), g.visibility,
                                  'chronicle_goal', g.id::text) desc,
                                g.priority desc, g.sort, g.title)
        from public.chronicle_goals g
       where g.owner = auth.uid()), '[]'::jsonb))
  where auth.uid() is not null;
$$;


ALTER FUNCTION "public"."chronicle_sharing_mine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_since"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select min(e.started_at) from public.chronicle_entries e where e.owner = auth.uid();
$$;


ALTER FUNCTION "public"."chronicle_since"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_spans"("p_asks" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare out_j jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_asks is null or jsonb_typeof(p_asks) <> 'array' then return out_j; end if;
  -- a hundred and twenty years is more than anybody will ask for, and it is still bounded
  if jsonb_array_length(p_asks) > 120 then raise exception 'too many at once'; end if;

  with ask as (
    select x->>'key' as k, (x->>'from')::timestamptz as f, (x->>'to')::timestamptz as t
      from jsonb_array_elements(p_asks) x
  )
  select coalesce(jsonb_object_agg(z.k, z.cats), '{}'::jsonb) into out_j
  from (
    select a.k,
           coalesce(jsonb_object_agg(s.cat, s.mins) filter (where s.cat is not null), '{}'::jsonb) as cats
      from ask a
      -- one indexed range scan per ask, on chronicle_entries_owner_started
      left join lateral (
        select ac.cat,
               round(sum(greatest(0, extract(epoch from (
                 least(coalesce(e.ended_at, clock_timestamp()), a.t)
                 - greatest(e.started_at, a.f))))) / 60.0) as mins
          from public.chronicle_entries e
          join public.chronicle_activities ac on ac.id = e.activity and ac.owner = auth.uid()
         where e.owner = auth.uid()
           and e.started_at < a.t
           and coalesce(e.ended_at, clock_timestamp()) > a.f
         group by ac.cat
         having sum(greatest(0, extract(epoch from (
                  least(coalesce(e.ended_at, clock_timestamp()), a.t)
                  - greatest(e.started_at, a.f))))) / 60.0 >= 1
      ) s on true
     group by a.k
  ) z;
  return out_j;
end $$;


ALTER FUNCTION "public"."chronicle_spans"("p_asks" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_spread"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS TABLE("activity" "uuid", "quality" smallint, "secs" numeric, "amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select e.activity,
         e.quality,
         sum(greatest(0, extract(epoch from (
           least(coalesce(e.ended_at, clock_timestamp()), p_to) - greatest(e.started_at, p_from)
         )))),
         -- the quantity belongs to the session, by where it began — see chronicle_sum's note
         sum(e.amount) filter (where e.started_at >= p_from and e.started_at < p_to)
    from public.chronicle_entries e
   where e.owner = auth.uid()
     and e.started_at < p_to
     and coalesce(e.ended_at, clock_timestamp()) > p_from
   group by e.activity, e.quality
$$;


ALTER FUNCTION "public"."chronicle_spread"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_start"("p_activity" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.chronicle_activities
                  where id = p_activity and owner = auth.uid() and archived_at is null) then
    raise exception 'no such activity';
  end if;
  update public.chronicle_entries set ended_at = clock_timestamp()
   where owner = auth.uid() and ended_at is null
     and clock_timestamp() - started_at >= interval '1 second';
  delete from public.chronicle_entries where owner = auth.uid() and ended_at is null;
  insert into public.chronicle_entries (owner, activity, started_at)
  values (auth.uid(), p_activity, clock_timestamp()) returning id into v_id;
  return v_id;
end $$;


ALTER FUNCTION "public"."chronicle_start"("p_activity" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_stop"("p_note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_closed uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.chronicle_entries
     set ended_at = clock_timestamp()
   where owner = auth.uid() and ended_at is null
     and clock_timestamp() - started_at >= interval '1 second'
  returning id into v_closed;
  /* ⚠️ only onto the sitting that actually closed. The update takes no row for a timer under a
     second — that one is deleted on the next line — so a note sent with it has nothing to
     attach to, and inventing a row to hold it would record a sitting nobody sat. */
  if v_closed is not null and nullif(btrim(coalesce(p_note,'')),'') is not null then
    insert into public.chronicle_notes (owner, entry, body)
    values (auth.uid(), v_closed, left(btrim(p_note), 4000));
  end if;
  delete from public.chronicle_entries where owner = auth.uid() and ended_at is null;
end $$;


ALTER FUNCTION "public"."chronicle_stop"("p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_sum"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_activity" "uuid", "p_cat" "text", "p_what" "text") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case when p_what = 'amount' then
    coalesce((
      select sum(e.amount)
        from public.chronicle_entries e
        join public.chronicle_activities a on a.id = e.activity and a.owner = auth.uid()
       where e.owner = auth.uid()
         and e.amount is not null
         and (p_activity is null or e.activity = p_activity)
         and (p_cat is null or a.cat = p_cat)
         -- the session it belongs to, by where it began — see the note above
         and e.started_at >= p_from and e.started_at < p_to
    ), 0)
  else
    coalesce((
      select sum(greatest(0, extract(epoch from (
               least(coalesce(e.ended_at, clock_timestamp()), p_to)
               - greatest(e.started_at, p_from)
             )))) / 60.0
        from public.chronicle_entries e
        join public.chronicle_activities a on a.id = e.activity and a.owner = auth.uid()
       where e.owner = auth.uid()
         and (p_activity is null or e.activity = p_activity)
         and (p_cat is null or a.cat = p_cat)
         and e.started_at < p_to
         and coalesce(e.ended_at, clock_timestamp()) > p_from
    ), 0)
  end;
$$;


ALTER FUNCTION "public"."chronicle_sum"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_activity" "uuid", "p_cat" "text", "p_what" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_tally"("p_asks" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare out_j jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_asks is null or jsonb_typeof(p_asks) <> 'array' then return out_j; end if;
  -- ⚠️ raised from 200: thirty windows for each of a few goals is a bigger list than one window
  -- each, and a streak is the whole reason the batch exists. Still bounded.
  if jsonb_array_length(p_asks) > 1200 then raise exception 'too many at once'; end if;

  with ask as (
    select coalesce(x->>'key', x->>'id') as k,
           (x->>'id')::uuid as gid,
           (x->>'from')::timestamptz as f,
           (x->>'to')::timestamptz as t
      from jsonb_array_elements(p_asks) x
  ),
  -- ⚠️ WHAT TO COUNT COMES OFF THE GOAL'S OWN ROW, never off the ask. A caller that could name an
  -- activity could name somebody else's. A goal with neither source is not answered at all, which
  -- is a different claim from answering 0 about it.
  g as (
    select gl.id, gl.counts, gl.activity, gl.cat
      from public.chronicle_goals gl
     where gl.owner = auth.uid()
       and gl.id in (select gid from ask)
       and (gl.activity is not null or gl.cat is not null)
  ),
  /**
   * ⚠️ ONE PASS PER GOAL INSTEAD OF ONE PER WINDOW, and the lower bound is the whole point.
   *
   * The previous shape joined the entries to every ask, and its only lower bound was the ask's own
   * `coalesce(ended_at, now) > from` — which no index can serve. So each of the ~190 windows a
   * streak asks for considered EVERY entry the person had ever made: the cost grew with the
   * product of how long they have used the site and how far back a streak looks. Measured over a
   * synthetic three years (3,293 entries, 192 asks): 656ms, against 14.8ms for this.
   *
   * Every window a goal is asked about sits inside [min(from), max(to)) across its own asks, so
   * bounding the candidates by that span once is lossless — and `started_at < t1` can use
   * chronicle_entries_owner_started. MATERIALIZED is load-bearing: inlined, the planner is free to
   * push the per-ask join back down and re-derive this for each window, which is the cost being
   * removed.
   *
   * ⚠️ AND THE LOWER BOUND ASKS WHETHER THE ENTRY HAD ENDED, NOT WHERE IT STARTED. A sitting that
   * began before the span and ended inside it belongs to it. Asking `started_at >= f0` instead is
   * wrong by whole hours, and a differential sweep of eight random rounds did not notice — because
   * it hung a life-scope window on every goal, which drags min(from) back to the epoch and makes
   * any lower bound a no-op. The honest version gives the life window a goal of its own, and then
   * the mistake is 3,068–4,106 minutes across ~22 keys. See docs/2026-10-13-chronicle-tally-span.sql
   */
  span as (select gid, min(f) as f0, max(t) as t1 from ask group by gid),
  ent as materialized (
    select s.gid, e.id, e.started_at, e.ended_at, e.amount
      from span s
      join g on g.id = s.gid
      join public.chronicle_entries e
        on e.owner = auth.uid()
       and e.started_at < s.t1
       and coalesce(e.ended_at, clock_timestamp()) > s.f0
       and (g.activity is null or e.activity = g.activity)
       -- ⚠️ EXISTS rather than a join, so a category covering five activities cannot multiply the
       -- entry rows it matches — which is exactly how the first attempt went 80x wrong
       and (g.cat is null or exists (
             select 1 from public.chronicle_activities ac
              where ac.id = e.activity and ac.owner = auth.uid() and ac.cat = g.cat))
  )
  select coalesce(jsonb_object_agg(z.k, z.total), '{}'::jsonb) into out_j from (
    select a.k,
           coalesce(sum(
             -- ⚠️ FIRST, AND NOT A TIDY-UP: greatest/least IGNORE NULLs, so a no-match row would
             -- otherwise compute a whole window — 1440 minutes where the answer is 0
             case when en.id is null then 0
                  when g.counts = 'amount'
                  -- the quantity belongs to the session, by where it began
                  then case when en.started_at >= a.f and en.started_at < a.t
                            then coalesce(en.amount, 0) else 0 end
                  else greatest(0, extract(epoch from (
                         least(coalesce(en.ended_at, clock_timestamp()), a.t)
                         - greatest(en.started_at, a.f)))) / 60.0
             end), 0) as total
      from ask a
      join g on g.id = a.gid
      left join ent en
        on en.gid = a.gid
       and en.started_at < a.t
       and coalesce(en.ended_at, clock_timestamp()) > a.f
     group by a.k
  ) z;
  return out_j;
end $$;


ALTER FUNCTION "public"."chronicle_tally"("p_asks" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_tier_from_file"("p_vis" "text", "p_shared" boolean, "p_owner" "uuid") RETURNS "public"."visibility_tier"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  /* What a restored row's tier should be, from whatever the file happens to carry.

     ⚠️ TOLERANT OF AN OLD FILE AND OF A FUTURE ONE. A file written before the tier existed has
     only `shared`, so the boolean decides; one written after has `visibility`, so the tier does.
     A value this database does not recognise -- a level added later, a typo, a hand-edited file --
     falls back to the boolean rather than refusing the row, which is this function's own
     convention everywhere else: correct what can be corrected, refuse only what cannot be put
     back at all.

     ⚠️ CLAMPED TWICE, DELIBERATELY. Once by the owner's ceiling, because a file is a write path
     and every write path has to respect it -- a restore is exactly how a level chosen under an
     older, wider ceiling would otherwise come back. And once at `friends`, because a
     sitting-by-sitting timeline is friends-only and the chronicle tables cap there. Without the
     second clamp a file saying `members` would be refused by the CHECK and the whole row lost;
     with it the row comes back at the widest level it is allowed to have. */
  select least(
    public.clamp_visibility(
      p_owner,
      case when p_vis in ('private','certain','friends','members','public')
           then p_vis::public.visibility_tier
           else (case when coalesce(p_shared, false) then 'friends' else 'private' end)::public.visibility_tier
      end),
    'friends'::public.visibility_tier);
$$;


ALTER FUNCTION "public"."chronicle_tier_from_file"("p_vis" "text", "p_shared" boolean, "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_tier_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* Whichever side the caller moved decides the other. On insert, a visibility that is not the
     default is taken as the intent; otherwise the boolean is. Written this way so that none of
     the eleven functions that read or write `shared` has to change: the database keeps the two
     in step, rather than eleven call sites each remembering to. */
  if tg_op = 'INSERT' then
    if new.visibility is distinct from 'private'::public.visibility_tier then
      new.shared := new.visibility in ('friends','members','public');
    else
      new.visibility := (case when new.shared then 'friends' else 'private' end)::public.visibility_tier;
    end if;
  else
    if new.visibility is distinct from old.visibility then
      new.shared := new.visibility in ('friends','members','public');
    elsif new.shared is distinct from old.shared then
      new.visibility := (case when new.shared then 'friends' else 'private' end)::public.visibility_tier;
    end if;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."chronicle_tier_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_totals"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_to <= p_from then raise exception 'that range ends before it starts'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'that is too long a range'; end if;
  return coalesce((
    /**
     * ⚠️ `colour` IS HERE BECAUSE THE ROW IS THE ACTIVITY'S OWN FACTS, not because one view wants
     * it. The row already carries name, cat, auto and metric for exactly that reason, and the
     * colour is the same kind of thing — a property of the activity that every reader of a total
     * may want to draw. Looking's bars are the third and last place an activity is named on
     * screen; the other two had the dot already, and a feature that appears in two of three places
     * is the "half exists" the nav places file was written about.
     *
     * ⚠️ AND IT IS A NEW KEY ON A jsonb RETURN, which is why it needed no drop and breaks nothing.
     * This function returns a document rather than a table, so the signature is unchanged and the
     * bundle somebody has open right now receives one extra key and ignores it.
     */
    select jsonb_agg(jsonb_build_object(
             'activity', a.id, 'name', a.name, 'cat', a.cat, 'auto', a.auto, 'metric', a.metric,
             'colour', a.colour,
             'mins', coalesce(s.secs, 0) / 60.0,
             -- ⚠️ only when there is a metric to total: a zero beside no unit reads as a bug
             'amount', case when a.metric is null then null else coalesce(s.amount, 0) end
           ) order by coalesce(s.secs, 0) desc, a.name)
      from public.chronicle_activities a
      -- ⚠️ LEFT JOIN, so an activity with no time in the window still appears with 0. The room
      -- filters those out itself; the Activities fold relies on every activity being listed.
      left join (
        select d.activity, sum(d.secs) as secs, sum(d.amount) as amount
          from public.chronicle_spread(p_from, p_to) d
         group by d.activity
      ) s on s.activity = a.id
     where a.owner = auth.uid()
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."chronicle_totals"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chronicle_visit"("p_module" "text", "p_seconds" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_name text := btrim(coalesce(p_module, ''));
  v_act  uuid;
  v_arch timestamptz;
  v_last uuid;
  v_secs int := least(greatest(coalesce(p_seconds, 0), 30), 600);
  v_now  timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_name = '' or char_length(v_name) > 40 then raise exception 'which module?'; end if;

  /**
   * ⚠️ THE ARCHIVED ONE IS STILL FOUND, AND THEN NOTHING IS WRITTEN. Looking it up with
   * `archived_at is null` would be worse than leaving this alone: the row would not be found, the
   * insert below would make a SECOND activity of the same name, and somebody who put one away
   * would get a fresh one every time they opened the room.
   *
   * ⚠️ AND ARCHIVING IT IS THE ONLY CONTROL ANYBODY HAS OVER IT. This activity is not created by
   * a person — the room makes it the first time they are seen in a module — so Archive is the one
   * lever, and it did nothing: minutes kept arriving against something they had put away, every
   * day, with no way to stop them. A control that looks like it does something and does not is
   * the thing this room is most careful about elsewhere. Bring it back and recording resumes.
   */
  select id, archived_at into v_act, v_arch
    from public.chronicle_activities
   where owner = auth.uid() and auto and name = v_name;
  if v_act is not null and v_arch is not null then return; end if;

  if v_act is null then
    insert into public.chronicle_activities (owner, name, cat, auto)
    values (auth.uid(), v_name, 'free', true)
    returning id into v_act;
  end if;

  /**
   * ⚠️ AND A SITTING THAT HAS RUN A DAY IS ENDED RATHER THAN EXTENDED AGAIN. This branch moves
   * `ended_at` to now whenever the last one finished within three minutes, which is what makes a
   * visit a sitting rather than a thousand scraps — and it had no ceiling at all. A tab left
   * visible on a desk grows ONE row for as long as it is open. Measured: a sitting at 23h59m30s
   * came out of the next beat at 24h00m30s, in one row, and would have kept going.
   *
   * ⚠️ AND THE BOUND IS ON A SPAN SOMEBODY ASSERTS, NEVER ON ONE THE CLOCK MEASURED — which is
   * the correction to what this comment first said. Ten functions write to chronicle_entries.
   * The day rule belongs to the three that are TOLD a span — chronicle_entry_add,
   * chronicle_entry_edit and chronicle_import — and to this one, which makes up its own out of
   * p_seconds and a three-minute window.
   *
   * The two that MEASURE a span cannot keep it and must not. chronicle_start and chronicle_stop
   * close a timer with `ended_at = clock_timestamp()`, so a timer left running for thirty hours
   * genuinely IS a thirty-hour sitting; refusing it would throw away what somebody actually did,
   * and a CHECK constraint spelling the rule onto the table would make closing that timer fail —
   * and chronicle_start closes the old sitting before opening a new one, so it would stop them
   * starting anything at all.
   * Past the day it starts a fresh sitting instead, which is also what somebody reading their own
   * week would expect to see.
   */
  select id into v_last from public.chronicle_entries
   where owner = auth.uid() and activity = v_act and ended_at is not null
     and ended_at > v_now - interval '3 minutes'
     and started_at > v_now - interval '24 hours'
   order by ended_at desc limit 1;

  if v_last is not null then
    update public.chronicle_entries set ended_at = v_now where id = v_last;
  else
    insert into public.chronicle_entries (owner, activity, started_at, ended_at)
    values (auth.uid(), v_act, v_now - make_interval(secs => v_secs), v_now);
  end if;
end $$;


ALTER FUNCTION "public"."chronicle_visit"("p_module" "text", "p_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_can_edit_person"("p_person" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.is_admin()
    or exists (select 1 from circuit_people cp
               where cp.id = p_person and cp.owner_user_id = auth.uid());
$$;


ALTER FUNCTION "public"."circuit_can_edit_person"("p_person" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_can_see_log"("p_log" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.circuit_can_see_person((select person_id from circuit_logs where id = p_log));
$$;


ALTER FUNCTION "public"."circuit_can_see_log"("p_log" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_can_see_person"("p_person" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
      select 1 from circuit_people cp
      where cp.id = p_person
        and public.can_see_item(cp.owner_user_id, cp.visibility, 'circuit_person', cp.id))
    or exists (
      select 1 from circuit_person_groups pg
      join circuit_group_members gm on gm.group_id = pg.group_id
      where pg.person_id = p_person and gm.user_id = auth.uid());
$$;


ALTER FUNCTION "public"."circuit_can_see_person"("p_person" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_default_group"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* only reachable from circuit_watchlist now -- the circuit_movies trigger is dropped above.
     The table name is checked first so `new.pool_id` is never evaluated on a table without it. */
  if tg_table_name = 'circuit_watchlist' and new.pool_id is not null then
    return new;
  end if;
  if new.group_id is null then
    new.group_id := (select group_id from public.circuit_group_members
                      where user_id = auth.uid() limit 1);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."circuit_default_group"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_group_is_public"("p_group" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select p_group is not null
     and exists (select 1 from public.circuit_person_groups cpg where cpg.group_id = p_group)
     and not exists (
       select 1
         from public.circuit_person_groups cpg
         join public.circuit_people cp on cp.id = cpg.person_id
        where cpg.group_id = p_group
          and least(cp.visibility, public.visibility_ceiling(cp.owner_user_id)) is distinct from 'public');
$$;


ALTER FUNCTION "public"."circuit_group_is_public"("p_group" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."circuit_group_is_public"("p_group" "uuid") IS 'Whether a whole circuit group may be shown to signed-out visitors: it has people, and EVERY one of them is public. A group is the unit of privacy for its films and its watchlist -- those belong to the group, not to whichever member happened to rate or vote on them. Deliberately a rule that can become true rather than a flat refusal: make every person in a group public and its board follows.';



CREATE OR REPLACE FUNCTION "public"."circuit_is_member"("p_group" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  /* ⚠️ THE WIDEST OF THE THREE BYPASSES, AND THE ONE NOBODY NAMED. This used to begin
     `public.is_admin() or`, which made the site owner a member of every circuit group -- and it
     feeds 2 functions and 12 POLICIES (circuit_groups, circuit_group_members, circuit_movies
     select/insert/update/delete, circuit_person_groups, circuit_watchlist select/insert/update/
     delete, plus movie_visible and pool_item_visible). Grepping for `is_admin` finds this
     function; it does not find the twelve policies that lean on it.

     Group MANAGEMENT keeps its own bypasses, deliberately: rename_circuit, delete_circuit and
     circuit_can_edit_person are still admin-capable. What goes is reading and editing the
     contents of a group you are not in. */
  select exists (
    select 1 from circuit_group_members gm
    where gm.group_id = p_group and gm.user_id = auth.uid());
$$;


ALTER FUNCTION "public"."circuit_is_member"("p_group" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_log_picture"("p_log" "text", "p_picture" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.circuit_logs l
                   join public.circuit_people cp on cp.id = l.person_id
                  where l.id = p_log and cp.owner_user_id = auth.uid()) then
    raise exception 'no such workout';
  end if;
  if p_picture is not null and not exists (
       select 1 from public.member_pictures m
        where m.id = p_picture and m.owner = auth.uid() and m.ready) then
    raise exception 'no such picture';
  end if;
  update public.circuit_logs set picture = p_picture where id = p_log;
end $$;


ALTER FUNCTION "public"."circuit_log_picture"("p_log" "text", "p_picture" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_movie_stamp_creator"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* stamped on INSERT and pinned on UPDATE -- editing a title must not be a way to take
     ownership of somebody else's film, the same rule watchlist_stamp_adder keeps */
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."circuit_movie_stamp_creator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_person_tier_clamp"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* The clamp lives on the TABLE because `set_person_visibility` is not the only way in:
     `authenticated` holds INSERT and UPDATE on circuit_people, column `visibility` included, so
     a hand-sent PATCH writes the tier directly and never meets the RPC. Measured before this
     existed: through the RPC, asking for `public` stored `members`; a direct UPDATE stored
     `public` on an account whose ceiling is `members`.

     SECURITY DEFINER is required rather than tidy. A plain trigger function runs as the CALLING
     role, and `clamp_visibility` is deliberately revoked from `authenticated` (visibility-guards
     check A asserts it), so an invoker-rights trigger would fail with "permission denied for
     function clamp_visibility" on every member write. */
  new.visibility := public.clamp_visibility(new.owner_user_id, new.visibility);
  return new;
end $$;


ALTER FUNCTION "public"."circuit_person_tier_clamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_public"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  /* ⚠️ `visibility = 'public'` became a clamp here too -- this is the signed-out Circuit board,
     so a person marked public by somebody who may no longer choose public would otherwise keep
     their name, their workouts and their ratings on the open web. */
  with pub as (
    select id, owner_user_id from circuit_people
     where least(visibility, public.visibility_ceiling(owner_user_id)) = 'public'
  ),
  /* ⚠️ THE GROUP IS THE UNIT OF PRIVACY, NOT THE PERSON WHO TOUCHED THE ROW. Films and watchlist
     rows used to reach this board whenever a PUBLIC person rated or voted on them -- so one
     member opting in published the whole catalogue of every private group they belong to. The
     Crew is eight people and one of them is public; its 163 films are the other seven's too. */
  pubgroups as (
    select g.id from circuit_groups g where public.circuit_group_is_public(g.id)
  )
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'color', p.color, 'goal', p.goal,
        'exercises', p.exercises, 'colLabels', p.col_labels) order by p.name)
      from circuit_people p where p.id in (select id from pub)), '[]'::jsonb),

    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'personId', l.person_id, 'date', l.date, 'entries', l.entries, 'img', l.img))
      from circuit_logs l where l.person_id in (select id from pub)), '[]'::jsonb),

    'movies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'kind', m.kind, 'date', m.date, 'rt', m.rt,
        'ratings',
          -- the legacy blob, filtered to public people …
          coalesce((
            select jsonb_object_agg(k, m.ratings->k)
            from jsonb_object_keys(m.ratings) k
            where k in (select id from pub)), '{}'::jsonb)
          ||
          -- … with today's rows laid over it, mapped from account back to person id
          coalesce((
            select jsonb_object_agg(p.id, jsonb_build_object('score', r.score))
            from circuit_ratings r
            join pub p on p.owner_user_id = r.user_id
            where r.movie_id = m.id), '{}'::jsonb)
      ))
      from circuit_movies m
      where m.group_id in (select id from pubgroups)
    ), '[]'::jsonb),

    'watchlist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'kind', w.kind, 'rt', w.rt))
      from circuit_watchlist w
      where w.group_id in (select id from pubgroups)
    ), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."circuit_public"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."circuit_rating_picture"("p_movie" "text", "p_picture" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.circuit_ratings r
                  where r.movie_id = p_movie and r.user_id = auth.uid()) then
    raise exception 'no such rating';
  end if;
  if p_picture is not null and not exists (
       select 1 from public.member_pictures m
        where m.id = p_picture and m.owner = auth.uid() and m.ready) then
    raise exception 'no such picture';
  end if;
  update public.circuit_ratings set picture = p_picture
   where movie_id = p_movie and user_id = auth.uid();
end $$;


ALTER FUNCTION "public"."circuit_rating_picture"("p_movie" "text", "p_picture" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_my_reserved_snake_name"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.player_registry r
     set user_id = auth.uid()
    from public.profiles p
   where p.user_id = auth.uid()
     and r.user_id is null
     and lower(r.player_name::text) = lower(p.username::text)
  returning r.player_name::text into v_name;
  return v_name;
end;
$$;


ALTER FUNCTION "public"."claim_my_reserved_snake_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_person"("p_person_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update circuit_people set owner_user_id = auth.uid()
   where id = p_person_id and owner_user_id is null
     and exists (select 1 from circuit_person_groups pg
                 join circuit_group_members gm on gm.group_id = pg.group_id
                 where pg.person_id = p_person_id and gm.user_id = auth.uid());
  if not found then raise exception 'cannot claim this person'; end if;
end $$;


ALTER FUNCTION "public"."claim_person"("p_person_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_snake_name"("p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id     bigint;
  v_owner  uuid;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Which handle?';
  end if;

  -- exact registry name first (the original path, unchanged)
  select id, user_id into v_id, v_owner
    from public.player_registry
   where lower(player_name::text) = lower(p_name);

  -- else the name as it RENDERS on the board. Ambiguity is possible in principle (two handles
  -- whose board rows share a name), and silently picking one could hand over the wrong person's
  -- scores — so refuse and let the operator link it instead.
  if v_id is null then
    if (select count(distinct l.player_id) from public.leaderboard l
         where lower(l.player_name) = lower(p_name) and l.player_id is not null) > 1 then
      raise exception 'That handle is ambiguous — ask Evan to link it for you.';
    end if;
    select r.id, r.user_id into v_id, v_owner
      from public.leaderboard l
      join public.player_registry r on r.id = l.player_id
     where lower(l.player_name) = lower(p_name)
     limit 1;
  end if;

  if v_id is null then
    raise exception 'No such handle on the leaderboard.';
  end if;

  -- already yours: succeed quietly rather than erroring, so a double tap is not a failure
  if v_owner = auth.uid() then
    return;
  end if;

  if v_owner is not null then
    raise exception 'That handle is already claimed.';
  end if;

  select count(*) into v_recent
    from public.player_registry
   where user_id = auth.uid()
     and claimed_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'That is a lot of handles at once — try again in an hour.';
  end if;

  update public.player_registry
     set user_id = auth.uid(), claimed_at = now()
   where id = v_id
     and user_id is null;  -- ⚠️ re-checked in the UPDATE: two people claiming the same free
                           -- handle at the same instant both passed the check above, and the
                           -- row is the only place that race can actually be settled.

  if not found then
    raise exception 'That handle was just claimed by somebody else.';
  end if;
end
$$;


ALTER FUNCTION "public"."claim_snake_name"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clamp_visibility"("p_owner" "uuid", "p_wanted" "public"."visibility_tier") RETURNS "public"."visibility_tier"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select least(coalesce(p_wanted, 'private'::public.visibility_tier),
               public.visibility_ceiling(p_owner));
$$;


ALTER FUNCTION "public"."clamp_visibility"("p_owner" "uuid", "p_wanted" "public"."visibility_tier") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."clamp_visibility"("p_owner" "uuid", "p_wanted" "public"."visibility_tier") IS 'What this owner actually gets, given what they asked for. least() over the enum sort order, which is private < certain < friends < members < public -- so a narrower request is always honoured and a wider one is cut to the ceiling. Null asks for nothing and gets private.';



CREATE OR REPLACE FUNCTION "public"."close_park_room"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.park_rooms set open_at = null where owner = auth.uid();
$$;


ALTER FUNCTION "public"."close_park_room"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_profile_room"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.profile_room_invites i
   using public.profile_rooms r
   where i.room_id = r.id and r.owner = auth.uid();
  update public.profile_rooms set open_at = null, audience = 'friends'
   where owner = auth.uid();
end;
$$;


ALTER FUNCTION "public"."close_profile_room"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_member_signup"("p_token" "uuid", "p_username" "text", "p_display_name" "text", "p_contact_email" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_invite record;
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  /* ⚠️ FOR UPDATE, AND THE USED CHECK REPEATED ON THE WRITE. Without the lock two redemptions of
     the same link both read it as unused and both proceed; without `used_at is null` on the
     UPDATE the second one simply overwrites `used_by`, so the invite silently admits two people
     and records only the later. The lock makes the second one wait, and the guarded update makes
     it find nothing -- belt and braces, because the lock alone is lost the moment somebody calls
     this from a different path. */
  select * into v_invite
    from public.invites
   where token = p_token
     and used_at is null
     and (expires_at is null or expires_at > now())
   for update;
  if not found then raise exception 'invite not found or already used'; end if;

  /* ⚠️ AN EXISTING MEMBER OPENING AN INVITE USED TO OVERWRITE THEMSELVES. The profiles upsert set
     `username` and `first_name` from the form, and the user_roles upsert set `role` from the
     INVITE'S class -- so following somebody else's link renamed you and changed what you are.
     Checked rather than assumed: `is_admin()` reads `admin_users`, not `user_roles`, so adminhood survived -- what did not was your name and your class.
     Signing up is something you do once; this refuses rather than merging. */
  if exists (select 1 from public.profiles where user_id = v_uid)
     or exists (select 1 from public.user_roles where user_id = v_uid) then
    raise exception 'you are already a member';
  end if;

  insert into public.player_registry (player_name) values (p_username)
    on conflict (player_name) do nothing;

  insert into public.profiles (user_id, username, first_name, email)
  values (v_uid, p_username, p_display_name, p_contact_email);

  insert into public.user_roles (user_id, role) values (v_uid, v_invite.class);

  update public.invites
     set used_at = now(), used_by = v_uid
   where token = p_token and used_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'invite not found or already used'; end if;

  -- ── whoever let you in is your friend ──
  -- least/greatest because friendships store the pair in a fixed order (see are_friends), and
  -- the primary key is that ordered pair.
  if v_invite.created_by is not null and v_invite.created_by <> v_uid then
    insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
    values (
      least(v_invite.created_by, v_uid),
      greatest(v_invite.created_by, v_uid),
      v_invite.created_by,
      'accepted',
      now()
    )
    on conflict (user_a, user_b) do nothing;
  end if;
end;
$$;


ALTER FUNCTION "public"."complete_member_signup"("p_token" "uuid", "p_username" "text", "p_display_name" "text", "p_contact_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_circuit"("p_name" "text") RETURNS TABLE("id" "uuid", "name" "text", "join_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare g circuit_groups;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  insert into circuit_groups (name, created_by)
    values (coalesce(nullif(btrim(p_name), ''), 'My Circuit'), auth.uid())
    returning * into g;
  insert into circuit_group_members (group_id, user_id, role)
    values (g.id, auth.uid(), 'owner') on conflict do nothing;
  perform public._circuit_add_self(g.id);
  return query select g.id, g.name, g.join_code;
end $$;


ALTER FUNCTION "public"."create_circuit"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_invite"("p_class" "text", "p_label" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_token uuid := gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  insert into public.invites (token, class, label, created_by)
  values (v_token, p_class, p_label, auth.uid());
  return v_token;
end;
$$;


ALTER FUNCTION "public"."create_invite"("p_class" "text", "p_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_circuit"("p_group" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if not (public.is_admin() or exists (
    select 1 from circuit_group_members gm
    where gm.group_id = p_group and gm.user_id = auth.uid() and gm.role = 'owner'
  )) then
    raise exception 'only the circuit owner can delete it';
  end if;
  delete from circuit_movies       where group_id = p_group;
  delete from circuit_watchlist    where group_id = p_group;
  delete from circuit_person_groups where group_id = p_group;
  delete from circuit_group_members where group_id = p_group;
  delete from circuit_groups        where id = p_group;
end $$;


ALTER FUNCTION "public"."delete_circuit"("p_group" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_invite"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  delete from public.invites where id = p_id;
end;
$$;


ALTER FUNCTION "public"."delete_invite"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_profile_note"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_author uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select profile_user_id, author_user_id into v_owner, v_author
  from public.profile_notes where id = p_id;

  -- already gone: nothing to do, and nothing went wrong
  if not found then return; end if;

  if v_author is distinct from v_me and v_owner is distinct from v_me then
    raise exception 'not yours to delete';
  end if;

  delete from public.profile_notes where id = p_id;
end;
$$;


ALTER FUNCTION "public"."delete_profile_note"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."display_name"("p_user" "uuid", "p_group" "uuid" DEFAULT NULL::"uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    nullif(trim((select gm.nickname from public.circuit_group_members gm
                  where gm.user_id = p_user and gm.group_id = p_group)), ''),
    nullif(trim((select p.circuit_nickname from public.profiles p where p.user_id = p_user)), ''),
    nullif(trim((select p.nickname from public.profiles p where p.user_id = p_user)), ''),
    nullif(trim((select p.first_name from public.profiles p where p.user_id = p_user)), ''),
    (select p.username::text from public.profiles p where p.user_id = p_user),
    'Member'
  );
$$;


ALTER FUNCTION "public"."display_name"("p_user" "uuid", "p_group" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_best_score"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Explicitly set schema to avoid role-mutable search_path warning
  SET search_path = public;

  IF NEW.score < OLD.score THEN
    NEW.score := OLD.score;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_best_score"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_best_score"("p_player_id" integer, "p_game_mode" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Ensure correct schema is used
  SET search_path = public;

  -- Only update leaderboard if the new score is higher than the existing one
  UPDATE leaderboard
  SET score = GREATEST(score, (
        SELECT MAX(score)
        FROM score_history
        WHERE player_id = p_player_id
          AND game_mode = COALESCE(p_game_mode, 'survival')
      ))
  WHERE player_id = p_player_id
    AND game_mode = COALESCE(p_game_mode, 'survival');
END;
$$;


ALTER FUNCTION "public"."enforce_best_score"("p_player_id" integer, "p_game_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feed_may_show"("p_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select p_owner = auth.uid()
      or exists (select 1 from public.profiles p
                  where p.user_id = p_owner
                    and (p.age_band = 'adult' or p.feed_opt_in));
$$;


ALTER FUNCTION "public"."feed_may_show"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feed_recent"("p_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_per_member" integer DEFAULT 40, "p_scope" "text" DEFAULT 'you_and_friends'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me   uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
  v_rows jsonb := '[]'::jsonb;
  v_all  boolean;
  r      record;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  /* ⚠️ SCOPE IS A FILTER, NOT A BOUNDARY, and the difference decides what an unknown value does.
     Every event in here has already been through `can_see` by way of `get_member_activity`, so
     neither scope can show anybody anything the other would have hidden -- `all_members` is not
     a wider permission, it is a wider list of people to ask. That is why an unrecognised scope
     RAISES instead of quietly falling back to the narrow one: a typo is a programming mistake,
     silently narrowing would hide it, and there is no over-sharing to fail closed against. */
  p_scope := coalesce(nullif(btrim(p_scope), ''), 'you_and_friends');
  if p_scope not in ('you_and_friends', 'all_members') then
    raise exception 'unknown feed scope: %', p_scope;
  end if;
  v_all := p_scope = 'all_members';

  v_to   := least(coalesce(p_to, clock_timestamp()), clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '14 days'), v_to - interval '31 days');
  if v_from >= v_to then return '[]'::jsonb; end if;
  p_per_member := least(greatest(coalesce(p_per_member, 40), 1), 100);

  for r in
    select p.user_id,
           p.username::text as who,
           coalesce(p.first_name, p.username::text) as name
      from public.profiles p
     where coalesce(p.suspended, false) = false
       and public.feed_may_show(p.user_id)
       /* `you_and_friends` is you plus accepted friends. are_friends answers NULL for a question
          about two other people, which cannot happen here because one side is always v_me. */
       and (v_all
            or p.user_id = v_me
            or coalesce(public.are_friends(v_me, p.user_id), false))
     order by p.username
  loop
    v_rows := v_rows || coalesce((
      select jsonb_agg(q.e || jsonb_build_object('who', r.who, 'name', r.name,
                                                 'mine', r.user_id = v_me))
        from (
          select e
            from jsonb_array_elements(
                   public.get_member_activity(r.who, greatest(p_per_member, 200))) e
           where e ? 'at'
             and (e->>'at')::timestamptz >= v_from
             and (e->>'at')::timestamptz <  v_to
           order by (e->>'at')::timestamptz desc
           limit p_per_member
        ) q(e)
    ), '[]'::jsonb);
  end loop;

  /* Sittings are friends-only wherever they appear -- `chronicle_friends_log` asks only about
     friends by construction -- so this block is the same under both scopes. `all_members` does
     not widen it, because a sitting-by-sitting timeline is not a members-tier thing. */
  v_rows := v_rows || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind',   'sitting',      'id',     s->>'id',
             'who',    s->>'who',      'name',   s->>'name',
             'at',     s->>'started_at', 'until', s->>'ended_at',
             'detail', s->>'activity', 'score',  null,
             'colour', s->'colour',    'amount', s->'amount',
             'metric', s->'metric',    'mine',   false))
      from jsonb_array_elements(public.chronicle_friends_log(v_from, v_to)) s
      join public.profiles p on p.username::text = s->>'who'
     where public.feed_may_show(p.user_id)
  ), '[]'::jsonb);

  v_rows := v_rows || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind',   'sitting',       'id',     e.id::text,
             'who',    p.username::text,
             'name',   coalesce(p.first_name, p.username::text),
             'at',     e.started_at,    'until',  e.ended_at,
             'detail', a.name,          'score',  null,
             'colour', to_jsonb(a.colour), 'amount', to_jsonb(e.amount),
             'metric', to_jsonb(a.metric), 'mine', true))
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = e.owner
      join public.profiles p on p.user_id = e.owner
     where e.owner = v_me
       and e.ended_at is not null
       and e.started_at < v_to
       and e.ended_at   > v_from
       and public.item_reaches_anyone(v_me, a.visibility,
                                      'chronicle_activity', a.id::text)
       and public.chronicle_shares_timeline(v_me)
  ), '[]'::jsonb);

  return coalesce((
    select jsonb_agg(q.e order by (q.e->>'at')::timestamptz desc)
      from (select e
              from jsonb_array_elements(v_rows) e
             order by (e->>'at')::timestamptz desc
             limit 300) q(e)
  ), '[]'::jsonb);
end
$$;


ALTER FUNCTION "public"."feed_recent"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_per_member" integer, "p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_round_rpc"("p_room_id" "text", "p_round_id" "text", "p_game_mode" "text", "p_items" "jsonb", "p_players" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  existing jsonb; results_items jsonb := '[]'::jsonb; i record;
  v_reg_id bigint; v_owner uuid; v_name text; v_claimed_by_someone_else boolean;
  v_leaderboard_id bigint; v_total_players int; v_max_trophy_place int;
  v_max_score constant int := 1000000;
BEGIN
  SELECT results INTO existing FROM round_results
  WHERE room_id = p_room_id AND round_id = p_round_id;
  IF existing IS NOT NULL THEN RETURN existing; END IF;

  DROP TABLE IF EXISTS tmp_items; DROP TABLE IF EXISTS tmp_claims; DROP TABLE IF EXISTS tmp_rank;
  CREATE TEMP TABLE tmp_items (id text, name text, score int, finish_idx int) ON COMMIT DROP;
  INSERT INTO tmp_items(id, name, score, finish_idx)
  SELECT (elem->>'id')::text, trim(coalesce(elem->>'name','Player')),
         least(coalesce((elem->>'score')::int,0), v_max_score),
         coalesce((elem->>'finishIdx')::int, 9999)
  FROM jsonb_array_elements(p_items) AS elem;
  DELETE FROM tmp_items WHERE score < 0;

  CREATE TEMP TABLE tmp_claims (id text, user_id uuid) ON COMMIT DROP;
  INSERT INTO tmp_claims(id, user_id)
  SELECT (elem->>'id')::text,
         CASE WHEN (elem->>'userId') ~ '^[0-9a-fA-F-]{36}$' THEN (elem->>'userId')::uuid END
  FROM jsonb_array_elements(coalesce(p_players,'[]'::jsonb)) AS elem;

  CREATE TEMP TABLE tmp_rank ON COMMIT DROP AS
  WITH base AS (SELECT id,name,score,finish_idx FROM tmp_items ORDER BY score DESC, finish_idx ASC),
  ranked AS (SELECT id,name,score,finish_idx, dense_rank() OVER (ORDER BY score DESC) AS place FROM base)
  SELECT * FROM ranked;
  -- whether each player's score actually reached the leaderboard, so the game can say so
  ALTER TABLE tmp_rank ADD COLUMN credited boolean NOT NULL DEFAULT false;

  SELECT COUNT(*) INTO v_total_players FROM tmp_rank;
  IF v_total_players <= 1 THEN v_max_trophy_place := 0;
  ELSIF v_total_players = 2 THEN v_max_trophy_place := 1;
  ELSIF v_total_players = 3 THEN v_max_trophy_place := 2;
  ELSE v_max_trophy_place := 3; END IF;

  FOR i IN (SELECT * FROM tmp_rank) LOOP
    -- lower() on BOTH sides: the temp column carries the case-sensitive default collation
    SELECT r.id, r.user_id, r.player_name INTO v_reg_id, v_owner, v_name
    FROM player_registry r WHERE lower(r.player_name) = lower(i.name);

    v_claimed_by_someone_else := v_owner IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tmp_claims c WHERE c.id = i.id AND c.user_id = v_owner);
    IF v_claimed_by_someone_else THEN CONTINUE; END IF;

    IF v_reg_id IS NULL THEN
      INSERT INTO player_registry(player_name) VALUES (i.name) ON CONFLICT (player_name) DO NOTHING;
      SELECT r.id, r.player_name INTO v_reg_id, v_name
      FROM player_registry r WHERE lower(r.player_name) = lower(i.name);
    END IF;
    -- skip, never raise: one unresolvable player must not take everyone else's round with them
    IF v_reg_id IS NULL THEN CONTINUE; END IF;
    v_name := coalesce(v_name, i.name);

    INSERT INTO score_history(player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
    VALUES (v_reg_id, v_name, i.score, COALESCE(p_game_mode,'survival'), NULL, NULL, NOW());

    INSERT INTO leaderboard(player_id, player_name, score, game_mode, created_at)
    VALUES (v_reg_id, v_name, i.score, COALESCE(p_game_mode,'survival'), NOW())
    ON CONFLICT (player_id, game_mode) DO UPDATE SET
      score = GREATEST(leaderboard.score, EXCLUDED.score),
      player_name = EXCLUDED.player_name, created_at = leaderboard.created_at
    RETURNING id INTO v_leaderboard_id;

    IF v_leaderboard_id IS NOT NULL AND i.place IS NOT NULL AND i.place <= v_max_trophy_place THEN
      INSERT INTO trophies(leaderboard_id, trophy_name)
      VALUES (v_leaderboard_id, CASE WHEN i.place=1 THEN 'gold' WHEN i.place=2 THEN 'silver' ELSE 'bronze' END);
    END IF;

    UPDATE tmp_rank SET credited = true WHERE id = i.id;
  END LOOP;

  results_items := (SELECT jsonb_agg(j) FROM (
    SELECT jsonb_build_object('id',id,'name',name,'score',score,'place',place,
                              'credited',credited) AS j
    FROM tmp_rank ORDER BY place ASC, score DESC, finish_idx ASC) sub);

  INSERT INTO round_results(room_id, round_id, game_mode, results)
  VALUES (p_room_id, p_round_id, COALESCE(p_game_mode,'survival'), results_items);
  RETURN results_items;
END;
$_$;


ALTER FUNCTION "public"."finalize_round_rpc"("p_room_id" "text", "p_round_id" "text", "p_game_mode" "text", "p_items" "jsonb", "p_players" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_member_by_username"("p_username" "text") RETURNS TABLE("username" "text", "name" "text", "is_friend" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.username::text,
         coalesce(p.first_name, p.username::text),
         public.are_friends(auth.uid(), p.user_id)
  from public.profiles p
  where auth.uid() is not null
    and coalesce(p.suspended, false) = false
    and p.user_id <> auth.uid()
    and lower(p.username::text) = lower(trim(coalesce(p_username, '')))
    and length(trim(coalesce(p_username, ''))) >= 2;
$$;


ALTER FUNCTION "public"."find_member_by_username"("p_username" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family_account_id" "uuid" NOT NULL,
    "executed_trade_id" "uuid" NOT NULL,
    "units_allocated" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "finance"."allocations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_allocations"("uid" "uuid") RETURNS SETOF "finance"."allocations"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN QUERY
    SELECT *
    FROM finance.allocations
    WHERE user_id = uid;
END;
$$;


ALTER FUNCTION "public"."get_allocations"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_demo_profile"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_user uuid;
  v_name text;
  v_first text;
  v_since text;
begin
  /* ⚠️ THE SAME CHECKS AS get_public_profile, WHICH THIS USED TO SKIP ENTIRELY. This serves a
     REAL member's page to anonymous visitors -- it is not fabricated data -- so it has to meet
     every condition the ordinary public door meets: the owner has published a page, the owner is
     still allowed to publish one, and each block is clamped to the owner's ceiling rather than
     served at the level it was once given. `is_demo` is additionally pinned to the admin's row
     by a trigger, so this cannot start serving somebody else's page. */
  select p.user_id, p.username::text, p.first_name, to_char(p.created_at, 'YYYY-MM-DD')
    into v_user, v_name, v_first, v_since
    from public.profiles p
   where p.is_demo
     and p.public_page
     and public.may_publish_a_page(p.user_id)
     and coalesce(p.suspended, false) = false
   limit 1;

  -- nobody has volunteered: the app shows its ordinary signed-out page
  if v_user is null then
    return null;
  end if;

  return jsonb_build_object(
    'username', v_name,
    'first_name', v_first,
    'member_since', v_since,
    'is_me', false,
    'friend_status', null,
    'shared_circuits', '[]'::jsonb,
    'movies_rated', (
      select count(*) from public.circuit_ratings r where r.user_id = v_user
    ),
    'snake_best', (
      select jsonb_build_object('score', l.score, 'game_mode', l.game_mode,
                                'achieved', to_char(l.created_at, 'YYYY-MM-DD'))
        from public.leaderboard l
        join public.player_registry reg on reg.id = l.player_id
       where reg.user_id = v_user
       order by l.score desc
       limit 1
    ),
    'activity_visibility', 'private',
    /* the layout its owner chose. Deliberately NOT inside `look`: a visitor may switch a
       look off, and the arrangement of the page is not a skin offered to them. */
    'page', (select pl.page_style from public.profiles pl where pl.user_id = v_user),
    /* the columns are look_theme / look_palette / look_flair / look_backdrop — checked against
       get_member_profile rather than guessed, because a wrong name here is a function that
       creates cleanly and fails on the first visitor */
    'look', (
      select jsonb_build_object('theme', pl.look_theme, 'palette', pl.look_palette,
                                'flair', pl.look_flair, 'backdrop', pl.look_backdrop)
        from public.profiles pl where pl.user_id = v_user
    ),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'block_type', b.block_type, 'position', b.position,
               'size', b.size, 'config', b.config, 'visibility', b.visibility
             ) order by b.position)
        from public.profile_blocks b
       where b.user_id = v_user
         and least(b.visibility, public.visibility_ceiling(b.user_id)) = 'public'
    ), '[]'::jsonb)
  );
end
$$;


ALTER FUNCTION "public"."get_demo_profile"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."executed_trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_symbol" "text" NOT NULL,
    "asset_type" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "execution_time" timestamp with time zone NOT NULL,
    "dollar_amount" numeric NOT NULL,
    "price" numeric NOT NULL,
    "units_acquired" numeric NOT NULL,
    "fee" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "executed_trade_id" "uuid" DEFAULT "gen_random_uuid"(),
    "import_key" "text",
    "kind" "text",
    "reviewed_at" timestamp with time zone,
    CONSTRAINT "executed_trades_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['stock'::"text", 'crypto'::"text"]))),
    CONSTRAINT "executed_trades_kind_check" CHECK ((("kind" IS NULL) OR ("kind" = ANY (ARRAY['buy'::"text", 'sell'::"text", 'drip'::"text", 'adjustment'::"text"]))))
);


ALTER TABLE "finance"."executed_trades" OWNER TO "postgres";


COMMENT ON COLUMN "finance"."executed_trades"."kind" IS 'buy = money in from the owner. sell = money out. drip = shares bought with the holding''s own dividend, NOT a contribution. adjustment = split/symbol change, units move and no money does. NULL = imported before this column existed; buy-vs-drip is unrecoverable for those without re-importing the original CSV.';



COMMENT ON COLUMN "finance"."executed_trades"."reviewed_at" IS 'When a human answered "is this the family''s?" — including when the answer was no. Distinct from having allocations: keeping a trade for yourself produces no rows, so without this there is no difference between "mine" and "never looked".';



CREATE OR REPLACE FUNCTION "public"."get_executed_trades"("uid" "uuid") RETURNS SETOF "finance"."executed_trades"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN QUERY
    SELECT *
    FROM finance.executed_trades
    WHERE user_id = uid;
END;
$$;


ALTER FUNCTION "public"."get_executed_trades"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_invite_by_token"("p_token" "uuid") RETURNS TABLE("label" "text", "is_used" boolean, "is_expired" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  select i.label,
         (i.used_at is not null),
         (i.expires_at is not null and i.expires_at <= now())
  from public.invites i
  where i.token = p_token;
end;
$$;


ALTER FUNCTION "public"."get_invite_by_token"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_activity"("p_username" "text", "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_viewer uuid := auth.uid(); v_target uuid; v_username text; v_first text;
  v_tier public.visibility_tier;
begin
  /* ⚠️ No `not authenticated` raise, deliberately. This is reachable by anon only through
     get_public_activity, which checks public_page first; for every other caller the GRANT is the
     gate. can_see() returns true for 'public' and nothing else when auth.uid() is null, so a
     viewer who is nobody sees a public feed or an empty one. */
  select p.user_id, p.username::text, p.first_name, p.activity_visibility
    into v_target, v_username, v_first, v_tier
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null or not public.can_see_item(v_target, v_tier, 'profile_activity', v_target::text) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row_to_json(top)::jsonb)
    from (
      select * from (
        (
          select 'circuit_log' as kind, l.id::text as id, l.date::timestamptz as at,
                 (select string_agg(distinct cg.name, ', ')
                    from public.circuit_person_groups cpg
                    join public.circuit_groups cg on cg.id = cpg.group_id
                    join public.circuit_group_members m on m.group_id = cg.id and m.user_id = v_viewer
                   where cpg.person_id = cp.id) as detail,
                 round(coalesce(agg.pts, 0))::int as score, agg.items
          from public.circuit_logs l
          join public.circuit_people cp on cp.id = l.person_id
          left join lateral (
            select jsonb_agg(jsonb_build_object(
                     'name', coalesce(ex.def->>'name', case when t.entry->>'eid' = '__total__'
                              then 'Imported total' else 'Other' end),
                     'unit', ex.def->>'unit', 'val', (t.entry->>'val')::numeric,
                     'points', round(case when t.entry->>'eid' = '__total__'
                       then (t.entry->>'val')::numeric
                       else (t.entry->>'val')::numeric * coalesce((ex.def->>'mult')::numeric,0) end)
                   ) order by t.ord) as items,
                   sum(case when t.entry->>'eid' = '__total__' then (t.entry->>'val')::numeric
                       else (t.entry->>'val')::numeric * coalesce((ex.def->>'mult')::numeric,0) end) as pts
            from jsonb_array_elements(coalesce(l.entries,'[]'::jsonb)) with ordinality as t(entry, ord)
            left join lateral (select x as def from jsonb_array_elements(coalesce(cp.exercises,'[]'::jsonb)) x
                               where x->>'id' = t.entry->>'eid' limit 1) ex on true
          ) agg on true
          where cp.owner_user_id = v_target
            and (public.can_see_item(cp.owner_user_id, cp.visibility, 'circuit_person', cp.id)
                 or exists (select 1 from public.circuit_person_groups cpg
                            join public.circuit_group_members m on m.group_id = cpg.group_id
                            where cpg.person_id = cp.id and m.user_id = v_viewer))
        )
        union all
        (
          /* ⚠️ `movie_visible` IS THE ROW'S OWN GATE and is the same one circuit_ratings_select
             uses — so a review reaches the feed only where it was already reachable. Rated but
             unwritten counts: a score IS the review for most of them. */
          /* ⚠️ THE ID IS THE PAIR, because the table's key is the pair. A bare movie_id is one
             event per FILM, and this is a list of PEOPLE. */
          select 'rating' as kind, r.movie_id::text || ':' || r.user_id::text as id, r.updated_at as at,
                 coalesce(nullif(btrim(mv.title), ''), 'Something') as detail,
                 r.score, null::jsonb as items
          from public.circuit_ratings r
          join public.circuit_movies mv on mv.id = r.movie_id
          where r.user_id = v_target
            and r.score is not null
            and public.movie_visible(r.movie_id)
        )
        union all
        (
          /* ⚠️ BY USER ID, NEVER BY NAME. This used to read
               `or lower(sh.player_name) in (lower(v_username), lower(v_first))`
             so a snake score attached to a member because the NAME on it matched theirs. The
             leaderboard is open — `player_registry` holds 128 names of which only 19 belong to a
             member — so anybody could have posted a score under somebody else's first name and
             had it appear on their profile, and now in their feed, as theirs.
             `claim_my_reserved_snake_name` already links a reserved name to its owner, which is
             what the id is FOR. Measured before removing it: of the 142 score rows, 7 matched a
             member by name and the id agreed on all 7; the same for both trophy rows. So it
             carried nothing and risked everything. */
          select 'snake_score' as kind, sh.id::text as id, sh.created_at as at, sh.game_mode as detail,
                 sh.score, null::jsonb as items
          from public.score_history sh
          join public.player_registry r on r.id = sh.player_id
          where r.user_id = v_target
            and public.can_see_item(r.user_id, r.visibility, 'player_registry', r.id::text)
        )
        union all
        (
          select 'snake_trophy' as kind, tr.id::text as id, tr.awarded_at as at, tr.trophy_name as detail,
                 lb.score, null::jsonb as items
          from public.trophies tr
          join public.leaderboard lb on lb.id = tr.leaderboard_id
          join public.player_registry r on r.id = lb.player_id
          where r.user_id = v_target
            and public.can_see_item(r.user_id, r.visibility, 'player_registry', r.id::text)
        )
      ) events
      order by at desc limit p_limit
    ) top
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."get_member_activity"("p_username" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_chronicle"("p_username" "text", "p_days" integer DEFAULT 7) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_ok boolean;
  v_live boolean;
  v_wants_goals boolean;
  v_days int;
  v_from timestamptz;
  v_to timestamptz := clock_timestamp();
  v_time jsonb;
  v_top jsonb;
  v_now jsonb;
  v_goals jsonb;
  v_reached int;
  v_open int;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;

  select p.user_id into v_target
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null then return null; end if;

  -- THE GATE, and both opt-ins, in one pass over the blocks this viewer may see.
  -- v_ok:          is there a chronicle block for them at all?
  -- v_live:        has a block they can see asked to show what is running right now?
  -- v_wants_goals: has a block they can see asked to show goals at all?
  --
  -- Neither opt-in is a parameter, and that is the point: the window (p_days) is not a privacy
  -- boundary, but what somebody is doing this minute and what they are trying to change about
  -- their life are, so a caller cannot ask for either.
  select bool_or(true),
         bool_or(coalesce((b.config->>'live')::boolean, false)),
         bool_or(coalesce((b.config->>'goals')::boolean, false))
    into v_ok, v_live, v_wants_goals
  from public.profile_blocks b
  where b.user_id = v_target and b.block_type = 'chronicle'
    and (v_target = v_viewer or public.can_see_item(v_target, b.visibility, 'profile_block', b.id::text));
  if not coalesce(v_ok, false) then return null; end if;

  v_days := least(greatest(coalesce(p_days, 7), 1), 90);
  v_from := v_to - make_interval(days => v_days);

  -- the overlap sum is chronicle_sum's, character for character
  select coalesce(jsonb_object_agg(t.cat, round(t.mins)), '{}'::jsonb) into v_time
  from (
    select a.cat,
           sum(greatest(0, extract(epoch from (
             least(coalesce(e.ended_at, clock_timestamp()), v_to)
             - greatest(e.started_at, v_from))))) / 60.0 as mins
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
     where e.owner = v_target
       and e.started_at < v_to
       and coalesce(e.ended_at, clock_timestamp()) > v_from
     group by a.cat
  ) t
  where t.mins >= 1;

  select coalesce(jsonb_agg(x order by x.mins desc, x.name), '[]'::jsonb) into v_top
  from (
    select a.name, a.cat, a.colour,
           round(sum(greatest(0, extract(epoch from (
             least(coalesce(e.ended_at, clock_timestamp()), v_to)
             - greatest(e.started_at, v_from))))) / 60.0) as mins
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
     where e.owner = v_target
       and e.started_at < v_to
       and coalesce(e.ended_at, clock_timestamp()) > v_from
     group by a.id, a.name, a.cat, a.colour
     having sum(greatest(0, extract(epoch from (
              least(coalesce(e.ended_at, clock_timestamp()), v_to)
              - greatest(e.started_at, v_from))))) / 60.0 >= 1
     order by mins desc, a.name
     limit 5
  ) x;

  if v_live then
    select to_jsonb(t) into v_now
    from (
      select a.name, a.cat, a.colour,
             round(extract(epoch from (clock_timestamp() - e.started_at)) / 60.0) as mins
        from public.chronicle_entries e
        join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
       where e.owner = v_target and e.ended_at is null
       order by e.started_at desc
       limit 1
    ) t;
  end if;

  -- TWO SWITCHES, BOTH REQUIRED: a visible block asked for goals, and the owner ticked this goal.
  -- Six at most, so a page cannot become a wall of somebody's ambitions. No progress figure: a
  -- goal's window comes from goalWindow in src/chronicle/goal.ts and the server has no copy of it,
  -- which is also why chronicle_tally takes its windows from the caller. What a shared goal says
  -- is what it IS, not how far along.
  if v_wants_goals then
    select coalesce(jsonb_agg(
             jsonb_build_object('title', g.title, 'target', g.target,
                                'unit', g.unit, 'done', g.done)
             order by g.ord), '[]'::jsonb)
      into v_goals
    from (
      select gl.title, gl.target, gl.unit, (gl.done_at is not null) as done,
             row_number() over (order by gl.priority desc, gl.sort, gl.title) as ord
        from public.chronicle_goals gl
       where gl.owner = v_target
         and public.can_see_item(v_target, gl.visibility,
                                 'chronicle_goal', gl.id::text)
       order by gl.priority desc, gl.sort, gl.title
       limit 6
    ) g;
  end if;

  -- ⚠️ THE SAME PREDICATE AS THE LIST ABOVE, so a goal is COUNTED exactly when it could be
  -- LISTED. These used to count every goal the owner had: a member whose only goal was
  -- Only me told each of their friends they had one on the go. No `v_target = v_viewer`
  -- escape is needed -- can_see answers true for the owner at every tier -- so an owner's
  -- own card still counts everything.
  select count(*) filter (where g.done_at is not null and g.done_at >= v_from),
         count(*) filter (where g.done_at is null)
    into v_reached, v_open
  from public.chronicle_goals g
  where g.owner = v_target
    and public.can_see_item(v_target, g.visibility,
                            'chronicle_goal', g.id::text);

  return jsonb_build_object(
    'days', v_days,
    'time', v_time,
    'top', v_top,
    'now', v_now,
    'goals', coalesce(v_goals, '[]'::jsonb),
    'reached', v_reached,
    'open', v_open
  );
end $$;


ALTER FUNCTION "public"."get_member_chronicle"("p_username" "text", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_profile"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_first text;
  v_username text;
  v_since date;
  v_tier public.visibility_tier;
  v_snake jsonb;
  v_groups jsonb;
  v_movies int;
  v_friend text;
  v_can boolean;
  v_look_theme text;
  v_look_palette jsonb;
  v_look_flair text;
  v_look_backdrop text;
  v_me_snake jsonb;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;

  select p.user_id, p.username::text, p.first_name, p.created_at::date, p.activity_visibility,
         p.look_theme, p.look_palette, p.look_flair, p.look_backdrop
    into v_target, v_username, v_first, v_since, v_tier,
         v_look_theme, v_look_palette, v_look_flair, v_look_backdrop
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null then return null; end if;

  select case
           when f.status = 'accepted' then 'friends'
           when f.requested_by = v_viewer then 'pending_out'
           else 'pending_in'
         end into v_friend
  from public.friendships f
  where f.user_a = least(v_viewer, v_target) and f.user_b = greatest(v_viewer, v_target);

  v_can := public.can_see_item(v_target, v_tier, 'profile_activity', v_target::text);

  select coalesce(jsonb_agg(g order by g->>'name'), '[]'::jsonb) into v_groups
  from (
    select jsonb_build_object(
      'name', cg.name,
      'people', coalesce((
        select jsonb_agg(cp.name order by cp.name)
        from public.circuit_people cp
        join public.circuit_person_groups cpg on cpg.person_id = cp.id and cpg.group_id = cg.id
        where cp.owner_user_id = v_target
      ), '[]'::jsonb)
    ) as g
    from public.circuit_groups cg
    where v_can
      and exists (select 1 from public.circuit_group_members m
                  where m.group_id = cg.id and m.user_id = v_viewer)
      and exists (select 1 from public.circuit_group_members m
                  where m.group_id = cg.id and m.user_id = v_target)
  ) s;

  select case when v_can then count(*)::int else 0 end into v_movies
  from public.circuit_movies mv
  where mv.group_id in (
      select cg.id from public.circuit_groups cg
      where exists (select 1 from public.circuit_group_members m
                    where m.group_id = cg.id and m.user_id = v_viewer)
        and exists (select 1 from public.circuit_group_members m
                    where m.group_id = cg.id and m.user_id = v_target))
    and exists (select 1 from public.circuit_people cp
                where cp.owner_user_id = v_target and mv.ratings ? cp.id);

  if v_can then
    select to_jsonb(t) into v_snake
    from (
      select sh.score, sh.game_mode, sh.created_at::date as achieved
      from public.score_history sh
      join public.player_registry pr on pr.id = sh.player_id
      where pr.user_id = v_target
      order by sh.score desc limit 1
    ) t;
  end if;

  -- the viewer's own best, for head-to-head. Not gated: it's their own score.
  select to_jsonb(t) into v_me_snake
  from (
    select sh.score
    from public.score_history sh
    join public.player_registry pr on pr.id = sh.player_id
    where pr.user_id = v_viewer
    order by sh.score desc limit 1
  ) t;

  return jsonb_build_object(
    'username', v_username,
    'first_name', v_first,
    'member_since', v_since,
    'is_me', v_target = v_viewer,
    'friend_status', v_friend,
    'shared_circuits', v_groups,
    'movies_rated', v_movies,
    'snake_best', v_snake,
    'viewer_snake_best', v_me_snake,
    'activity_visibility', v_tier,
    /* the layout its owner chose. Deliberately NOT inside `look`: a visitor may switch a
       look off, and the arrangement of the page is not a skin offered to them. */
    'page', (select pl.page_style from public.profiles pl where pl.user_id = v_target),
    'look', jsonb_build_object(
      'theme', v_look_theme,
      'palette', v_look_palette,
      'flair', v_look_flair,
      'backdrop', v_look_backdrop
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_member_profile"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_trophies"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_viewer uuid := auth.uid(); v_target uuid; v_username text; v_first text;
  v_tier public.visibility_tier;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;
  select p.user_id, p.username::text, p.first_name, p.activity_visibility
    into v_target, v_username, v_first, v_tier
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null or not public.can_see_item(v_target, v_tier, 'profile_activity', v_target::text) then return '[]'::jsonb; end if;

  /* ⚠️ BY USER ID, NEVER BY NAME -- the same fix the feed got, in the place it was missed.
     This used to carry `or lower(lb.player_name) in (lower(v_username), lower(v_first))`, so a
     trophy appeared on a member's profile because the handle on the leaderboard row matched
     their username or first name. The leaderboard is open and `player_registry` holds 128 names
     of which only 19 belong to a member, so the handle is not evidence of who somebody is.
     `claim_my_reserved_snake_name` links a reserved handle to its owner, which is what the id
     is for. `lb.player_name` is still RETURNED as `handle`, because what a trophy was won under
     is worth showing -- it is just not how the trophy is attributed. */
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'trophy_name', tr.trophy_name,
             'at', tr.awarded_at,
             'handle', lb.player_name,
             'game_mode', lb.game_mode
           ) order by tr.awarded_at desc)
    from public.trophies tr
    join public.leaderboard lb on lb.id = tr.leaderboard_id
    join public.player_registry r on r.id = lb.player_id
    where r.user_id = v_target
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."get_member_trophies"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_portfolio"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  /* ⚠️ THE TWO LINES THIS FUNCTION NEVER HAD. Both messages are shown to the member as written:
     the room does `if (error) throw error` and renders what comes back. */
  if public.is_suspended(v_uid) then raise exception 'this account is suspended'; end if;
  if not coalesce((select enabled from public.my_features() where feature = 'finance'), false) then
    raise exception 'investments are not enabled for this account';
  end if;

  select coalesce(jsonb_agg(finance.account_payload(fa.id) order by fa.display_name), '[]'::jsonb)
    into v_result
    from finance.family_accounts fa
   where fa.user_id = v_uid;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_my_portfolio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profile"() RETURNS TABLE("username" "text", "first_name" "text", "middle_name" "text", "last_name" "text", "email" "text", "phone" "text", "birthday" "text", "address" "text", "venmo" "text", "cashapp" "text", "zelle" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  return query
  select p.username::text, p.first_name, p.middle_name, p.last_name,
         p.email, p.phone, p.birthday::text, p.address,
         p.venmo, p.cashapp, p.zelle
  from public.profiles p
  where p.user_id = v_uid;
end;
$$;


ALTER FUNCTION "public"."get_my_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_public_page"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce((select p.public_page from public.profiles p where p.user_id = auth.uid()), false);
$$;


ALTER FUNCTION "public"."get_my_public_page"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_timeline"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if public.is_suspended(v_uid) then raise exception 'this account is suspended'; end if;
  if not coalesce((select enabled from public.my_features() where feature = 'finance'), false) then
    raise exception 'investments are not enabled for this account';
  end if;
  return public._fund_timeline(v_uid, false);
end $$;


ALTER FUNCTION "public"."get_my_timeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_park_room"("p_username" "text") RETURNS TABLE("room_id" "uuid", "map_name" "text", "audience" "text", "is_owner" boolean, "open_since" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, m.name, r.audience::text, r.owner = auth.uid(), r.open_at
  from public.park_rooms r
  join public.profiles p on p.user_id = r.owner
  join public.park_maps m on m.id = r.map_id
  where lower(p.username::text) = lower(trim(p_username))
    and (r.open_at is not null or r.owner = auth.uid())
    and public.park_room_member(r.id);
$$;


ALTER FUNCTION "public"."get_park_room"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_park_room_map"("p_room" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.body
  from public.park_rooms r
  join public.park_maps m on m.id = r.map_id
  where r.id = p_room
    and (r.open_at is not null or r.owner = auth.uid())
    and public.park_room_member(r.id);
$$;


ALTER FUNCTION "public"."get_park_room_map"("p_room" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_blocks"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;

  select p.user_id into v_target
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'block_type', b.block_type, 'position', b.position,
      'size', b.size, 'config', b.config, 'visibility', b.visibility,
      /* the block's Certain list, for its OWNER and nobody else -- a viewer gets null,
         which is not the same statement as an empty list */
      'certain', case when v_target = v_viewer then coalesce((
          select jsonb_agg(pr.username::text order by lower(pr.username::text))
            from public.visibility_certain vc
            join public.profiles pr on pr.user_id = vc.friend
           where vc.item_kind = 'profile_block' and vc.item_id = b.id::text
             and vc.owner = v_target
             and coalesce(public.are_friends(v_target, vc.friend), false)
        ), '[]'::jsonb) end
    ) order by b.position)
    from public.profile_blocks b
    where b.user_id = v_target
      and (v_target = v_viewer
           or public.can_see_item(v_target, b.visibility, 'profile_block', b.id::text))
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."get_profile_blocks"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_profile_room"("p_username" "text") RETURNS TABLE("room_id" "uuid", "audience" "text", "is_owner" boolean, "open_since" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.audience::text, r.owner = auth.uid(), r.open_at
  from public.profile_rooms r
  join public.profiles p on p.user_id = r.owner
  where lower(p.username::text) = lower(trim(p_username))
    and (r.open_at is not null or r.owner = auth.uid())
    and public.profile_room_member(r.id);
$$;


ALTER FUNCTION "public"."get_profile_room"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_activity"("p_username" "text", "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_ok boolean;
begin
  if p_username is null or length(p_username) > 64 then return '[]'::jsonb; end if;

  select true into v_ok
    from public.profiles p
   where lower(p.username::text) = lower(p_username)
     and p.public_page
     and public.may_publish_a_page(p.user_id)
     /* clamped for the same reason as the blocks above */
     and least(p.activity_visibility, public.visibility_ceiling(p.user_id)) = 'public'
     and coalesce(p.suspended, false) = false
   limit 1;

  if v_ok is not true then return '[]'::jsonb; end if;

  return public.get_member_activity(p_username, least(greatest(coalesce(p_limit, 20), 1), 50));
end
$$;


ALTER FUNCTION "public"."get_public_activity"("p_username" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_profile"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_user  uuid;
  v_name  text;
  v_first text;
  v_since text;
begin
  /* ⚠️ ONE LOOKUP, and every way of failing it leaves v_user null and returns the same thing.
     No separate "no such member" branch, because the difference between "not here" and "here
     but not public" is precisely what an anonymous caller must not be able to measure. */
  if p_username is null or length(p_username) > 64 then
    return null;
  end if;

  select p.user_id, p.username::text, p.first_name, to_char(p.created_at, 'YYYY-MM-DD')
    into v_user, v_name, v_first, v_since
    from public.profiles p
   where lower(p.username::text) = lower(p_username)
     and p.public_page
     and public.may_publish_a_page(p.user_id)
     and coalesce(p.suspended, false) = false
   limit 1;

  if v_user is null then
    return null;
  end if;

  return jsonb_build_object(
    'username', v_name,
    'first_name', v_first,
    'member_since', v_since,
    'is_me', false,
    /* a stranger has no relationship, and saying so is not the same as leaving it out */
    'friend_status', null,
    'shared_circuits', '[]'::jsonb,
    'movies_rated', (
      select count(*) from public.circuit_ratings r where r.user_id = v_user
    ),
    'snake_best', (
      select jsonb_build_object('score', l.score, 'game_mode', l.game_mode,
                                'achieved', to_char(l.created_at, 'YYYY-MM-DD'))
        from public.leaderboard l
        join public.player_registry reg on reg.id = l.player_id
       where reg.user_id = v_user
       order by l.score desc
       limit 1
    ),
    /* ⚠️ 'private', exactly as the demo reports it, and NOT the owner's real setting.
       Activity is a separate feed with its own gate (get_member_activity, which already returns
       a stranger the items without the circuit NAME — see 2026-08-21-member-activity-detail).
       Wiring it to an anonymous caller is a second decision and gets its own migration; until
       then this says the true thing about what THIS payload carries, which is no activity. */
    'activity_visibility', 'private',
    /* the layout its owner chose. Deliberately NOT inside `look`: a visitor may switch a
       look off, and the arrangement of the page is not a skin offered to them. */
    'page', (select pl.page_style from public.profiles pl where pl.user_id = v_user),
    'look', (
      select jsonb_build_object('theme', pl.look_theme, 'palette', pl.look_palette,
                                'flair', pl.look_flair, 'backdrop', pl.look_backdrop)
        from public.profiles pl where pl.user_id = v_user
    ),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'block_type', b.block_type, 'position', b.position,
               'size', b.size, 'config', b.config, 'visibility', b.visibility
             ) order by b.position)
        from public.profile_blocks b
       where b.user_id = v_user
         /* ⚠️ CLAMPED, NOT COMPARED. `b.visibility = 'public'` served a row at the level its
            owner once chose, regardless of whether they may still choose it -- and this is the
            one door that opens onto the open web, so it is the door where that matters most.
            can_see() was taught the ceiling first and does not help here: this function never
            calls it. */
         and least(b.visibility, public.visibility_ceiling(b.user_id)) = 'public'
    ), '[]'::jsonb)
  );
end
$$;


ALTER FUNCTION "public"."get_public_profile"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_usernames_for_users"("p_user_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "username" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.user_id, p.username::text
  from public.profiles p
  where p.user_id = any(p_user_ids)
    and coalesce(p.suspended, false) = false;
$$;


ALTER FUNCTION "public"."get_usernames_for_users"("p_user_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guestbook_open_to"("p_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profile_blocks b
    where b.user_id = p_owner
      and b.block_type = 'guestbook'
      and (p_owner = auth.uid() or public.can_see_item(p_owner, b.visibility, 'profile_block', b.id::text))
  );
$$;


ALTER FUNCTION "public"."guestbook_open_to"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_allocation"("payload" "jsonb") RETURNS "finance"."allocations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v jsonb := coalesce(payload, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_family_account_id uuid;
  v_executed_trade_id uuid;
  v_units_allocated numeric;
  v_trade_units numeric;
  v_trade_owner uuid;
  v_already numeric;
  out_row finance.allocations;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  /* ⚠️ THE CHECK THIS FUNCTION NEVER HAD. It is reachable from the REST API by anybody signed in
     and it writes rows that `finance.account_payload` reads by `family_account_id` alone, so
     without this line a member could add holdings to an account that is not theirs. */
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  v_family_account_id := nullif(v->>'family_account_id', '')::uuid;
  v_executed_trade_id := nullif(v->>'executed_trade_id', '')::uuid;
  v_units_allocated := nullif(v->>'units_allocated', '')::numeric;

  if v_family_account_id is null then
    raise exception 'family_account_id is required';
  end if;
  if v_executed_trade_id is null then
    raise exception 'executed_trade_id is required';
  end if;
  /* unchanged from the definition this replaces — see the header on why it was not widened */
  if v_units_allocated is null or v_units_allocated <= 0 then
    raise exception 'units_allocated must be > 0';
  end if;

  /* the account has to exist: there is no FK on this column, so a typo wrote an orphan row that
     nothing would ever read and nothing would ever report */
  if not exists (select 1 from finance.family_accounts fa where fa.id = v_family_account_id) then
    raise exception 'no such family account';
  end if;

  select et.units_acquired, et.user_id
    into v_trade_units, v_trade_owner
    from finance.executed_trades et
   where et.id = v_executed_trade_id;
  if v_trade_units is null then
    raise exception 'no such trade';
  end if;
  if v_trade_owner <> v_uid then
    raise exception 'that trade is not yours to allocate';
  end if;

  /**
   * ⚠️ A SELL IS NEGATIVE UNITS, AND THIS FUNCTION USED TO ALLOCATE POSITIVE UNITS AGAINST ONE.
   * Since the allocation must be > 0, a trade with negative units can never be satisfied by this
   * path — and saying so names the function that can, rather than failing the size check below
   * with a sentence about arithmetic.
   */
  if v_trade_units < 0 then
    raise exception 'that is a sell — allocate it with admin_set_trade_allocation';
  end if;

  select coalesce(sum(al.units_allocated), 0) into v_already
    from finance.allocations al
   where al.executed_trade_id = v_executed_trade_id;

  /**
   * ⚠️ THE OVERFLOW CHECK IS THE REAL BUG UNDERNEATH THE MISSING ADMIN GATE. Nothing stopped a
   * trade of 5.73 units being allocated a hundred times over, which is units somebody is told
   * they own. The tolerance is 1e-9 of a share because an even split is a division — 33 shares of
   * `units_acquired / 33` need not re-sum to the penny in numeric — and a billionth of a share is
   * not a quantity anybody can hide anything inside.
   */
  if v_already + v_units_allocated > v_trade_units + 1e-9 then
    raise exception 'that is more than the trade has left (% of %, % already allocated)',
      v_units_allocated, v_trade_units, v_already;
  end if;

  insert into finance.allocations (
    user_id, family_account_id, executed_trade_id, units_allocated, created_at
  ) values (
    v_uid, v_family_account_id, v_executed_trade_id, v_units_allocated, now()
  )
  returning * into out_row;

  return out_row;
end;
$$;


ALTER FUNCTION "public"."insert_allocation"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_allocation"("uid" "uuid", "payload" "jsonb") RETURNS "finance"."allocations"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NOT NULL AND uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN public.insert_allocation(payload);
END;
$$;


ALTER FUNCTION "public"."insert_allocation"("uid" "uuid", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invite_to_park_room"("p_username" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rid uuid;
  them uuid;
begin
  select id into rid from public.park_rooms where owner = auth.uid();
  if rid is null then
    raise exception 'open a park first';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  select p.user_id into them from public.profiles p
  where lower(p.username::text) = lower(trim(p_username));
  if them is null then
    raise exception 'no such member';
  end if;
  insert into public.park_room_invites (room_id, user_id)
  values (rid, them) on conflict do nothing;
end;
$$;


ALTER FUNCTION "public"."invite_to_park_room"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invite_to_profile_room"("p_username" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rid uuid;
  guest uuid;
begin
  select id into rid from public.profile_rooms where owner = auth.uid();
  if rid is null then
    raise exception 'open your call first';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  select p.user_id into guest
    from public.profiles p
   where lower(p.username::text) = lower(trim(p_username))
     and coalesce(p.suspended, false) = false;
  if guest is null then
    raise exception 'no such member';
  end if;
  if guest = auth.uid() then
    return; -- inviting yourself to your own room is a no-op, not an error
  end if;
  insert into public.profile_room_invites (room_id, user_id)
  values (rid, guest)
  on conflict do nothing;
end;
$$;


ALTER FUNCTION "public"."invite_to_profile_room"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_suspended"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when p_user_id is null then false
    when p_user_id = auth.uid() or public.is_admin()
      then coalesce((select suspended from public.profiles where user_id = p_user_id), false)
    else null
  end;
$$;


ALTER FUNCTION "public"."is_suspended"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_suspended"("p_user_id" "uuid") IS 'Whether this account is suspended. ANSWERS ONLY ABOUT THE CALLER (or to an admin); any other question returns NULL, which carries no information and denies wherever it is used. NULL rather than an exception on purpose: this is evaluated inside 9 restrictive RLS policies, and a policy that throws is a broken page rather than a closed door.';



CREATE OR REPLACE FUNCTION "public"."item_reaches_anyone"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with t as (
    /* the tier it is actually SERVED at, the same clamp `can_see` applies on read -- a row
       stored above its owner's ceiling does not reach the people the stored value names */
    select least(coalesce(p_tier, 'private'::public.visibility_tier),
                 public.visibility_ceiling(p_owner)) as tier
  )
  select case
    when (select tier from t) in ('friends', 'members', 'public') then true
    when (select tier from t) = 'certain' then exists (
      select 1 from public.visibility_certain vc
       where vc.item_kind = p_item_kind
         and vc.item_id   = p_item_id
         and vc.owner     = p_owner
         /* a row whose friendship has ended grants nothing, so it does not count as reach */
         and coalesce(public.are_friends(p_owner, vc.friend), false))
    else false
  end;
$$;


ALTER FUNCTION "public"."item_reaches_anyone"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_circuit"("p_code" "text") RETURNS TABLE("id" "uuid", "name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare g circuit_groups;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  select * into g from circuit_groups where join_code = lower(btrim(p_code));
  if g.id is null then raise exception 'no circuit with that code'; end if;
  insert into circuit_group_members (group_id, user_id, role)
    values (g.id, auth.uid(), 'member') on conflict do nothing;
  perform public._circuit_add_self(g.id);
  return query select g.id, g.name;
end $$;


ALTER FUNCTION "public"."join_circuit"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leaderboard_no_score_drop"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.score < old.score then
    new.score := old.score;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."leaderboard_no_score_drop"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_circuit"("p_group" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if exists (select 1 from circuit_groups where id = p_group and created_by = auth.uid())
    then raise exception 'owner cannot leave their own circuit'; end if;
  delete from circuit_group_members where group_id = p_group and user_id = auth.uid();
end $$;


ALTER FUNCTION "public"."leave_circuit"("p_group" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."library_bodies"("p_slots" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'which ones?';
  end if;
  if jsonb_array_length(p_slots) > 400 then raise exception 'too many at once'; end if;
  if jsonb_array_length(p_slots) = 0 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', l.kind, 'name', l.name, 'body', l.body,
             'at', extract(epoch from l.updated_at) * 1000
           ))
      from public.member_library l
     where l.user_id = auth.uid()
       and exists (
         select 1 from jsonb_array_elements(p_slots) as want
          where want->>'kind' = l.kind
            and lower(btrim(want->>'name')) = lower(btrim(l.name))
       )
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."library_bodies"("p_slots" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."library_drop"("p_kind" "text", "p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.member_library
   where user_id = auth.uid() and kind = p_kind and lower(name) = lower(btrim(coalesce(p_name,'')));
end
$$;


ALTER FUNCTION "public"."library_drop"("p_kind" "text", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."library_index"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', l.kind, 'name', l.name,
             'at', extract(epoch from l.updated_at) * 1000
           ) order by l.updated_at desc)
      from public.member_library l
     where l.user_id = auth.uid()
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."library_index"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."library_list"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', l.kind, 'name', l.name, 'body', l.body,
             'at', extract(epoch from l.updated_at) * 1000
           ) order by l.updated_at desc)
      from public.member_library l
     where l.user_id = auth.uid()
  ), '[]'::jsonb);
end
$$;


ALTER FUNCTION "public"."library_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."library_put"("p_kind" "text", "p_name" "text", "p_body" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_count int;
  v_bytes bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  -- ⚠️ 'pet' is the addition. It carries nothing this function has to know about: the same
  -- per-item size cap, the same 400/20MB ceiling, the same case-insensitive slot.
  -- ⚠️ 'wins' is the second, and it is ONE row rather than one per record. The park keeps up to
  -- 200 win records; as separate rows they would eat half of a person's 400-item library to
  -- store about 18KB. They are also not separable the way a song is — nobody shares, renames or
  -- deletes a single record — so the honest shape is one document per arena, slot 'park'. The
  -- merge that decides whose copy wins is the client's (src/park/records.ts); this function
  -- stores what it is handed, exactly as it does for every other kind.
  if p_kind not in ('song','loop','art','look','pet','wins') then raise exception 'unknown kind'; end if;
  if v_name = '' then raise exception 'needs a name'; end if;
  if char_length(v_name) > 80 then v_name := left(v_name, 80); end if;
  if p_body is null then raise exception 'nothing to keep'; end if;
  if octet_length(p_body::text) > 131072 then raise exception 'that one is too big to keep'; end if;

  select count(*), coalesce(sum(octet_length(body::text)), 0)
    into v_count, v_bytes
    from public.member_library
   where user_id = auth.uid()
     and not (kind = p_kind and lower(name) = lower(v_name));   -- a replacement is not a new row

  if v_count >= 400 then raise exception 'your library is full — delete something first'; end if;
  if v_bytes + octet_length(p_body::text) > 20971520 then
    raise exception 'your library is full — delete something first';
  end if;

  insert into public.member_library (user_id, kind, name, body, updated_at)
  values (auth.uid(), p_kind, v_name, p_body, now())
  on conflict (user_id, kind, lower(name))
  do update set body = excluded.body, name = excluded.name, updated_at = now();
end
$$;


ALTER FUNCTION "public"."library_put"("p_kind" "text", "p_name" "text", "p_body" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_snake_names_to_accounts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer;
begin
  update public.player_registry r
     set user_id = p.user_id
    from public.profiles p
   where r.user_id is null
     and lower(r.player_name::text) = lower(p.username::text);
  get diagnostics n = row_count;
  return n;
end;
$$;


ALTER FUNCTION "public"."link_snake_names_to_accounts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_achievements"("p_username" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_tier public.visibility_tier;
  -- the counts every rule below is written against, gathered once
  v_days int;
  v_streak int;
  v_ratings int;
  v_written int;
  v_snake int;
  v_best int;
  v_gold int;
  v_blocks int;
  v_art int;
  v_song int;
  v_viz int;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;
  select p.user_id, p.activity_visibility into v_target, v_tier
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  -- the same gate get_member_trophies uses: a page you cannot see has no achievements to show
  if v_target is null or not public.can_see_item(v_target, v_tier, 'profile_activity', v_target::text) then return '[]'::jsonb; end if;

  select count(distinct l.date) into v_days
  from public.circuit_logs l
  join public.circuit_people cp on cp.id = l.person_id
  where cp.owner_user_id = v_target;

  /**
   * The longest run of consecutive days, by the oldest trick there is: subtract a row number
   * from the date, and every unbroken run collapses to the same value.
   */
  select coalesce(max(n), 0) into v_streak
  from (
    select count(*) as n
    from (
      select l.date, l.date - (row_number() over (order by l.date))::int as grp
      from (
        select distinct l.date
        from public.circuit_logs l
        join public.circuit_people cp on cp.id = l.person_id
        where cp.owner_user_id = v_target
      ) l
    ) g
    group by g.grp
  ) runs;

  select count(*), count(*) filter (where r.review is not null)
    into v_ratings, v_written
  from public.circuit_ratings r where r.user_id = v_target;

  select count(*), coalesce(max(lb.score), 0) into v_snake, v_best
  from public.leaderboard lb
  join public.player_registry reg on reg.id = lb.player_id
  where reg.user_id = v_target;

  select count(*) into v_gold
  from public.trophies tr
  join public.leaderboard lb on lb.id = tr.leaderboard_id
  join public.player_registry reg on reg.id = lb.player_id
  where reg.user_id = v_target and tr.trophy_name = 'gold';

  select count(*),
         count(*) filter (where b.block_type = 'art'),
         count(*) filter (where b.block_type = 'song'),
         count(*) filter (where b.block_type = 'visualizer')
    into v_blocks, v_art, v_song, v_viz
  from public.profile_blocks b where b.user_id = v_target;

  -- module, code, label, what it takes, how far along
  return jsonb_build_array(
    -- ⚠️ CALIBRATED AGAINST THE REAL BOARD, not picked out of the air. Measured first: 224 days
    -- logged for one person, a 95-day streak for another, 145 ratings for a third, and a Snake
    -- median of 36 against a best of 310. Tiers set below those numbers would all be earned the
    -- moment this shipped, which is the same as having none.
    jsonb_build_object('module','circuit','code','first_day','label','On the board',
      'note','Log a day on the Circuit','goal',1,'have',v_days),
    jsonb_build_object('module','circuit','code','days_25','label','Regular',
      'note','Log twenty-five days','goal',25,'have',v_days),
    jsonb_build_object('module','circuit','code','days_100','label','Committed',
      'note','Log a hundred days','goal',100,'have',v_days),
    jsonb_build_object('module','circuit','code','days_250','label','Year of it',
      'note','Log two hundred and fifty days','goal',250,'have',v_days),
    jsonb_build_object('module','circuit','code','streak_week','label','Seven straight',
      'note','Log seven days in a row','goal',7,'have',v_streak),
    jsonb_build_object('module','circuit','code','streak_month','label','A month unbroken',
      'note','Log thirty days in a row','goal',30,'have',v_streak),
    jsonb_build_object('module','circuit','code','streak_90','label','Did not miss',
      'note','Log ninety days in a row','goal',90,'have',v_streak),

    jsonb_build_object('module','snake','code','first_score','label','Played',
      'note','Put a score on the board','goal',1,'have',v_snake),
    -- the median game is 36, so this is "a good one" rather than "any one"
    jsonb_build_object('module','snake','code','score_75','label','Getting long',
      'note','Score seventy-five','goal',75,'have',v_best),
    jsonb_build_object('module','snake','code','score_200','label','Enormous',
      'note','Score two hundred','goal',200,'have',v_best),
    jsonb_build_object('module','snake','code','gold','label','Gold',
      'note','Top a round','goal',1,'have',v_gold),

    jsonb_build_object('module','reviewer','code','first_rating','label','Critic',
      'note','Rate something','goal',1,'have',v_ratings),
    jsonb_build_object('module','reviewer','code','ratings_50','label','Well watched',
      'note','Rate fifty things','goal',50,'have',v_ratings),
    jsonb_build_object('module','reviewer','code','ratings_200','label','Seen everything',
      'note','Rate two hundred things','goal',200,'have',v_ratings),
    jsonb_build_object('module','reviewer','code','wrote_one','label','In your own words',
      'note','Write an actual review, not just a score','goal',1,'have',v_written),

    jsonb_build_object('module','profile','code','made_page','label','Moved in',
      'note','Put something on your page','goal',1,'have',v_blocks),
    jsonb_build_object('module','profile','code','five_blocks','label','Decorated',
      'note','Five things on your page','goal',5,'have',v_blocks),

    jsonb_build_object('module','paint','code','kept_art','label','Framed',
      'note','Put a drawing on your page','goal',1,'have',v_art),
    jsonb_build_object('module','instrument','code','kept_song','label','Songwriter',
      'note','Put a song you made on your page','goal',1,'have',v_song),
    jsonb_build_object('module','visual','code','kept_look','label','Set designer',
      'note','Put a visualiser look on your page','goal',1,'have',v_viz)
  );
end;
$$;


ALTER FUNCTION "public"."list_achievements"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_activity_notices"() RETURNS TABLE("kind" "text", "actor" "text", "subject" "text", "detail" "text", "at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with me as (select auth.uid() as uid),
  seen as (
    select coalesce(
      (select ar.seen_at from public.activity_reads ar, me where ar.user_id = me.uid),
      now() - interval '30 days'   -- first run: a sensible window, not the whole archive
    ) as since
  ),
  -- logs belonging to a person I own
  mine as (
    select l.id, l.date
    from public.circuit_logs l
    join public.circuit_people p on p.id = l.person_id
    join me on p.owner_user_id = me.uid
  )
  select 'kudos', r.author_name, m.date::text, r.emoji, r.created_at
  from public.circuit_log_reactions r
  join mine m on m.id = r.log_id, me, seen
  where r.user_id <> me.uid and r.created_at > seen.since
  union all
  select 'comment', c.author_name, m.date::text, c.body, c.created_at
  from public.circuit_log_comments c
  join mine m on m.id = c.log_id, me, seen
  where c.user_id <> me.uid and c.created_at > seen.since
  union all
  select 'join', coalesce(pr.first_name, pr.username::text), g.name, null, gm.joined_at
  from public.circuit_group_members gm
  join public.circuit_groups g on g.id = gm.group_id
  join public.profiles pr on pr.user_id = gm.user_id, me, seen
  where gm.user_id <> me.uid
    and gm.joined_at > seen.since
    and exists (
      select 1 from public.circuit_group_members mine_gm
      where mine_gm.group_id = gm.group_id and mine_gm.user_id = me.uid
    )
  union all
  -- someone wrote on my page. `subject` carries MY username so the bell can link straight there.
  select 'guestbook',
         coalesce(ap.first_name, ap.username::text),
         myp.username::text,
         n.body,
         n.created_at
  from public.profile_notes n
  join public.profiles ap on ap.user_id = n.author_user_id
  join me on n.profile_user_id = me.uid
  join public.profiles myp on myp.user_id = me.uid, seen
  where n.author_user_id <> me.uid and n.created_at > seen.since
  union all
  -- ticked into a pool by name
  select 'pool', public.display_name(p.owner_user_id), p.id::text, p.name, pp.added_at
  from public.pool_people pp
  join public.pools p on p.id = pp.pool_id, me, seen
  where pp.user_id = me.uid
    and p.owner_user_id <> me.uid
    and pp.added_at > seen.since
  union all
  -- a friend made a pool aimed at their friends, which includes you
  select 'pool', public.display_name(p.owner_user_id), p.id::text, p.name, p.created_at
  from public.pools p, me, seen
  where p.audience = 'friends'
    and p.owner_user_id <> me.uid
    and p.created_at > seen.since
    and public.are_friends(me.uid, p.owner_user_id)
  order by 5 desc
  limit 30;
$$;


ALTER FUNCTION "public"."list_activity_notices"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_chat_overview"() RETURNS TABLE("id" "uuid", "kind" "text", "name" "text", "last_body" "text", "last_author" "text", "last_at" timestamp with time zone, "unread" integer, "peer_user_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.kind,
         case r.kind
           when 'lounge' then 'The Lounge'
           when 'dm' then coalesce((
             select coalesce(p.first_name, p.username::text)
             from public.chat_room_members m
             join public.profiles p on p.user_id = m.user_id
             where m.room_id = r.id and m.user_id <> auth.uid()
             limit 1), 'DM')
           else coalesce(g.name, 'Chat')
         end as name,
         lm.body, lm.author_name, lm.created_at,
         coalesce(u.n, 0)::int as unread,
         -- the new column: who the other person in a DM actually IS. Null for every other kind
         -- of room, because "the peer" is not a thing a group chat has.
         case when r.kind = 'dm' then (
           select m.user_id
           from public.chat_room_members m
           where m.room_id = r.id and m.user_id <> auth.uid()
           limit 1
         ) end as peer_user_id
  from public.chat_rooms r
  left join public.circuit_groups g on g.id = r.group_id
  left join lateral (
    select m.body, m.author_name, m.created_at
    from public.chat_messages m
    where m.room_id = r.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as n
    from public.chat_messages m
    where m.room_id = r.id
      -- `is distinct from` rather than <>: a message whose author deleted their account has no
      -- id on either side, and that is somebody else's message, not nobody's.
      and m.user_id is distinct from auth.uid()
      and not exists (select 1 from public.lounge_message_authors a
                      where a.message_id = m.id and a.user_id = auth.uid())
      and m.created_at > coalesce(
        (select cr.last_read_at from public.chat_reads cr
         where cr.room_id = r.id and cr.user_id = auth.uid()),
        '-infinity'::timestamptz)
  ) u on true
  where public.chat_room_member(r.id)
  order by lm.created_at desc nulls last, r.kind, 3;
$$;


ALTER FUNCTION "public"."list_chat_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_friends"() RETURNS TABLE("username" "text", "name" "text", "status" "text", "direction" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.username::text,
         coalesce(p.first_name, p.username::text),
         f.status,
         case when f.requested_by = auth.uid() then 'out' else 'in' end
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where auth.uid() in (f.user_a, f.user_b)
  order by f.status desc, 2;
$$;


ALTER FUNCTION "public"."list_friends"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_fund_symbols"() RETURNS TABLE("symbol" "text", "asset_type" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
begin
  if not (public.is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'admin only';
  end if;
  return query
    select s.symbol, s.asset_type
      from (
        select distinct et.asset_symbol as symbol,
               coalesce(et.asset_type, 'stock') as asset_type
          from finance.executed_trades et
      ) s
      left join finance.price_cache pc on pc.asset_symbol = s.symbol
     order by pc.updated_at asc nulls first;
end
$$;


ALTER FUNCTION "public"."list_fund_symbols"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_invites"() RETURNS TABLE("id" "uuid", "token" "uuid", "class" "text", "label" "text", "used_at" timestamp with time zone, "created_at" timestamp with time zone, "accepted_username" "text", "expires_at" timestamp with time zone, "state" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select i.id, i.token, i.class, i.label, i.used_at, i.created_at,
         p.username::text,
         i.expires_at,
         case
           when i.used_at is not null then 'used'
           when i.expires_at is not null and i.expires_at <= now() then 'expired'
           else 'live'
         end
  from public.invites i
  left join public.profiles p on p.user_id = i.used_by
  where public.is_admin()
  order by i.created_at desc;
$$;


ALTER FUNCTION "public"."list_invites"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_member_directory"() RETURNS TABLE("user_id" "uuid", "username" "text", "name" "text", "is_friend" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.user_id, p.username::text,
         coalesce(p.first_name, p.username::text),
         public.are_friends(auth.uid(), p.user_id)
  from public.profiles p
  where coalesce(p.suspended, false) = false
    and p.user_id <> auth.uid()
    and exists (select 1 from public.profiles me
                where me.user_id = auth.uid() and coalesce(me.suspended, false) = false)
    and (
      exists (
        select 1 from public.friendships f
        where (f.user_a = least(auth.uid(), p.user_id) and f.user_b = greatest(auth.uid(), p.user_id))
      )
      or exists (
        select 1
        from public.circuit_group_members mine
        join public.circuit_group_members theirs on theirs.group_id = mine.group_id
        where mine.user_id = auth.uid() and theirs.user_id = p.user_id
      )
    )
  order by 4 desc, 3;
$$;


ALTER FUNCTION "public"."list_member_directory"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_members"() RETURNS TABLE("user_id" "uuid", "username" "text", "display_name" "text", "email" "text", "role" "text", "created_at" timestamp with time zone, "suspended" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  return query
  select ur.user_id,
         p.username::text,
         coalesce(p.first_name, split_part(au.email, '@', 1)) as display_name,
         coalesce(p.email, au.email) as email,
         ur.role,
         au.created_at,
         coalesce(p.suspended, false) as suspended
  from public.user_roles ur
  left join public.profiles p on p.user_id = ur.user_id
  left join auth.users au on au.id = ur.user_id
  where ur.role in ('family','friend','admin')
  order by ur.role, au.created_at;
end;
$$;


ALTER FUNCTION "public"."list_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_park_room_invites"() RETURNS TABLE("username" "text", "name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.username::text, coalesce(p.first_name, p.username::text)
  from public.park_room_invites i
  join public.park_rooms r on r.id = i.room_id
  join public.profiles p on p.user_id = i.user_id
  where r.owner = auth.uid()
  order by 2;
$$;


ALTER FUNCTION "public"."list_park_room_invites"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_profile_notes"("p_username" "text", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select user_id into v_owner from public.profiles
   where lower(username) = lower(p_username) and coalesce(suspended, false) = false;
  if v_owner is null or not public.guestbook_open_to(v_owner) then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id,
             'body', n.body,
             'at', n.created_at,
             'author', coalesce(p.first_name, p.username::text),
             'author_username', p.username::text,
             -- so the client can show a delete control without a second round trip. The owner of
             -- the PAGE can remove anything on it; an author can always take back their own.
             'can_delete', (n.author_user_id = auth.uid() or v_owner = auth.uid())
           ) order by n.created_at desc)
    from public.profile_notes n
    join public.profiles p on p.user_id = n.author_user_id
    where n.profile_user_id = v_owner
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."list_profile_notes"("p_username" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_profile_room_invites"() RETURNS TABLE("username" "text", "name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.username::text, coalesce(p.first_name, p.username::text)
  from public.profile_room_invites i
  join public.profile_rooms r on r.id = i.room_id
  join public.profiles p on p.user_id = i.user_id
  where r.owner = auth.uid()
  order by 2;
$$;


ALTER FUNCTION "public"."list_profile_room_invites"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_room_messages"("p_room" "uuid", "p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "room_id" "uuid", "created_at" timestamp with time zone, "body" "text", "author_name" "text", "author_user_id" "uuid", "author_username" "text", "mine" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.id,
         m.room_id,
         m.created_at,
         m.body,
         m.author_name,
         -- null in the lounge by construction: the column itself holds nothing there
         m.user_id,
         case when r.kind = 'lounge' then null else p.username::text end,
         case
           when r.kind = 'lounge'
             then exists (select 1 from public.lounge_message_authors a
                          where a.message_id = m.id and a.user_id = auth.uid())
           else m.user_id = auth.uid()
         end
  from public.chat_messages m
  join public.chat_rooms r on r.id = m.room_id
  left join public.profiles p on p.user_id = m.user_id
  where m.room_id = p_room
    and public.chat_room_member(p_room)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;


ALTER FUNCTION "public"."list_room_messages"("p_room" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_activity_seen"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.activity_reads (user_id, seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now();
end;
$$;


ALTER FUNCTION "public"."mark_activity_seen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_room_read"("p_room" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- still gated on real membership, so this can't be used to probe rooms you can't see
  if not public.chat_room_member(p_room) then raise exception 'not in this room'; end if;
  insert into public.chat_reads (user_id, room_id, last_read_at)
  values (auth.uid(), p_room, now())
  on conflict (user_id, room_id) do update set last_read_at = now();
end;
$$;


ALTER FUNCTION "public"."mark_room_read"("p_room" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."may_i_publish_a_page"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.may_publish_a_page(auth.uid());
$$;


ALTER FUNCTION "public"."may_i_publish_a_page"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."may_i_publish_a_page"() IS 'Whether the CALLER may publish a page. Same reasoning as my_visibility_ceiling.';



CREATE OR REPLACE FUNCTION "public"."may_publish_a_page"("p_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.admin_users a where a.user_id = p_owner);
$$;


ALTER FUNCTION "public"."may_publish_a_page"("p_owner" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."may_publish_a_page"("p_owner" "uuid") IS 'Whether this owner may set public_page. SEPARATE FROM visibility_ceiling ON PURPOSE: publishing a page and choosing a level are two switches that are allowed to disagree, which is why three of Joshs blocks are marked public on a page nobody outside can load. Folding this into the ceiling would re-create that bug the next time somebody simplifies two near-identical checks. Today: admin only. Later: any established adult, never a minor -- one line, here.';



CREATE OR REPLACE FUNCTION "public"."movie_visible"("p_movie" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  /* ⚠️ A FILM NEEDS THE GROUP, NOT A FRIEND. This used to end
         or are_friends(auth.uid(), r.user_id)
     so a film reached you because somebody you know rated it -- even if you had never been in
     the group that watched it. A film belongs to the GROUP it was watched in, not to whoever
     happened to rate it.

     ⚠️ `r.user_id = auth.uid()` STAYS: somebody who leaves a group must keep seeing the ratings
     they wrote. `m.created_by = auth.uid()` is the same idea for a film with no group at all --
     a just-me pick from a just-me pool, which nobody else should see and its own maker must. */
  select exists (
    select 1 from public.circuit_movies m
    where m.id = p_movie
      and (
        public.circuit_is_member(m.group_id)
        or m.created_by = auth.uid()
        or exists (
          select 1 from public.circuit_ratings r
          where r.movie_id = m.id and r.user_id = auth.uid())
      )
  );
$$;


ALTER FUNCTION "public"."movie_visible"("p_movie" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_account"() RETURNS TABLE("suspended" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce((select p.suspended from public.profiles p where p.user_id = auth.uid()), false);
$$;


ALTER FUNCTION "public"."my_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_circuits"() RETURNS TABLE("id" "uuid", "name" "text", "join_code" "text", "role" "text", "member_count" bigint, "is_owner" boolean, "nickname" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select g.id, g.name,
         case when g.created_by = auth.uid() then g.join_code else null end,
         m.role,
         (select count(*) from circuit_group_members x where x.group_id = g.id),
         (g.created_by = auth.uid()),
         m.nickname
  from circuit_group_members m
  join circuit_groups g on g.id = m.group_id
  where m.user_id = auth.uid()
  order by g.created_at;
$$;


ALTER FUNCTION "public"."my_circuits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_features"() RETURNS TABLE("feature" "text", "enabled" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_admin boolean := public.is_admin();
  v_role text := coalesce((select ur.role from public.user_roles ur where ur.user_id = auth.uid()), 'friend');
begin
  return query
  select f.feature,
         coalesce(
           (select af.enabled from public.account_features af
              where af.user_id = auth.uid() and af.feature = f.feature),
           f.default_enabled
         ) as enabled
  from (values ('finance', (v_admin or v_role = 'family'))) as f(feature, default_enabled);
end;
$$;


ALTER FUNCTION "public"."my_features"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_fund_status"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_ready boolean;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- with nothing declared there is no honest answer, and the UI must say so rather than
  -- render a confident zero
  select exists (select 1 from finance.family_contributions) into v_ready;

  select jsonb_build_object(
    'ready', v_ready,
    'accounts', coalesce(jsonb_agg(a order by a->>'name'), '[]'::jsonb)
  ) into v_result
  from (
    select jsonb_build_object(
      'id', fa.id,
      'name', fa.display_name,
      'startDate', fa.start_date,
      'dollarPerDay', fa.dollar_per_day,
      -- fund_today(), not current_date: see the note at the top of this migration
      'promised', round(fa.dollar_per_day * greatest(0, (finance.fund_today() - fa.start_date)), 2),
      'contributed', coalesce((
        select round(sum(
                 c.amount / greatest(1, (
                   select count(*) from finance.family_accounts fb
                   where fb.start_date <= c.contributed_on
                 ))
               ), 2)
        from finance.family_contributions c
        where c.contributed_on >= fa.start_date
      ), 0)
    ) as a
    from finance.family_accounts fa
    where fa.user_id = v_uid
  ) sub;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."my_fund_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_lounge_display_name"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(p.lounge_display_name, p.first_name, p.username::text)
  from public.profiles p where p.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."my_lounge_display_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_lounge_opt_in"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select lounge_opt_in from public.profiles where user_id = auth.uid()), false);
$$;


ALTER FUNCTION "public"."my_lounge_opt_in"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_park_room"() RETURNS TABLE("room_id" "uuid", "map_name" "text", "audience" "text", "open_since" timestamp with time zone, "host" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, m.name, r.audience::text, r.open_at, p.username::text
  from public.park_rooms r
  join public.park_maps m on m.id = r.map_id
  join public.profiles p on p.user_id = r.owner
  where r.owner = auth.uid();
$$;


ALTER FUNCTION "public"."my_park_room"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_profile_writable_columns"() RETURNS TABLE("col" "text", "written_by" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select * from (values
    ('first_name, middle_name, last_name, email, phone, birthday, address, venmo, cashapp, zelle', 'update_my_profile'),
    ('nickname, circuit_nickname, snake_nickname', 'set_my_nicknames'),
    ('activity_visibility', 'set_my_activity_visibility'),
    ('public_page', 'set_my_public_page'),
    ('lounge_opt_in', 'set_lounge_opt_in'),
    ('lounge_display_name', 'set_lounge_display_name'),
    ('page_style', 'set_my_page_style'),
    ('profile_look', 'set_my_profile_look'),
    ('suspended', 'admin_set_suspended (admin only)'),
    ('age_band, feed_opt_in', 'admin_set_feed_consent (admin only)'),
    ('username, first_name, email, role', 'admin_update_member (admin only)')
  ) as t(col, written_by);
$$;


ALTER FUNCTION "public"."my_profile_writable_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_snake_handles"() RETURNS TABLE("player_name" "text", "visibility" "public"."visibility_tier")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.player_name::text, r.visibility
  from public.player_registry r
  where auth.uid() is not null and r.user_id = auth.uid()
  order by r.player_name;
$$;


ALTER FUNCTION "public"."my_snake_handles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_visibility_ceiling"() RETURNS "public"."visibility_tier"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.visibility_ceiling(auth.uid());
$$;


ALTER FUNCTION "public"."my_visibility_ceiling"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."my_visibility_ceiling"() IS 'The widest level the CALLER may choose. The (uuid) form is not callable by members: asked about somebody else it answers whether they are an admin and whether their age has been established, which is nobody else''s business. This form takes no argument and so cannot be pointed at anybody.';



CREATE OR REPLACE FUNCTION "public"."my_visibility_circles"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  /* ⚠️ A MEMBER WHOSE FRIENDSHIP ENDED IS COUNTED, NOT NAMED. The first version listed them with
     `friend: false`, on the reasoning that an owner who cannot see a row cannot tidy it away.
     That reasoning is right about the tidying and wrong about the naming: the row grants nothing,
     and rendering somebody's CURRENT username and first name keeps a small window open onto a
     person who is no longer a friend, which gets wider every time they change either. So the
     count says there is something to tidy, `visibility_circle_drop_ex_friends` does the tidying,
     and nobody's live profile is read out to settle a row that means nothing. */
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'created_at', c.created_at,
        'members', coalesce(m.members, '[]'::jsonb),
        'ex_friends', coalesce(m.ex, 0)
      ) order by lower(c.name)
    ),
    '[]'::jsonb)
  from public.visibility_circles c
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'username', p.username::text,
               'name', coalesce(p.first_name, p.username::text)
             ) order by lower(coalesce(p.first_name, p.username::text))
           ) filter (where coalesce(public.are_friends(c.owner, vm.member), false)) as members,
           count(*) filter (where not coalesce(public.are_friends(c.owner, vm.member), false)) as ex
      from public.visibility_circle_members vm
      join public.profiles p on p.user_id = vm.member
     where vm.circle_id = c.id
  ) m on true
  where c.owner = auth.uid();
$$;


ALTER FUNCTION "public"."my_visibility_circles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."only_the_admin_demos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.is_demo and not exists (select 1 from public.admin_users a where a.user_id = new.user_id) then
    raise exception 'is_demo is the site owner''s row only';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."only_the_admin_demos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_dm"("p_username" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_them uuid := public.uid_for_username(p_username);
  v_room uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_them is null then raise exception 'no such member'; end if;
  if not public.are_friends(v_me, v_them) then raise exception 'friends only'; end if;
  select r.id into v_room
  from public.chat_rooms r
  where r.kind = 'dm'
    and exists (select 1 from public.chat_room_members m where m.room_id = r.id and m.user_id = v_me)
    and exists (select 1 from public.chat_room_members m where m.room_id = r.id and m.user_id = v_them);
  if v_room is not null then return v_room; end if;
  insert into public.chat_rooms (kind) values ('dm') returning id into v_room;
  insert into public.chat_room_members (room_id, user_id) values (v_room, v_me), (v_room, v_them);
  return v_room;
end;
$$;


ALTER FUNCTION "public"."open_dm"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_park_room"("p_name" "text", "p_audience" "public"."visibility_tier") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rid uuid;
  mid uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  -- ⚠️ refuse rather than clamp, exactly as open_profile_room does: quietly narrowing an
  -- audience tells the caller their room is wider than it is, and quietly widening is worse.
  -- 'public' is not offered — a park is for members, and the relay has no anonymous door.
  if p_audience not in ('friends', 'members', 'private') then
    raise exception 'a park is friends, members or private, not %', p_audience;
  end if;
  if exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and coalesce(p.suspended, false) = true) then
    raise exception 'account suspended';
  end if;

  select m.id into mid
  from public.park_maps m
  where m.owner = auth.uid() and m.name = trim(p_name);
  if mid is null then
    raise exception 'publish that map before hosting it';
  end if;

  insert into public.park_rooms (owner, map_id, audience, open_at)
  values (auth.uid(), mid, p_audience, now())
  on conflict (owner) do update
    set map_id = excluded.map_id,
        audience = excluded.audience,
        open_at = now()
  returning id into rid;
  return rid;
end;
$$;


ALTER FUNCTION "public"."open_park_room"("p_name" "text", "p_audience" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_park_rooms"() RETURNS TABLE("host" "text", "map_name" "text", "audience" "text", "open_since" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.username::text, m.name, r.audience::text, r.open_at
  from public.park_rooms r
  join public.profiles p on p.user_id = r.owner
  join public.park_maps m on m.id = r.map_id
  where r.open_at is not null
    and r.owner <> auth.uid()
    and public.park_room_member(r.id)
  order by r.open_at desc
  limit 50;
$$;


ALTER FUNCTION "public"."open_park_rooms"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_profile_room"("p_audience" "public"."visibility_tier") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rid uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  -- refuse rather than clamp: silently turning 'public' into 'friends' would tell the caller
  -- their call is narrower than it is, and silently allowing it would be worse
  if p_audience not in ('friends', 'private') then
    raise exception 'a profile call is friends or private, not %', p_audience;
  end if;
  if exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and coalesce(p.suspended, false) = true) then
    raise exception 'account suspended';
  end if;

  insert into public.profile_rooms (owner, audience, open_at)
  values (auth.uid(), p_audience, now())
  on conflict (owner) do update
    set audience = excluded.audience,
        open_at = coalesce(public.profile_rooms.open_at, excluded.open_at)
  returning id into rid;
  return rid;
end;
$$;


ALTER FUNCTION "public"."open_profile_room"("p_audience" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owns_item"("p_kind" "text", "p_id" "text", "p_owner" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if p_owner is null or p_id is null then return false; end if;
  case p_kind
    when 'profile_block' then
      return exists (select 1 from public.profile_blocks b
                      where b.id::text = p_id and b.user_id = p_owner);
    when 'chronicle_activity' then
      return exists (select 1 from public.chronicle_activities a
                      where a.id::text = p_id and a.owner = p_owner);
    when 'chronicle_goal' then
      return exists (select 1 from public.chronicle_goals g
                      where g.id::text = p_id and g.owner = p_owner);
    when 'circuit_person' then
      return exists (select 1 from public.circuit_people c
                      where c.id = p_id and c.owner_user_id = p_owner);
    when 'player_registry' then
      return exists (select 1 from public.player_registry r
                      where r.id::text = p_id and r.user_id = p_owner);
    when 'profile_activity' then
      /* the "item" is the member's own activity stream, so the id IS the owner */
      return p_id = p_owner::text;
    else
      return false;
  end case;
exception when others then
  /* a malformed id (a non-uuid where a uuid is expected) is not an ownership claim */
  return false;
end $$;


ALTER FUNCTION "public"."owns_item"("p_kind" "text", "p_id" "text", "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."park_map_drop"("p_name" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  delete from public.park_maps m
  where m.owner = auth.uid() and m.name = trim(p_name);
$$;


ALTER FUNCTION "public"."park_map_drop"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."park_map_get"("p_name" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.body from public.park_maps m
  where m.owner = auth.uid() and m.name = trim(p_name);
$$;


ALTER FUNCTION "public"."park_map_get"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."park_map_mine"() RETURNS TABLE("id" "uuid", "name" "text", "bytes" integer, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.id, m.name, octet_length(m.body::text), m.updated_at
  from public.park_maps m
  where m.owner = auth.uid()
  order by m.updated_at desc;
$$;


ALTER FUNCTION "public"."park_map_mine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."park_map_put"("p_name" "text", "p_body" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  mid uuid;
  mine int;
  held bigint;
  coming int;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and coalesce(p.suspended, false) = true) then
    raise exception 'account suspended';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a map needs a name';
  end if;

  coming := octet_length(p_body::text);

  -- ⚠️ BOTH COUNTED EXCLUDING THE NAME BEING WRITTEN, so saving over a map you already have is
  -- never refused for being one too many, nor for bytes you are about to replace.
  select count(*), coalesce(sum(octet_length(m.body::text)), 0)
    into mine, held
  from public.park_maps m
  where m.owner = auth.uid() and m.name <> trim(p_name);

  if mine >= 16 then
    raise exception 'that is sixteen maps already — delete one first';
  end if;
  if held + coming > 12582912 then
    raise exception 'that would be more than 12MB of maps — delete one to make room';
  end if;

  insert into public.park_maps (owner, name, body, updated_at)
  values (auth.uid(), trim(p_name), p_body, now())
  on conflict (owner, name) do update
    set body = excluded.body, updated_at = now()
  returning id into mid;
  return mid;
end;
$$;


ALTER FUNCTION "public"."park_map_put"("p_name" "text", "p_body" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."park_room_member"("p_room" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.park_rooms r
    join public.profiles me on me.user_id = auth.uid()
    where r.id = p_room
      and coalesce(me.suspended, false) = false
      and (
        r.owner = auth.uid()
        or (
          r.open_at is not null
          and (
            (r.audience = 'friends' and public.are_friends(auth.uid(), r.owner))
            or (r.audience = 'members')
            or exists (
              select 1 from public.park_room_invites i
              where i.room_id = r.id and i.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."park_room_member"("p_room" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_alt"("p_id" "uuid", "p_alt" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.member_pictures
     set alt = nullif(btrim(coalesce(p_alt, '')), '')
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such picture'; end if;
end $$;


ALTER FUNCTION "public"."picture_alt"("p_id" "uuid", "p_alt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_claim"("p_mime" "text", "p_bytes" integer, "p_thumb_bytes" integer, "p_w" integer, "p_h" integer, "p_alt" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid; v_key text; v_thumb text; v_ext text; v_count int; v_bytes bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  /* ⚠️ A CLAIM THAT NEVER BECAME AN UPLOAD MUST NOT HOLD QUOTA FOR EVER. The browser asks for a
     key, then PUTs to R2, then says ready. Anything in between can fail — a closed tab, a dead
     connection — and the row would otherwise sit counting against a ceiling for a picture that
     does not exist. An hour is far longer than any upload and far shorter than noticing. */
  delete from public.member_pictures
   where owner = auth.uid() and not ready and created_at < now() - interval '1 hour';

  v_ext := case p_mime
             when 'image/webp' then 'webp' when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'  when 'image/avif' then 'avif' end;
  if v_ext is null then raise exception 'that is not a kind of picture this keeps'; end if;

  /**
   * ⚠️ A CHECK CONSTRAINT IS NOT A SENTENCE. The two ceilings below are also
   * `member_pictures_bytes_sane` and `member_pictures_thumb_sane`, and left to the table they
   * reach a person as "new row for relation member_pictures violates check constraint
   * member_pictures_bytes_sane" — which the edge function passes straight through, because it
   * passes refusals through on purpose so the readable ones stay readable.
   *
   * The constraints stay: they are the backstop, and they are what makes the rule true for
   * any path that ever writes here. These are only the wording.
   */
  if p_bytes is null or p_bytes < 1 then raise exception 'that picture came to nothing'; end if;
  if p_bytes > 2097152 then
    raise exception 'that one is over 2 MB even squeezed — try a lower quality';
  end if;
  if p_thumb_bytes is null or p_thumb_bytes < 1 or p_thumb_bytes > 262144 then
    raise exception 'that one would not make a thumbnail';
  end if;
  if p_w is null or p_h is null or p_w < 1 or p_h < 1 then
    raise exception 'that picture has no size';
  end if;

  /* ⚠️ COUNTED WITH THE THUMBNAIL, because the thumbnail is real storage too. Both ceilings count
     OTHER ROWS, which is why neither can be a CHECK — the same reason the 200-activity and
     500-goal ceilings live in their functions. This is the only path that inserts here, which is
     what makes that safe; a second one would have to keep them too. */
  select count(*), coalesce(sum(bytes + thumb_bytes), 0) into v_count, v_bytes
    from public.member_pictures where owner = auth.uid();

  if v_count >= 500 then raise exception 'that is 500 pictures — delete one first'; end if;
  if v_bytes + p_bytes + p_thumb_bytes > 52428800 then
    raise exception 'your pictures come to 50 MB — delete one first';
  end if;

  /* ⚠️ THE KEY IS MINTED HERE, from a uuid, and never from a filename. A person's own words in
     an object key are a path-traversal question nobody needs to answer, and the owner's id as the
     first segment means a stray listing is still fenced by person. */
  v_id    := gen_random_uuid();
  v_key   := auth.uid()::text || '/' || v_id::text || '.' || v_ext;
  v_thumb := auth.uid()::text || '/' || v_id::text || '-t.' || v_ext;

  insert into public.member_pictures (id, owner, key, thumb_key, mime, bytes, thumb_bytes, w, h, alt)
  values (v_id, auth.uid(), v_key, v_thumb, p_mime, p_bytes, p_thumb_bytes, p_w, p_h,
          nullif(btrim(coalesce(p_alt, '')), ''));

  return jsonb_build_object('id', v_id, 'key', v_key, 'thumb_key', v_thumb);
end $$;


ALTER FUNCTION "public"."picture_claim"("p_mime" "text", "p_bytes" integer, "p_thumb_bytes" integer, "p_w" integer, "p_h" integer, "p_alt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_drop"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_key text; v_thumb text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.member_pictures where id = p_id and owner = auth.uid()
    returning key, thumb_key into v_key, v_thumb;
  if v_key is null then raise exception 'no such picture'; end if;
  return jsonb_build_object('key', v_key, 'thumb_key', v_thumb);
end $$;


ALTER FUNCTION "public"."picture_drop"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_orphan_log"("p_owner" "uuid", "p_key" "text", "p_thumb_key" "text", "p_which" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if p_owner is null or nullif(btrim(coalesce(p_key, '')), '') is null then
    raise exception 'an orphan needs an owner and a key';
  end if;
  insert into public.picture_orphans (owner, key, thumb_key, which)
  values (p_owner,
          btrim(p_key),
          nullif(btrim(coalesce(p_thumb_key, '')), ''),
          case when p_which in ('full', 'thumb', 'both') then p_which else 'both' end)
  /* see the unique index: one unswept record per key */
  on conflict do nothing;
end
$$;


ALTER FUNCTION "public"."picture_orphan_log"("p_owner" "uuid", "p_key" "text", "p_thumb_key" "text", "p_which" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_pending"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /* ⚠️ ONE SENTENCE FOR BOTH REFUSALS. A picture somebody else owns and a picture that was never
     minted must answer identically, or the id space becomes a way to ask whether a given picture
     exists — the same property get_public_profile and sendPasswordReset are built around. */
  select jsonb_build_object(
           'key', key, 'thumb_key', thumb_key,
           'bytes', bytes, 'thumb_bytes', thumb_bytes, 'ready', ready,
           /* the owner, so the finishing call can be made as service_role without a session */
           'owner', owner)
    into v
    from public.member_pictures
   where id = p_id and owner = auth.uid();
  if v is null then raise exception 'no such picture'; end if;
  return v;
end $$;


ALTER FUNCTION "public"."picture_pending"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_ready"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.member_pictures set ready = true where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such picture'; end if;
end $$;


ALTER FUNCTION "public"."picture_ready"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."picture_ready"("p_id" "uuid", "p_owner" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* ⚠️ NOT A DEFAULT AND NOT A COALESCE. A null owner here would widen the update to "any picture
     with this id", which is every picture with this id — the one thing the 1-arg version's
     `owner = auth.uid()` was doing. A missing owner is a bug in the caller, so it says so. */
  if p_owner is null then raise exception 'no owner given'; end if;
  update public.member_pictures set ready = true where id = p_id and owner = p_owner;
  /* the same sentence as every other refusal in this family: see picture_pending's note */
  if not found then raise exception 'no such picture'; end if;
end $$;


ALTER FUNCTION "public"."picture_ready"("p_id" "uuid", "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pictures_i_can_see"("p_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return '[]'::jsonb; end if;
  /* a page asking for more than this is asking the wrong question */
  if array_length(p_ids, 1) > 200 then raise exception 'too many pictures at once'; end if;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v
    from (
      select distinct m.id, m.key, m.thumb_key, m.mime, m.bytes, m.thumb_bytes,
             m.w, m.h, m.alt, m.created_at
        from public.member_pictures m
       where m.id = any(p_ids)
         and m.ready
         and (
           m.owner = auth.uid()
           or exists (
             select 1 from public.circuit_ratings r
              where r.picture = m.id
                and r.user_id = m.owner
                and public.movie_visible(r.movie_id))
           or exists (
             select 1 from public.circuit_logs l
               join public.circuit_people cp on cp.id = l.person_id
              where l.picture = m.id
                and cp.owner_user_id = m.owner
                and public.circuit_can_see_log(l.id))
         )
    ) x;
  return v;
end $$;


ALTER FUNCTION "public"."pictures_i_can_see"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pictures_mine"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v
    from (select p.id, p.key, p.thumb_key, p.mime, p.bytes, p.thumb_bytes,
                 p.w, p.h, p.alt, p.created_at,
                 /* where this one is used -- the caller's own rows, which is every row
                    that could be holding it: all three FKs are on delete set null */
                 (select count(*) from public.circuit_ratings r
                   where r.picture = p.id and r.user_id = auth.uid()) as in_ratings,
                 (select count(*) from public.circuit_logs l
                    join public.circuit_people cp on cp.id = l.person_id
                   where l.picture = p.id and cp.owner_user_id = auth.uid()) as in_logs,
                 (select count(*) from public.chronicle_entries e
                   where e.picture = p.id and e.owner = auth.uid()) as in_sittings
            from public.member_pictures p
           where p.owner = auth.uid() and p.ready) x;
  return v;
end $$;


ALTER FUNCTION "public"."pictures_mine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pictures_used"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_count int; v_bytes bigint; v_ready int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select count(*), coalesce(sum(bytes + thumb_bytes), 0), count(*) filter (where ready)
    into v_count, v_bytes, v_ready
    from public.member_pictures where owner = auth.uid();
  return jsonb_build_object('count', v_count, 'ready', v_ready, 'bytes', v_bytes);
end $$;


ALTER FUNCTION "public"."pictures_used"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."player_registry_default_reveal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.user_id is not null
     and (tg_op = 'INSERT' or old.user_id is null)
     and new.visibility = 'private' then
    new.visibility := 'friends';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."player_registry_default_reveal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pool_can_invite"("p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select auth.uid() is not null
     and p_user is not null
     and (
       public.are_friends(auth.uid(), p_user)
       or exists (
         select 1
         from public.circuit_group_members mine
         join public.circuit_group_members theirs on theirs.group_id = mine.group_id
         where mine.user_id = auth.uid() and theirs.user_id = p_user)
     );
$$;


ALTER FUNCTION "public"."pool_can_invite"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pool_item_visible"("p_item" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.circuit_watchlist w
    where w.id = p_item
      and (
        (w.pool_id is not null and public.pool_visible(w.pool_id))
        or (w.pool_id is null and public.circuit_is_member(w.group_id))
      )
  );
$$;


ALTER FUNCTION "public"."pool_item_visible"("p_item" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pool_names"("p_pool" "uuid") RETURNS TABLE("user_id" "uuid", "name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select u.uid, public.display_name(u.uid)
  from (
    select p.owner_user_id as uid from public.pools p where p.id = p_pool
    union
    select pp.user_id from public.pool_people pp where pp.pool_id = p_pool
    union
    select v.user_id
      from public.pool_votes v
      join public.circuit_watchlist w on w.id = v.item_id
     where w.pool_id = p_pool
    union
    select auth.uid()
  ) u
  where u.uid is not null
    and public.pool_visible(p_pool);
$$;


ALTER FUNCTION "public"."pool_names"("p_pool" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pool_topic_member"("p_topic" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  raw text;
begin
  raw := substring(p_topic from '^pool:([0-9a-fA-F-]{36})$');
  if raw is null then
    return false;
  end if;
  return public.pool_visible(raw::uuid);
end;
$_$;


ALTER FUNCTION "public"."pool_topic_member"("p_topic" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pool_visible"("p_pool" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.pools p
    where p.id = p_pool
      and (
        p.owner_user_id = auth.uid()
        or (p.audience = 'friends' and public.are_friends(auth.uid(), p.owner_user_id))
        or (p.audience = 'selected' and exists (
              select 1 from public.pool_people pp
              where pp.pool_id = p.id and pp.user_id = auth.uid()))
      )
  );
$$;


ALTER FUNCTION "public"."pool_visible"("p_pool" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_profile_note"("p_username" "text", "p_body" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_recent int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_body = '' then raise exception 'empty note'; end if;
  if length(v_body) > 500 then raise exception 'note too long'; end if;

  select user_id into v_owner from public.profiles
   where lower(username) = lower(p_username) and coalesce(suspended, false) = false;
  if v_owner is null then raise exception 'no such member'; end if;
  -- you cannot write somewhere you cannot see
  if not public.guestbook_open_to(v_owner) then raise exception 'this guestbook is closed'; end if;

  -- A small brake, not a policy: enough that nobody can paper someone's page in one sitting,
  -- loose enough that a real back-and-forth never notices it.
  select count(*) into v_recent
  from public.profile_notes
  where profile_user_id = v_owner and author_user_id = v_me
    and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'slow down a moment — try again shortly'; end if;

  insert into public.profile_notes (profile_user_id, author_user_id, body)
  values (v_owner, v_me, v_body);
end;
$$;


ALTER FUNCTION "public"."post_profile_note"("p_username" "text", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."presence_audience_ok"("p_owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is not null and (
    p_owner = auth.uid()
    or public.are_friends(auth.uid(), p_owner)
    or exists (
      select 1
      from public.circuit_group_members mine
      join public.circuit_group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and theirs.user_id = p_owner
    )
  );
$$;


ALTER FUNCTION "public"."presence_audience_ok"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."presence_topic_member"("p_topic" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  raw text;
begin
  raw := substring(p_topic from '^presence:([0-9a-fA-F-]{36})$');
  if raw is null then return false; end if;
  return public.presence_audience_ok(raw::uuid);
end;
$_$;


ALTER FUNCTION "public"."presence_topic_member"("p_topic" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profile_room_member"("p_room" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profile_rooms r
    join public.profiles me on me.user_id = auth.uid()
    where r.id = p_room
      and coalesce(me.suspended, false) = false
      and (
        r.owner = auth.uid()
        or (
          r.open_at is not null
          and (
            -- an accepted friendship, never a pending request — same rule as presence
            (r.audience = 'friends' and public.are_friends(auth.uid(), r.owner))
            -- an invite is an explicit grant, so it works whatever the audience is set to
            or exists (
              select 1 from public.profile_room_invites i
              where i.room_id = r.id and i.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;


ALTER FUNCTION "public"."profile_room_member"("p_room" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_friend"("p_username" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_them uuid := public.uid_for_username(p_username);
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if v_them is null then raise exception 'no such member'; end if;
  delete from public.friendships
    where user_a = least(v_me, v_them) and user_b = greatest(v_me, v_them);
end;
$$;


ALTER FUNCTION "public"."remove_friend"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_circuit"("p_group" "uuid", "p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if not (public.is_admin() or exists (
    select 1 from circuit_group_members gm
    where gm.group_id = p_group and gm.user_id = auth.uid() and gm.role = 'owner'
  )) then
    raise exception 'only the circuit owner can rename it';
  end if;
  update circuit_groups set name = btrim(p_name) where id = p_group;
end $$;


ALTER FUNCTION "public"."rename_circuit"("p_group" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_my_handle"("p_new" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_new text;
  v_old text;
  v_id  bigint;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  v_new := btrim(coalesce(p_new, ''));

  -- 2 to 16 matches the handles that already exist (measured: shortest 2, longest 16), so this
  -- cannot reject a name somebody is already using.
  if length(v_new) < 2 or length(v_new) > 16 then
    raise exception 'A handle is 2 to 16 characters.';
  end if;

  -- Letters, numbers, spaces, hyphen and underscore, and it has to START with a letter or
  -- number. Leading punctuation is what lets a name imitate a label ("- admin") or sort itself
  -- to the top of the board, and neither is worth allowing for the sake of it.
  if v_new !~ '^[A-Za-z0-9][A-Za-z0-9 _-]*$' then
    raise exception 'Use letters, numbers, spaces, - and _, starting with a letter or number.';
  end if;

  select id, player_name::text into v_id, v_old
    from public.player_registry
   where user_id = auth.uid();

  if v_id is null then
    raise exception 'You do not have a handle to change yet.';
  end if;

  -- ⚠️ player_name is citext, so this comparison — and the unique index — are already
  -- case-insensitive. Changing only the CASE of your own name is therefore allowed and skips
  -- the taken check, which would otherwise match your own row and refuse it.
  if lower(v_old) <> lower(v_new)
     and exists (select 1 from public.player_registry where player_name = v_new::citext) then
    raise exception 'That handle is taken.';
  end if;

  update public.player_registry set player_name = v_new::citext where id = v_id;

  -- the copies that no foreign key will fix for us (see the note above)
  update public.leaderboard   set player_name = v_new where player_id = v_id;
  update public.score_history set player_name = v_new where player_id = v_id;

  return v_new;
exception
  -- the unique index is the real arbiter; two people renaming to the same thing at the same
  -- instant get here rather than a raw constraint error with a column name in it
  when unique_violation then
    raise exception 'That handle is taken.';
end
$_$;


ALTER FUNCTION "public"."rename_my_handle"("p_new" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."renew_invite"("p_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_new timestamptz;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  update public.invites
     set expires_at = now() + interval '30 days'
   where id = p_id and used_at is null
  returning expires_at into v_new;
  if v_new is null then
    raise exception 'invite not found, or already used';
  end if;
  return v_new;
end;
$$;


ALTER FUNCTION "public"."renew_invite"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_friend"("p_username" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_them uuid := public.uid_for_username(p_username);
  v_row public.friendships;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_them is null then raise exception 'no such member'; end if;
  if v_them = v_me then raise exception 'that is you'; end if;
  select * into v_row from public.friendships
    where user_a = least(v_me, v_them) and user_b = greatest(v_me, v_them);
  if v_row.status = 'accepted' then return 'friends'; end if;
  if v_row.status = 'pending' then
    if v_row.requested_by = v_me then return 'pending_out'; end if;
    -- they asked first — asking back IS accepting
    update public.friendships set status = 'accepted', responded_at = now()
      where user_a = v_row.user_a and user_b = v_row.user_b;
    return 'friends';
  end if;
  insert into public.friendships (user_a, user_b, requested_by)
    values (least(v_me, v_them), greatest(v_me, v_them), v_me);
  return 'pending_out';
end;
$$;


ALTER FUNCTION "public"."request_friend"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_friend"("p_username" "text", "p_accept" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_me uuid := auth.uid();
  v_them uuid := public.uid_for_username(p_username);
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_them is null then raise exception 'no such member'; end if;
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
      where user_a = least(v_me, v_them) and user_b = greatest(v_me, v_them)
        and status = 'pending' and requested_by = v_them;
    if not found then raise exception 'no request to accept'; end if;
    return 'friends';
  end if;
  delete from public.friendships
    where user_a = least(v_me, v_them) and user_b = greatest(v_me, v_them)
      and status = 'pending' and requested_by = v_them;
  return 'declined';
end;
$$;


ALTER FUNCTION "public"."respond_friend"("p_username" "text", "p_accept" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_my_profile_blocks"("p_blocks" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me uuid := auth.uid();
  v_count int;
  v_total bigint;
  /* the lists as they stand, keyed by POSITION -- see the note on ids below */
  v_old_lists jsonb;
  v_client_knows_lists boolean;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'p_blocks must be an array'; end if;

  -- ASSIGNED, not `select count(*) into v_count`: the SQL editor lints the body as top-level SQL,
  -- where `select . into name` is the archaic spelling of CREATE TABLE AS, and reports
  -- "creates a table without RLS: v_count" every time this file is opened.
  v_count := (select count(*) from jsonb_array_elements(p_blocks));
  if v_count > 20 then raise exception 'too many blocks (max 20)'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where (e->>'block_type') not in (
            'bio','banner','stats','activity','guestbook','status','trophies',
            'song','visualizer','art','looks',
            -- text at any size, face and alignment, or no text at all and just a shape
            'free',
            -- Holds packed drawings, the same shape 'art' holds, checked by the same cap below
            -- and by readPet on the way out.
            'pet',
            -- THE ADDITION. Carries no data of its own - its config is which window to cover, and
            -- the figures are derived at read time by get_member_chronicle, which uses THIS
            -- block's visibility as the only gate.
            -- See docs/2026-10-14-chronicle-profile-block.sql
            'chronicle'
          )
       or (e->>'size') not in ('small','medium','large')
       or coalesce(e->>'visibility','members')
            not in ('public','friends','members','private','certain')
       -- 64000, four times what it was. A pet and a drawing carry every stroke that made them, so
       -- this is the only block cap anybody ever reaches.
       or length(e->>'config') > 64000
       -- a list is a list; anything else is a client bug and not something to guess at
       or (e ? 'certain' and jsonb_typeof(e->'certain') <> 'array')
  ) then
    raise exception 'invalid block';
  end if;

  -- A CHRONICLE BLOCK CANNOT BE PUBLIC, and this is the only place that can enforce it.
  -- can_see(owner,'public') is true unconditionally, anon included - but get_member_chronicle
  -- refuses an unauthenticated caller outright. So 'public' here would READ as "the whole
  -- internet" and BEHAVE as "members": a tier whose name overstates what it does, which is the one
  -- thing a privacy control must never be.
  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where e->>'block_type' = 'chronicle'
      and coalesce(e->>'visibility','members') = 'public'
  ) then
    raise exception 'a chronicle block cannot be public';
  end if;

  -- AND A CEILING ON THE WHOLE PAGE: a visitor downloads and draws every block on a profile, so
  -- what costs them is the total, not the largest one.
  v_total := (select coalesce(sum(length(e->>'config')), 0) from jsonb_array_elements(p_blocks) e);
  if v_total > 160000 then raise exception 'profile too large'; end if;

  /* ⚠️ THE LISTS ARE REMEMBERED BY POSITION, BECAUSE THE IDS DO NOT SURVIVE THIS FUNCTION.
     Every save deletes all of this member's blocks and re-inserts them, so each block gets a
     fresh `gen_random_uuid()`. The client has no block id at all -- `ProfileBlock` carries
     block_type, size, config and visibility and nothing else -- so there is no id to send and
     no id to preserve. Position is the only identity a block has across a save. */
  v_old_lists := coalesce((
    select jsonb_object_agg(b.position::text, coalesce(l.names, '[]'::jsonb))
      from public.profile_blocks b
      left join lateral (
        select jsonb_agg(p.username::text) as names
          from public.visibility_certain vc
          join public.profiles p on p.user_id = vc.friend
         where vc.item_kind = 'profile_block' and vc.item_id = b.id::text
      ) l on true
     where b.user_id = v_me
  ), '{}'::jsonb);

  /* ⚠️ A MISSING `certain` KEY MUST NOT MEAN "EMPTY", or one stale tab wipes every list on the
     page. A client that knows about lists sends the key on every block, including an empty
     array when the list is empty -- so if the key appears NOWHERE in the payload, the sender is
     an older bundle that has never heard of them, and the right answer is to leave what is
     there alone rather than to read its silence as a decision.

     Per block, within a payload that does use the key, a missing key IS empty: that client is
     telling us about every block it has. */
  v_client_knows_lists := exists (select 1 from jsonb_array_elements(p_blocks) e where e ? 'certain');

  /* the AFTER DELETE trigger on this table clears each block's list as its row goes, which is
     why nothing deletes from visibility_certain here -- and why the lists above are read first */
  delete from public.profile_blocks where user_id = v_me;

  /* CLAMPED, NOT REFUSED, and the difference is whether a new member can save their own page.
     `profile_blocks.visibility` defaults to 'members' and a new signup's age_band is 'unknown',
     whose ceiling is 'friends' - so raising on a tier above the ceiling would make the editor's
     own default value unsaveable, and the first thing a new member did on the site would fail.
     Clamping silently is also what every read door already does, so this makes the stored tier
     agree with the effective one rather than changing what anybody can see. */
  with ins as (
    insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
    select v_me,
           e->>'block_type',
           o::int,
           e->>'size',
           coalesce(e->'config','{}'::jsonb),
           public.clamp_visibility(v_me, coalesce(e->>'visibility','members')::public.visibility_tier)
      from jsonb_array_elements(p_blocks) with ordinality t(e, o)
    returning id, position, visibility
  ),
  wanted as (
    select i.id,
           case
             /* ⚠️ A BLOCK THAT IS NOT `certain` HAS NO LIST. Leaving one behind would mean
                moving a block to Friends and back again silently restored an audience the
                owner had stopped choosing. */
             when i.visibility <> 'certain'::public.visibility_tier then '[]'::jsonb
             when pe.e ? 'certain' then pe.e->'certain'
             when not v_client_knows_lists
               then coalesce(v_old_lists->(i.position::text), '[]'::jsonb)
             else '[]'::jsonb
           end as names
      from ins i
      join lateral (
        select e from jsonb_array_elements(p_blocks) with ordinality t(e, o) where o = i.position
      ) pe on true
  )
  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  select distinct v_me, 'profile_block', w.id::text, pr.user_id
    from wanted w
    cross join lateral (
      /* capped per block: a list is people you chose, not a mailing list, and an unbounded
         array in a payload is somebody else's denial-of-service */
      select n.name from jsonb_array_elements_text(w.names) with ordinality n(name, ord)
       where ord <= 50
    ) n
    join public.profiles pr on lower(pr.username::text) = lower(btrim(n.name))
   where pr.user_id <> v_me
     /* the same rule `visibility_certain_set` keeps: accepted friends only, never yourself.
        `certain` sits BELOW `friends`, so a list naming a stranger would make the narrow level
        wider than the broad one. Names that are not friends are dropped rather than refused --
        the picker fills from a circle, and a circle can hold somebody who has since drifted. */
     and coalesce(public.are_friends(v_me, pr.user_id), false)
  on conflict (item_kind, item_id, friend) do nothing;

  /* WHAT WAS STORED, NOT WHAT WAS ASKED FOR. Every tier above this account's ceiling
     was quietly narrowed by the clamp above, and until now the editor had no way to
     know -- so a block saved as "Anyone with an account" by a member capped at Friends
     went on reading "Anyone with an account" on screen. Keyed by position, which is the
     only identity a block has across this function. */
  return coalesce((
    select jsonb_agg(jsonb_build_object('position', b.position,
                                        'visibility', b.visibility)
                     order by b.position)
      from public.profile_blocks b where b.user_id = v_me
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."save_my_profile_blocks"("p_blocks" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_site_content"("p_id" "text", "p_doc" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_id is null or p_id not in ('home') then
    raise exception 'unknown page';
  end if;
  if jsonb_typeof(p_doc) <> 'object' then
    raise exception 'p_doc must be an object';
  end if;
  if length(p_doc::text) > 40000 then
    raise exception 'too much content';
  end if;

  insert into public.site_content (id, doc, updated_at, updated_by)
  values (p_id, p_doc, now(), auth.uid())
  on conflict (id) do update
    set doc = excluded.doc,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;


ALTER FUNCTION "public"."save_site_content"("p_id" "text", "p_doc" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_chat_message"("p_room" "uuid", "p_body" "text") RETURNS TABLE("id" "uuid", "room_id" "uuid", "created_at" timestamp with time zone, "body" "text", "author_name" "text", "author_user_id" "uuid", "author_username" "text", "mine" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_kind text;
  v_name text;
  v_user text;
  v_id   uuid;
  v_at   timestamptz;
  v_body text := trim(p_body);
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not public.chat_room_member(p_room) then raise exception 'not in this room'; end if;
  if p_body is null or length(v_body) = 0 then raise exception 'empty message'; end if;
  if length(p_body) > 2000 then raise exception 'message too long'; end if;

  select r.kind into v_kind from public.chat_rooms r where r.id = p_room;

  -- In the Lounge the chosen name wins; everywhere else the real one does. Falls through to the
  -- usual chain when they never picked one, which is what "leave blank to use your usual name"
  -- promises in the prompt.
  select case
           when v_kind = 'lounge'
             then coalesce(p.lounge_display_name, p.first_name, p.username::text)
           else coalesce(p.first_name, p.username::text)
         end,
         p.username::text
    into v_name, v_user
  from public.profiles p where p.user_id = v_uid;
  if v_name is null then raise exception 'no profile'; end if;

  insert into public.chat_messages (room_id, user_id, author_name, body)
  values (p_room, case when v_kind = 'lounge' then null else v_uid end, v_name, v_body)
  returning chat_messages.id, chat_messages.created_at into v_id, v_at;

  -- the Lounge's authorship goes somewhere members cannot read
  if v_kind = 'lounge' then
    insert into public.lounge_message_authors (message_id, user_id) values (v_id, v_uid);
  end if;

  return query
  select v_id,
         p_room,
         v_at,
         v_body,
         v_name,
         case when v_kind = 'lounge' then null else v_uid end,
         case when v_kind = 'lounge' then null else v_user end,
         true;
end;
$$;


ALTER FUNCTION "public"."send_chat_message"("p_room" "uuid", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_lounge_display_name"("p_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_name is not null and length(v_name) > 40 then
    raise exception 'name too long';
  end if;
  update public.profiles set lounge_display_name = v_name where user_id = v_uid;
end;
$$;


ALTER FUNCTION "public"."set_lounge_display_name"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_lounge_opt_in"("p_on" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.profiles
     set lounge_opt_in = coalesce(p_on, false)
   where user_id = v_uid;
  return coalesce(p_on, false);
end;
$$;


ALTER FUNCTION "public"."set_lounge_opt_in"("p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_activity_visibility"("p_tier" "public"."visibility_tier") RETURNS "public"."visibility_tier"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.profiles
     set activity_visibility = public.clamp_visibility(auth.uid(), p_tier)
   where user_id = auth.uid()
   returning activity_visibility into v_tier;
  return v_tier;
end
$$;


ALTER FUNCTION "public"."set_my_activity_visibility"("p_tier" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_circuit_nickname"("p_group" "uuid", "p_nickname" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.circuit_group_members
                  where group_id = p_group and user_id = auth.uid()) then
    raise exception 'not in this circuit';
  end if;
  update public.circuit_group_members
     set nickname = nullif(trim(coalesce(p_nickname, '')), '')
   where group_id = p_group and user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."set_my_circuit_nickname"("p_group" "uuid", "p_nickname" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_nicknames"("p_nickname" "text" DEFAULT NULL::"text", "p_circuit_nickname" "text" DEFAULT NULL::"text", "p_snake_nickname" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.profiles
     set nickname = nullif(trim(coalesce(p_nickname, '')), ''),
         circuit_nickname = nullif(trim(coalesce(p_circuit_nickname, '')), ''),
         snake_nickname = nullif(trim(coalesce(p_snake_nickname, '')), ''),
         updated_at = now()
   where user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."set_my_nicknames"("p_nickname" "text", "p_circuit_nickname" "text", "p_snake_nickname" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_page_style"("p_style" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_width text := coalesce(p_style->>'width', 'wide');
  v_gap   text := coalesce(p_style->>'gap', 'normal');
  v_out   jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_width not in ('column','page','wide') then v_width := 'wide'; end if;
  if v_gap   not in ('tight','normal','airy') then v_gap   := 'normal'; end if;

  /* ⚠️ The default is stored as NULL rather than as the words for it. A row that says nothing and
     a row that says "the default" are the same page, and one spelling means the three readers
     never have to treat them as two. */
  if v_width = 'wide' and v_gap = 'normal' then
    v_out := null;
  else
    v_out := jsonb_build_object('width', v_width, 'gap', v_gap);
  end if;

  update public.profiles set page_style = v_out where user_id = auth.uid();
  return v_out;
end
$$;


ALTER FUNCTION "public"."set_my_page_style"("p_style" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_profile_look"("p_theme" "text", "p_palette" "jsonb", "p_flair" "text", "p_backdrop" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_me uuid := auth.uid();
  v_hex text := '^#[0-9a-fA-F]{6}$';
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  if p_theme is not null and p_theme not in ('light', 'dark', 'alt') then
    raise exception 'unknown theme';
  end if;

  -- 40 is comfortably past the longest existing style id and short enough to stay a name
  if p_flair is not null and (length(p_flair) > 40 or p_flair !~ '^[a-z][a-z0-9_-]*$') then
    raise exception 'invalid flair';
  end if;

  -- same rule as the flair: a name, not free text, so nothing can be smuggled through it
  if p_backdrop is not null and (length(p_backdrop) > 40 or p_backdrop !~ '^[a-z][a-z0-9_-]*$') then
    raise exception 'invalid backdrop';
  end if;

  if p_palette is not null then
    if jsonb_typeof(p_palette) <> 'object'
       or coalesce(p_palette->>'bg', '') !~ v_hex
       or coalesce(p_palette->>'text', '') !~ v_hex
       or coalesce(p_palette->>'accent', '') !~ v_hex then
      raise exception 'invalid palette';
    end if;
    -- store exactly the three keys, so nothing else can ride along in the blob
    p_palette := jsonb_build_object(
      'bg', p_palette->>'bg',
      'text', p_palette->>'text',
      'accent', p_palette->>'accent'
    );
  end if;

  update public.profiles
     set look_theme = p_theme,
         look_palette = p_palette,
         look_flair = p_flair,
         look_backdrop = p_backdrop,
         updated_at = now()
   where user_id = v_me;
end;
$_$;


ALTER FUNCTION "public"."set_my_profile_look"("p_theme" "text", "p_palette" "jsonb", "p_flair" "text", "p_backdrop" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_public_page"("p_on" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_on boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  update public.profiles
     set public_page = coalesce(p_on, false)
   where user_id = auth.uid()
  returning public_page into v_on;

  return coalesce(v_on, false);
end
$$;


ALTER FUNCTION "public"."set_my_public_page"("p_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_my_snake_visibility"("p_tier" "public"."visibility_tier") RETURNS "public"."visibility_tier"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  with w as (
    update public.player_registry
       set visibility = public.clamp_visibility(auth.uid(), p_tier)
     where user_id = auth.uid()
     returning visibility
  )
  /* every handle of theirs moves together, so they all hold the same value; min() is just a way
     to pick one out of a set that cannot disagree */
  select min(w.visibility) into v_tier from w;
  return v_tier;
end
$$;


ALTER FUNCTION "public"."set_my_snake_visibility"("p_tier" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_person_visibility"("p_person_id" "text", "p_tier" "public"."visibility_tier") RETURNS "public"."visibility_tier"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_tier public.visibility_tier;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /* Clamped against the ROW'S OWNER, never against auth.uid(). An admin may set a tier on
     somebody else's circuit, and the admin's own ceiling is `public` - so clamping to the caller
     would let a moderation action publish a member's person past that member's ceiling. The
     owner's ceiling is the one that describes the person being published. */
  update public.circuit_people
     set visibility = public.clamp_visibility(owner_user_id, p_tier)
   where id = p_person_id and (owner_user_id = auth.uid() or public.is_admin())
   returning visibility into v_tier;
  if v_tier is null then raise exception 'not your circuit'; end if;
  return v_tier;
end
$$;


ALTER FUNCTION "public"."set_person_visibility"("p_person_id" "text", "p_tier" "public"."visibility_tier") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_display_name"("p_user" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    nullif(trim((select p.snake_nickname from public.profiles p where p.user_id = p_user)), ''),
    public.display_name(p_user, null)
  );
$$;


ALTER FUNCTION "public"."snake_display_name"("p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_friend_names"() RETURNS TABLE("player_name" "text", "member_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select r.player_name::text,
         public.snake_display_name(r.user_id)
  from public.player_registry r
  where auth.uid() is not null
    and r.user_id is not null
    and public.can_see_item(r.user_id, r.visibility, 'player_registry', r.id::text);
$$;


ALTER FUNCTION "public"."snake_friend_names"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_contact_message"("p_name" "text", "p_email" "text", "p_body" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_name  text := nullif(btrim(p_name), '');
  v_email text := nullif(btrim(p_email), '');
  v_body  text := nullif(btrim(p_body), '');
  v_from_sender int;
  v_total int;
begin
  if v_name is null or v_email is null or v_body is null then
    raise exception 'name, email and message are all required';
  end if;
  if length(v_name) > 200 or length(v_email) > 320 or length(v_body) > 5000 then
    raise exception 'that is longer than this form accepts';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that email address does not look right';
  end if;

  select count(*) into v_from_sender
    from public.contact_messages
   where created_at > now() - interval '1 hour'
     and lower(email) = lower(v_email);
  if v_from_sender >= 3 then
    raise exception 'your earlier messages did arrive — this address has sent three within the hour, so give it a little while before the next one';
  end if;

  select count(*) into v_total
    from public.contact_messages
   where created_at > now() - interval '1 hour';
  if v_total >= 60 then
    raise exception 'the form is unusually busy right now';
  end if;

  insert into public.contact_messages (name, email, body)
  values (v_name, v_email, v_body);
end
$_$;


ALTER FUNCTION "public"."submit_contact_message"("p_name" "text", "p_email" "text", "p_body" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_score"("p_name" "text", "p_score" integer, "p_game_mode" "text" DEFAULT 'survival'::"text", "p_apples" integer DEFAULT NULL::integer, "p_time" integer DEFAULT NULL::integer, "p_created_at" timestamp with time zone DEFAULT "now"()) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_player_id bigint;
  v_owner uuid;
  v_lb_id bigint;
  v_existing integer;
  -- 48x48, the largest board the game offers. Score is 1:1 with apples, and you cannot eat more
  -- apples than there are squares. See the note above before changing this.
  v_max_score constant integer := 2304;
  v_at timestamptz := least(coalesce(p_created_at, now()), now());
  v_from_name int;
  v_total int;
  v_per_name constant int := 40;
  v_global   constant int := 200;
begin
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;

  if v_name = '' or p_score is null or p_score <= 0 then
    return null;
  end if;

  if p_score > v_max_score then
    return null;
  end if;

  -- apples cannot exceed the board either, and a score claiming more apples than it scored is
  -- incoherent — both are free to check now that a real ceiling exists
  if p_apples is not null and (p_apples < 0 or p_apples > v_max_score) then
    return null;
  end if;

  if v_at < timestamptz '2024-01-01' then
    v_at := now();
  end if;

  -- ⚠️ submitted_at, never created_at. Checked BEFORE the player_registry insert below, so a
  -- refused call cannot leave a row behind: registry pollution was half the cost of a flood.
  select count(*) into v_from_name
    from public.score_history
   where submitted_at > now() - interval '1 hour'
     and lower(player_name) = lower(v_name);
  if v_from_name >= v_per_name then
    return null;
  end if;

  select count(*) into v_total
    from public.score_history
   where submitted_at > now() - interval '1 hour';
  if v_total >= v_global then
    return null;
  end if;

  select id, user_id into v_player_id, v_owner
    from player_registry where player_name = v_name limit 1;

  -- a claimed handle is only writable by the member who claimed it
  if v_owner is not null and auth.uid() is distinct from v_owner then
    return null;
  end if;

  if v_player_id is null then
    begin
      insert into player_registry (player_name) values (v_name) returning id into v_player_id;
    exception when unique_violation then
      select id into v_player_id from player_registry where player_name = v_name limit 1;
    end;
  end if;

  insert into score_history (player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
    values (v_player_id, v_name, p_score, p_game_mode, p_apples, p_time, v_at);

  select id, score into v_lb_id, v_existing
    from leaderboard where player_id = v_player_id and game_mode = p_game_mode limit 1;
  if v_lb_id is null then
    insert into leaderboard (player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
      values (v_player_id, v_name, p_score, p_game_mode, p_apples, p_time, v_at)
      returning id into v_lb_id;
  elsif p_score > coalesce(v_existing, 0) then
    update leaderboard set score = p_score, player_name = v_name, apples_eaten = p_apples,
      time_elapsed = p_time, created_at = v_at where id = v_lb_id;
  end if;

  return v_lb_id;
end;
$$;


ALTER FUNCTION "public"."submit_score"("p_name" "text", "p_score" integer, "p_game_mode" "text", "p_apples" integer, "p_time" integer, "p_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uid_for_username"("p_username" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.user_id from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
$$;


ALTER FUNCTION "public"."uid_for_username"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uninvite_from_park_room"("p_username" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rid uuid;
begin
  select id into rid from public.park_rooms where owner = auth.uid();
  if rid is null then return; end if;
  delete from public.park_room_invites i
  using public.profiles p
  where i.room_id = rid and i.user_id = p.user_id
    and lower(p.username::text) = lower(trim(p_username));
end;
$$;


ALTER FUNCTION "public"."uninvite_from_park_room"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uninvite_from_profile_room"("p_username" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rid uuid;
begin
  select id into rid from public.profile_rooms where owner = auth.uid();
  if rid is null then return; end if;
  delete from public.profile_room_invites i
   using public.profiles p
   where i.room_id = rid
     and i.user_id = p.user_id
     and lower(p.username::text) = lower(trim(p_username));
end;
$$;


ALTER FUNCTION "public"."uninvite_from_profile_room"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_my_profile"("p_first_name" "text" DEFAULT NULL::"text", "p_middle_name" "text" DEFAULT NULL::"text", "p_last_name" "text" DEFAULT NULL::"text", "p_contact_email" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_birthday" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_venmo" "text" DEFAULT NULL::"text", "p_cashapp" "text" DEFAULT NULL::"text", "p_zelle" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update public.profiles set
    first_name  = nullif(btrim(p_first_name), ''),
    middle_name = nullif(btrim(p_middle_name), ''),
    last_name   = nullif(btrim(p_last_name), ''),
    email       = nullif(btrim(p_contact_email), ''),
    phone       = nullif(btrim(p_phone), ''),
    birthday    = nullif(btrim(p_birthday), '')::date,
    address     = nullif(btrim(p_address), ''),
    venmo       = nullif(btrim(p_venmo), ''),
    cashapp     = nullif(btrim(p_cashapp), ''),
    zelle       = nullif(btrim(p_zelle), ''),
    updated_at  = now()
  where user_id = v_uid;
end;
$$;


ALTER FUNCTION "public"."update_my_profile"("p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_contact_email" "text", "p_phone" "text", "p_birthday" "text", "p_address" "text", "p_venmo" "text", "p_cashapp" "text", "p_zelle" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_prices"("p_prices" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'finance', 'pg_temp'
    AS $$
declare
  v jsonb;
  v_symbol text;
  v_price numeric;
  v_n int := 0;
begin
  if not (public.is_admin() or coalesce(auth.jwt() ->> 'role','') = 'service_role') then
    raise exception 'admin only';
  end if;
  if jsonb_typeof(p_prices) is distinct from 'array' then
    raise exception 'p_prices must be a json array';
  end if;
  for v in select * from jsonb_array_elements(p_prices)
  loop
    v_symbol := nullif(btrim(v ->> 'symbol'), '');
    v_price := nullif(v ->> 'price','')::numeric;
    if v_symbol is null or v_price is null or v_price <= 0 then continue; end if;
    insert into finance.price_cache (asset_symbol, price, updated_at)
    values (v_symbol, v_price, now())
    on conflict (asset_symbol) do update set price = excluded.price, updated_at = excluded.updated_at;
    insert into finance.price_history (asset_symbol, price, captured_at)
    values (v_symbol, v_price, now())
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;


ALTER FUNCTION "public"."upsert_prices"("p_prices" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_ceiling"("p_owner" "uuid") RETURNS "public"."visibility_tier"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when p_owner is null then 'private'::public.visibility_tier
    when exists (select 1 from public.admin_users a where a.user_id = p_owner)
      then 'public'::public.visibility_tier
    when exists (select 1 from public.profiles p
                  where p.user_id = p_owner and p.age_band = 'adult')
      then 'members'::public.visibility_tier
    else 'friends'::public.visibility_tier
  end;
$$;


ALTER FUNCTION "public"."visibility_ceiling"("p_owner" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."visibility_ceiling"("p_owner" "uuid") IS 'The widest level this owner may choose. Admin -> public (today that is one account, evan); an established adult -> members; everybody else, INCLUDING anyone whose age is not yet established -> friends. Unknown is capped like a minor on purpose: a cap that assumes adulthood protects nobody. When Public opens up, this function changes in one place.';



CREATE OR REPLACE FUNCTION "public"."visibility_certain_forget"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  delete from public.visibility_certain
   where item_kind = tg_argv[0] and item_id = old.id::text;
  return old;
end $$;


ALTER FUNCTION "public"."visibility_certain_forget"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_certain_forget_on_leaving"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* The kind, the id column and the tier column come in as arguments, because `profiles` keys its
     list on `user_id` and calls the tier `activity_visibility` while the other four use `id` and
     `visibility`. `to_jsonb(new) ->> name` is how a trigger reads a column it is told about
     rather than one it was compiled against. */
  if (to_jsonb(new) ->> coalesce(tg_argv[2], 'visibility'))
       is distinct from 'certain' then
    delete from public.visibility_certain
     where item_kind = tg_argv[0]
       and item_id = to_jsonb(new) ->> coalesce(tg_argv[1], 'id');
  end if;
  return null;
end
$$;


ALTER FUNCTION "public"."visibility_certain_forget_on_leaving"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_certain_get"("p_kind" "text", "p_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.owns_item(p_kind, p_id, v_me) then raise exception 'no such item'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'username', p.username::text,
             'name', coalesce(p.first_name, p.username::text)
           ) order by lower(coalesce(p.first_name, p.username::text)))
      from public.visibility_certain vc
      join public.profiles p on p.user_id = vc.friend
     where vc.item_kind = p_kind and vc.item_id = p_id and vc.owner = v_me
       /* a row whose friendship has ended grants nothing, so it is not part of the answer */
       and coalesce(public.are_friends(v_me, vc.friend), false)
  ), '[]'::jsonb);
end $$;


ALTER FUNCTION "public"."visibility_certain_get"("p_kind" "text", "p_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_certain_set"("p_kind" "text", "p_id" "text", "p_usernames" "text"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me uuid := auth.uid();
  n integer;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  if not public.owns_item(p_kind, p_id, v_me) then
    /* the same sentence whether the item is somebody else's or does not exist */
    raise exception 'no such item';
  end if;

  delete from public.visibility_certain
   where item_kind = p_kind and item_id = p_id and owner = v_me;

  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  select v_me, p_kind, p_id, p.user_id
    from unnest(coalesce(p_usernames, array[]::text[])) as u(name)
    join public.profiles p on lower(p.username::text) = lower(btrim(u.name))
   where p.user_id <> v_me
     and coalesce(public.are_friends(v_me, p.user_id), false)
  on conflict (item_kind, item_id, friend) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."visibility_certain_set"("p_kind" "text", "p_id" "text", "p_usernames" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_circle_delete"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  delete from public.visibility_circles where id = p_id and owner = auth.uid() returning id into v_id;
  if v_id is null then raise exception 'no such circle'; end if;
end $$;


ALTER FUNCTION "public"."visibility_circle_delete"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_circle_drop_ex_friends"("p_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare v_me uuid := auth.uid(); n integer;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.visibility_circles where id = p_id and owner = v_me) then
    raise exception 'no such circle';
  end if;
  delete from public.visibility_circle_members vm
   where vm.circle_id = p_id
     and not coalesce(public.are_friends(v_me, vm.member), false);
  get diagnostics n = row_count;
  return n;
end $$;


ALTER FUNCTION "public"."visibility_circle_drop_ex_friends"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_circle_save"("p_id" "uuid", "p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me   uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_name = '' then raise exception 'a circle needs a name'; end if;
  if length(v_name) > 40 then raise exception 'that name is too long (40 characters)'; end if;
  /* Said here as well as on the table, because a constraint violation reaches the client as
     database noise and this reaches it as a sentence. */
  if v_name ~ '[[:cntrl:]]' then raise exception 'a circle name cannot contain line breaks'; end if;

  if p_id is null then
    if (select count(*) from public.visibility_circles where owner = v_me) >= 20 then
      raise exception 'that is as many circles as one account can have (20)';
    end if;
    insert into public.visibility_circles (owner, name) values (v_me, v_name) returning id into v_id;
    return v_id;
  end if;

  /* The same message for "not yours" and "not there", so this cannot be used to find out which. */
  update public.visibility_circles set name = v_name
   where id = p_id and owner = v_me
   returning id into v_id;
  if v_id is null then raise exception 'no such circle'; end if;
  return v_id;
exception
  when unique_violation then raise exception 'you already have a circle called that';
end $$;


ALTER FUNCTION "public"."visibility_circle_save"("p_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visibility_circle_set_member"("p_id" "uuid", "p_username" "text", "p_in" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_me   uuid := auth.uid();
  v_them uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (select 1 from public.visibility_circles where id = p_id and owner = v_me) then
    raise exception 'no such circle';
  end if;

  select user_id into v_them from public.profiles
   where lower(username::text) = lower(btrim(coalesce(p_username, '')));

  /* ONE ANSWER FOR "no such person" AND "not your friend", which is the house rule about never
     leaking whether a member exists. Both land on the same sentence by construction here,
     because a name nobody has and a name belonging to a stranger are equally not-a-friend. */
  if v_them is null or v_them = v_me then
    /* nothing to take out, and nothing worth saying about it -- see the migration header */
    if not coalesce(p_in, false) then return; end if;
    raise exception 'that is not one of your friends';
  end if;

  if coalesce(p_in, false) then
    /* ⚠️ FRIENDSHIP IS REQUIRED TO ADD, AND NOT TO REMOVE. `certain` sits BELOW `friends` on the
       ladder, so it must never reach somebody `friends` would not -- which is why a stranger
       cannot be put in a circle at all. Removal is deliberately not gated the same way: when a
       friendship ends the circle row survives, and an owner who could not then take it out would
       be stuck looking at a name they cannot tidy away. */
    if not coalesce(public.are_friends(v_me, v_them), false) then
      raise exception 'that is not one of your friends';
    end if;
    if (select count(*) from public.visibility_circle_members where circle_id = p_id) >= 200 then
      raise exception 'that circle is full (200 people)';
    end if;
    insert into public.visibility_circle_members (circle_id, member)
    values (p_id, v_them)
    on conflict (circle_id, member) do nothing;
  else
    delete from public.visibility_circle_members where circle_id = p_id and member = v_them;
  end if;
end $$;


ALTER FUNCTION "public"."visibility_circle_set_member"("p_id" "uuid", "p_username" "text", "p_in" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."voice_topic_member"("p_topic" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  raw text;
begin
  raw := coalesce(
    substring(p_topic from '^voice:([0-9a-fA-F-]{36})$'),
    substring(p_topic from '^vp:([0-9a-fA-F-]{36})$'),
    substring(p_topic from '^room:([0-9a-fA-F-]{36})$')
  );
  if raw is null then
    return false;
  end if;
  return public.chat_room_member(raw::uuid) or public.profile_room_member(raw::uuid);
end;
$_$;


ALTER FUNCTION "public"."voice_topic_member"("p_topic" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watchlist_stamp_adder"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  /* on INSERT it is always the caller; on UPDATE it is never allowed to move, or editing a
     title would be a way to take ownership of somebody else's option */
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
  else
    new.added_by := old.added_by;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."watchlist_stamp_adder"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."coingecko_ids" (
    "symbol" "text" NOT NULL,
    "coingecko_id" "text" NOT NULL
);


ALTER TABLE "finance"."coingecko_ids" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."cost_basis_overrides" (
    "asset_symbol" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "avg_cost" numeric NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "cost_basis_overrides_avg_cost_check" CHECK (("avg_cost" >= (0)::numeric))
);


ALTER TABLE "finance"."cost_basis_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."family_contributions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "contributed_on" "date" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "family_contributions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "family_contributions_note_check" CHECK ((("note" IS NULL) OR ("length"("note") <= 200)))
);


ALTER TABLE "finance"."family_contributions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."price_cache" (
    "asset_symbol" "text" NOT NULL,
    "price" numeric NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "user_id" "uuid"
);


ALTER TABLE "finance"."price_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."price_history" (
    "asset_symbol" "text" NOT NULL,
    "price" numeric NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "finance"."price_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."symbol_designations" (
    "asset_symbol" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "is_family" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "finance"."symbol_designations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "finance"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "dark_mode" boolean DEFAULT false,
    "notifications_enabled" boolean DEFAULT true,
    "preferred_currency" "text" DEFAULT 'USD'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "finance"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_features" (
    "user_id" "uuid" NOT NULL,
    "feature" "text" NOT NULL,
    "enabled" boolean NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."account_features" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_reads" (
    "user_id" "uuid" NOT NULL,
    "seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bug_report" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "body" "text" NOT NULL,
    "route" "text",
    "viewport" "text",
    "browser" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "bug_report_body_len" CHECK ((("char_length"("body") >= 4) AND ("char_length"("body") <= 2000))),
    CONSTRAINT "bug_report_browser_len" CHECK ((("browser" IS NULL) OR ("char_length"("browser") <= 20))),
    CONSTRAINT "bug_report_route_len" CHECK ((("route" IS NULL) OR ("char_length"("route") <= 80))),
    CONSTRAINT "bug_report_viewport_len" CHECK ((("viewport" IS NULL) OR ("char_length"("viewport") <= 20)))
);


ALTER TABLE "public"."bug_report" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "author_name" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_body_check" CHECK ((("length"("body") >= 1) AND ("length"("body") <= 2000)))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_reads" (
    "user_id" "uuid" NOT NULL,
    "room_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chat_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_room_members" (
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chat_room_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "group_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_rooms_kind_check" CHECK (("kind" = ANY (ARRAY['circuit'::"text", 'lounge'::"text", 'dm'::"text"]))),
    CONSTRAINT "circuit_rooms_need_group" CHECK ((("kind" <> 'circuit'::"text") OR ("group_id" IS NOT NULL)))
);


ALTER TABLE "public"."chat_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronicle_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "cat" "text" NOT NULL,
    "colour" "text",
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "auto" boolean DEFAULT false NOT NULL,
    "metric" "text",
    "session_mins" integer,
    "shared" boolean DEFAULT false NOT NULL,
    "visibility" "public"."visibility_tier" DEFAULT 'private'::"public"."visibility_tier" NOT NULL,
    CONSTRAINT "chronicle_activities_cat_check" CHECK (("cat" = ANY (ARRAY['locked'::"text", 'free'::"text", 'life'::"text"]))),
    CONSTRAINT "chronicle_activities_colour_check" CHECK ((("colour" IS NULL) OR ("colour" ~ '^#[0-9a-fA-F]{6}$'::"text"))),
    CONSTRAINT "chronicle_activities_name_check" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 60))),
    CONSTRAINT "chronicle_activities_tier_agrees" CHECK (("shared" = ("visibility" = ANY (ARRAY['friends'::"public"."visibility_tier", 'members'::"public"."visibility_tier", 'public'::"public"."visibility_tier"])))),
    CONSTRAINT "chronicle_activities_tier_capped" CHECK (("visibility" = ANY (ARRAY['private'::"public"."visibility_tier", 'certain'::"public"."visibility_tier", 'friends'::"public"."visibility_tier"]))),
    CONSTRAINT "chronicle_activity_metric_short" CHECK ((("metric" IS NULL) OR (("char_length"("btrim"("metric")) >= 1) AND ("char_length"("btrim"("metric")) <= 16)))),
    CONSTRAINT "chronicle_activity_session_sane" CHECK ((("session_mins" IS NULL) OR (("session_mins" > 0) AND ("session_mins" <= 1440))))
);


ALTER TABLE "public"."chronicle_activities" OWNER TO "postgres";


COMMENT ON COLUMN "public"."chronicle_activities"."visibility" IS 'The ladder level for this activity''s sittings. `shared` is the old boolean and is kept in lockstep by chronicle_tier_sync + a CHECK, so the eleven functions still reading it keep working. The useful range here is private | certain | friends: a sitting-by-sitting timeline is friends-only by design and no level above that widens it.';



CREATE TABLE IF NOT EXISTS "public"."chronicle_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "activity" "uuid" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amount" numeric,
    "quality" smallint,
    "picture" "uuid",
    CONSTRAINT "chronicle_entry_amount_sane" CHECK ((("amount" IS NULL) OR (("amount" >= (0)::numeric) AND ("amount" <= '1000000000'::numeric)))),
    CONSTRAINT "chronicle_entry_quality_range" CHECK ((("quality" IS NULL) OR (("quality" >= 1) AND ("quality" <= 5)))),
    CONSTRAINT "chronicle_entry_span" CHECK ((("ended_at" IS NULL) OR ("ended_at" > "started_at")))
);


ALTER TABLE "public"."chronicle_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronicle_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "anchor" "date",
    "repeat_every" integer,
    "target" numeric,
    "unit" "text",
    "progress" numeric DEFAULT 0 NOT NULL,
    "done_at" timestamp with time zone,
    "note" "text",
    "sort" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activity" "uuid",
    "cat" "text",
    "counts" "text" DEFAULT 'minutes'::"text" NOT NULL,
    "est_mins" integer,
    "priority" smallint DEFAULT 0 NOT NULL,
    "shared" boolean DEFAULT false NOT NULL,
    "visibility" "public"."visibility_tier" DEFAULT 'private'::"public"."visibility_tier" NOT NULL,
    CONSTRAINT "chronicle_goal_amount_needs_one_activity" CHECK ((("counts" = 'minutes'::"text") OR ("activity" IS NOT NULL))),
    CONSTRAINT "chronicle_goal_cat_known" CHECK ((("cat" IS NULL) OR ("cat" = ANY (ARRAY['locked'::"text", 'free'::"text", 'life'::"text"])))),
    CONSTRAINT "chronicle_goal_counts_known" CHECK (("counts" = ANY (ARRAY['minutes'::"text", 'amount'::"text"]))),
    CONSTRAINT "chronicle_goal_est_sane" CHECK ((("est_mins" IS NULL) OR (("est_mins" > 0) AND ("est_mins" <= 10080)))),
    CONSTRAINT "chronicle_goal_one_source" CHECK ((("activity" IS NULL) OR ("cat" IS NULL))),
    CONSTRAINT "chronicle_goal_priority_range" CHECK ((("priority" >= 0) AND ("priority" <= 2))),
    CONSTRAINT "chronicle_goal_source_needs_target" CHECK (((("activity" IS NULL) AND ("cat" IS NULL)) OR ("target" IS NOT NULL))),
    CONSTRAINT "chronicle_goal_unit_with_target" CHECK ((("target" IS NULL) = ("unit" IS NULL))),
    CONSTRAINT "chronicle_goal_window" CHECK (((("scope" = 'life'::"text") AND ("anchor" IS NULL) AND ("repeat_every" IS NULL)) OR (("scope" <> 'life'::"text") AND ("repeat_every" IS NOT NULL) AND ("anchor" IS NULL)) OR (("scope" <> 'life'::"text") AND ("repeat_every" IS NULL) AND ("anchor" IS NOT NULL)))),
    CONSTRAINT "chronicle_goals_note_check" CHECK ((("note" IS NULL) OR ("char_length"("note") <= 2000))),
    CONSTRAINT "chronicle_goals_progress_check" CHECK ((("progress" >= (0)::numeric) AND ("progress" <= '1000000000'::numeric))),
    CONSTRAINT "chronicle_goals_repeat_every_check" CHECK ((("repeat_every" IS NULL) OR (("repeat_every" >= 1) AND ("repeat_every" <= 52)))),
    CONSTRAINT "chronicle_goals_scope_check" CHECK (("scope" = ANY (ARRAY['day'::"text", 'week'::"text", 'month'::"text", 'quarter'::"text", 'year'::"text", 'life'::"text"]))),
    CONSTRAINT "chronicle_goals_target_check" CHECK ((("target" IS NULL) OR (("target" > (0)::numeric) AND ("target" <= '1000000000'::numeric)))),
    CONSTRAINT "chronicle_goals_tier_agrees" CHECK (("shared" = ("visibility" = ANY (ARRAY['friends'::"public"."visibility_tier", 'members'::"public"."visibility_tier", 'public'::"public"."visibility_tier"])))),
    CONSTRAINT "chronicle_goals_tier_capped" CHECK (("visibility" = ANY (ARRAY['private'::"public"."visibility_tier", 'certain'::"public"."visibility_tier", 'friends'::"public"."visibility_tier"]))),
    CONSTRAINT "chronicle_goals_title_check" CHECK ((("char_length"("btrim"("title")) >= 1) AND ("char_length"("btrim"("title")) <= 120))),
    CONSTRAINT "chronicle_goals_unit_check" CHECK ((("unit" IS NULL) OR (("char_length"("btrim"("unit")) >= 1) AND ("char_length"("btrim"("unit")) <= 16))))
);


ALTER TABLE "public"."chronicle_goals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."chronicle_goals"."visibility" IS 'The ladder level for this goal. Same lockstep arrangement as chronicle_activities.visibility.';



CREATE TABLE IF NOT EXISTS "public"."chronicle_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "entry" "uuid" NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "body" "text" NOT NULL,
    CONSTRAINT "chronicle_notes_not_a_novel" CHECK (("length"("body") <= 4000)),
    CONSTRAINT "chronicle_notes_said_something" CHECK (("btrim"("body") <> ''::"text"))
);


ALTER TABLE "public"."chronicle_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronicle_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "activity" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chronicle_plan_forward" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "chronicle_plan_note_len" CHECK ((("note" IS NULL) OR ("char_length"("note") <= 500))),
    CONSTRAINT "chronicle_plan_within_a_day" CHECK ((("ends_at" - "starts_at") <= '24:00:00'::interval))
);


ALTER TABLE "public"."chronicle_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chronicle_routines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chronicle_routine_small" CHECK (("octet_length"(("steps")::"text") <= 8192)),
    CONSTRAINT "chronicle_routines_name_check" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 60)))
);


ALTER TABLE "public"."chronicle_routines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_group_members" (
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nickname" "text",
    CONSTRAINT "circuit_group_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."circuit_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "join_code" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(6), 'hex'::"text"),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circuit_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_log_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "log_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "author_name" "text",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "circuit_log_comments_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 1000)))
);


ALTER TABLE "public"."circuit_log_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_log_reactions" (
    "log_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "author_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circuit_log_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_logs" (
    "id" "text" NOT NULL,
    "person_id" "text" NOT NULL,
    "date" "date" NOT NULL,
    "entries" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "img" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "picture" "uuid"
);


ALTER TABLE "public"."circuit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_movies" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "date" "text",
    "rt" "text",
    "ratings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_id" "uuid",
    "kind" "text" DEFAULT 'movie'::"text" NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."circuit_movies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_people" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "goal" integer DEFAULT 100,
    "exercises" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "col_labels" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_user_id" "uuid",
    "visibility" "public"."visibility_tier" DEFAULT 'private'::"public"."visibility_tier" NOT NULL
);


ALTER TABLE "public"."circuit_people" OWNER TO "postgres";


COMMENT ON COLUMN "public"."circuit_people"."visibility" IS 'Replaces is_public. is_public is left in place until the client stops reading it (step 5).';



CREATE TABLE IF NOT EXISTS "public"."circuit_person_groups" (
    "person_id" "text" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "added_by" "uuid",
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."circuit_person_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_ratings" (
    "movie_id" "text" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "score" integer,
    "icons" "jsonb",
    "review" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "picture" "uuid",
    CONSTRAINT "circuit_ratings_score_check" CHECK ((("score" IS NULL) OR (("score" >= 0) AND ("score" <= 100))))
);


ALTER TABLE "public"."circuit_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_watchlist" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "rt" "text",
    "votes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_id" "uuid",
    "kind" "text" DEFAULT 'movie'::"text" NOT NULL,
    "pool_id" "uuid",
    "added_by" "uuid"
);


ALTER TABLE "public"."circuit_watchlist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "body" "text" NOT NULL,
    "handled" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."contact_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."friendships" (
    "user_a" "uuid" NOT NULL,
    "user_b" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    CONSTRAINT "friendships_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"]))),
    CONSTRAINT "ordered_pair" CHECK (("user_a" < "user_b")),
    CONSTRAINT "requester_in_pair" CHECK ((("requested_by" = "user_a") OR ("requested_by" = "user_b")))
);


ALTER TABLE "public"."friendships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class" "text" NOT NULL,
    "label" "text",
    "created_by" "uuid" NOT NULL,
    "used_at" timestamp with time zone,
    "used_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval),
    CONSTRAINT "invites_class_check" CHECK (("class" = ANY (ARRAY['family'::"text", 'friend'::"text"])))
);


ALTER TABLE "public"."invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leaderboard" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "score" integer,
    "player_name" "text" DEFAULT ''::"text",
    "game_mode" "text" DEFAULT 'solo'::"text" NOT NULL,
    "apples_eaten" integer DEFAULT 0,
    "time_elapsed" integer DEFAULT 0,
    "player_id" bigint NOT NULL
);


ALTER TABLE "public"."leaderboard" OWNER TO "postgres";


ALTER TABLE "public"."leaderboard" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."leaderboard_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."trophies" (
    "id" bigint NOT NULL,
    "leaderboard_id" bigint NOT NULL,
    "trophy_name" "text" NOT NULL,
    "awarded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trophies" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."leaderboard_with_trophies" WITH ("security_invoker"='true') AS
 SELECT "l"."id",
    "l"."player_name",
    "l"."score",
    "l"."created_at",
    "json_agg"("json_build_object"('trophy_name', "t"."trophy_name", 'awarded_at', "t"."awarded_at")) FILTER (WHERE ("t"."id" IS NOT NULL)) AS "trophies"
   FROM ("public"."leaderboard" "l"
     LEFT JOIN "public"."trophies" "t" ON (("l"."id" = "t"."leaderboard_id")))
  GROUP BY "l"."id", "l"."player_name", "l"."score", "l"."created_at"
  ORDER BY "l"."score" DESC;


ALTER VIEW "public"."leaderboard_with_trophies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lounge_message_authors" (
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."lounge_message_authors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_library" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "name" "text" NOT NULL,
    "body" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_library_body_size" CHECK (("octet_length"(("body")::"text") <= 131072)),
    CONSTRAINT "member_library_kind_check" CHECK (("kind" = ANY (ARRAY['song'::"text", 'loop'::"text", 'art'::"text", 'look'::"text", 'pet'::"text", 'wins'::"text"]))),
    CONSTRAINT "member_library_name_len" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80)))
);


ALTER TABLE "public"."member_library" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_pictures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "thumb_key" "text" NOT NULL,
    "mime" "text" NOT NULL,
    "bytes" integer NOT NULL,
    "thumb_bytes" integer NOT NULL,
    "w" integer NOT NULL,
    "h" integer NOT NULL,
    "alt" "text",
    "ready" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_pictures_alt_short" CHECK ((("alt" IS NULL) OR ("char_length"("btrim"("alt")) <= 300))),
    CONSTRAINT "member_pictures_bytes_sane" CHECK ((("bytes" >= 1) AND ("bytes" <= 2097152))),
    CONSTRAINT "member_pictures_mime_known" CHECK (("mime" = ANY (ARRAY['image/webp'::"text", 'image/jpeg'::"text", 'image/png'::"text", 'image/avif'::"text"]))),
    CONSTRAINT "member_pictures_size_sane" CHECK (((("w" >= 1) AND ("w" <= 20000)) AND (("h" >= 1) AND ("h" <= 20000)))),
    CONSTRAINT "member_pictures_thumb_sane" CHECK ((("thumb_bytes" >= 1) AND ("thumb_bytes" <= 262144)))
);


ALTER TABLE "public"."member_pictures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."park_maps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "body" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "park_maps_body_size" CHECK (("octet_length"(("body")::"text") <= 2097152)),
    CONSTRAINT "park_maps_name_len" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 80)))
);


ALTER TABLE "public"."park_maps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."park_room_invites" (
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."park_room_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."park_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "map_id" "uuid" NOT NULL,
    "audience" "public"."visibility_tier" DEFAULT 'friends'::"public"."visibility_tier" NOT NULL,
    "open_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."park_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."picture_orphans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "thumb_key" "text",
    "which" "text" DEFAULT 'both'::"text" NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "swept_at" timestamp with time zone
);


ALTER TABLE "public"."picture_orphans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."player_registry" (
    "id" bigint NOT NULL,
    "player_name" "extensions"."citext" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "visibility" "public"."visibility_tier" DEFAULT 'private'::"public"."visibility_tier" NOT NULL,
    "claimed_at" timestamp with time zone
);


ALTER TABLE "public"."player_registry" OWNER TO "postgres";


COMMENT ON COLUMN "public"."player_registry"."visibility" IS 'Who may learn which account owns a Snake handle. The tier lives on the HANDLE, not the score: score_history/leaderboard/trophies have no user_id at all.';



CREATE SEQUENCE IF NOT EXISTS "public"."player_registry_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."player_registry_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."player_registry_id_seq" OWNED BY "public"."player_registry"."id";



CREATE TABLE IF NOT EXISTS "public"."pool_people" (
    "pool_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pool_people" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pool_votes" (
    "item_id" "text" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pool_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" DEFAULT 'Pool'::"text" NOT NULL,
    "audience" "text" DEFAULT 'friends'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pools_audience_check" CHECK (("audience" = ANY (ARRAY['just_me'::"text", 'friends'::"text", 'selected'::"text"])))
);


ALTER TABLE "public"."pools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "block_type" "text" NOT NULL,
    "position" integer NOT NULL,
    "size" "text" DEFAULT 'medium'::"text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "visibility" "public"."visibility_tier" DEFAULT 'members'::"public"."visibility_tier" NOT NULL,
    CONSTRAINT "profile_blocks_tier_accepted" CHECK (("visibility" = ANY (ARRAY['public'::"public"."visibility_tier", 'friends'::"public"."visibility_tier", 'members'::"public"."visibility_tier", 'private'::"public"."visibility_tier", 'certain'::"public"."visibility_tier"])))
);


ALTER TABLE "public"."profile_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_user_id" "uuid" NOT NULL,
    "author_user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_room_invites" (
    "room_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_room_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "audience" "public"."visibility_tier" DEFAULT 'friends'::"public"."visibility_tier" NOT NULL,
    "open_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_room_audience_supported" CHECK (("audience" = ANY (ARRAY['friends'::"public"."visibility_tier", 'private'::"public"."visibility_tier"])))
);


ALTER TABLE "public"."profile_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "username" "extensions"."citext" NOT NULL,
    "first_name" "text",
    "middle_name" "text",
    "last_name" "text",
    "relation" "text",
    "email" "text",
    "phone" "text",
    "birthday" "date",
    "address" "text",
    "venmo" "text",
    "cashapp" "text",
    "zelle" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "suspended" boolean DEFAULT false NOT NULL,
    "nickname" "text",
    "circuit_nickname" "text",
    "snake_nickname" "text",
    "lounge_opt_in" boolean DEFAULT false NOT NULL,
    "activity_visibility" "public"."visibility_tier" DEFAULT 'private'::"public"."visibility_tier" NOT NULL,
    "lounge_display_name" "text",
    "look_theme" "text",
    "look_palette" "jsonb",
    "look_flair" "text",
    "look_backdrop" "text",
    "is_demo" boolean DEFAULT false NOT NULL,
    "public_page" boolean DEFAULT false NOT NULL,
    "page_style" "jsonb",
    "age_band" "text",
    "feed_opt_in" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_age_band_check" CHECK ((("age_band" IS NULL) OR ("age_band" = ANY (ARRAY['adult'::"text", 'minor'::"text"]))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Member profiles. WRITES GO THROUGH SECURITY DEFINER FUNCTIONS ONLY -- authenticated holds SELECT and nothing else, and there are no INSERT/UPDATE policies. Members could previously update every column of their own row, including suspended (un-suspending themselves), age_band and feed_opt_in. All 12 writers are SECURITY DEFINER owned by postgres, so none of them needs the grant.';



COMMENT ON COLUMN "public"."profiles"."lounge_opt_in" IS 'Opt-in to The Lounge, the open room shared by every account. Default false: members are never placed in a room with people they did not choose.';



COMMENT ON COLUMN "public"."profiles"."look_theme" IS 'built-in theme the member uses: light | dark | alt. Null means never published.';



COMMENT ON COLUMN "public"."profiles"."look_palette" IS 'their custom palette seed {bg,text,accent} when they use one, else null. Overrides look_theme.';



COMMENT ON COLUMN "public"."profiles"."look_flair" IS 'their click-flair style id (see src/ui/clickFx.ts), or null for none.';



COMMENT ON COLUMN "public"."profiles"."public_page" IS 'The owner has chosen that this page can be read by anyone with the link. Gates get_public_profile and nothing else; blocks are still filtered to the public tier.';



COMMENT ON COLUMN "public"."profiles"."page_style" IS 'Page layout the owner chose: {"width":"narrow|normal|wide","gap":"tight|normal|airy"}. Validated by set_my_page_style; readers clamp again because config is jsonb.';



COMMENT ON COLUMN "public"."profiles"."age_band" IS 'adult | minor | null = not yet established. NULL IS NOT "adult" -- the feed treats unknown as a minor, because a guarantee about minors cannot be built on a guess about who they are.';



COMMENT ON COLUMN "public"."profiles"."feed_opt_in" IS 'An explicit yes to appearing in other people''s feeds, for anyone not established as an adult. Admin-set for now: for a minor the consent that matters is a guardian''s.';



CREATE TABLE IF NOT EXISTS "public"."round_results" (
    "id" bigint NOT NULL,
    "room_id" "text" NOT NULL,
    "round_id" "text" NOT NULL,
    "game_mode" "text" DEFAULT 'survival'::"text" NOT NULL,
    "results" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."round_results" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."round_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."round_results_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."round_results_id_seq" OWNED BY "public"."round_results"."id";



CREATE TABLE IF NOT EXISTS "public"."score_history" (
    "id" bigint NOT NULL,
    "player_name" "text" NOT NULL,
    "score" integer NOT NULL,
    "game_mode" "text" DEFAULT 'solo'::"text" NOT NULL,
    "apples_eaten" integer DEFAULT 0,
    "time_elapsed" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "player_id" bigint NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "score_history_score_check" CHECK (("score" >= 0))
);


ALTER TABLE "public"."score_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."score_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."score_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."score_history_id_seq" OWNED BY "public"."score_history"."id";



CREATE TABLE IF NOT EXISTS "public"."site_content" (
    "id" "text" NOT NULL,
    "doc" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."site_content" OWNER TO "postgres";


ALTER TABLE "public"."trophies" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."trophies_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'user'::"text"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visibility_certain" (
    "owner" "uuid" NOT NULL,
    "item_kind" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "friend" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visibility_certain_kind_known" CHECK (("item_kind" = ANY (ARRAY['profile_block'::"text", 'chronicle_activity'::"text", 'chronicle_goal'::"text", 'circuit_person'::"text", 'player_registry'::"text", 'profile_activity'::"text"])))
);


ALTER TABLE "public"."visibility_certain" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visibility_circle_members" (
    "circle_id" "uuid" NOT NULL,
    "member" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."visibility_circle_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."visibility_circle_members" IS 'Who is in a circle. A member here must also be an accepted friend of the circle owner at READ time -- membership is a convenience list, never a grant on its own.';



CREATE TABLE IF NOT EXISTS "public"."visibility_circles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visibility_circles_name_ok" CHECK ((("btrim"("name") <> ''::"text") AND ("length"("btrim"("name")) <= 40))),
    CONSTRAINT "visibility_circles_name_plain" CHECK (("name" !~ '[[:cntrl:]]'::"text"))
);


ALTER TABLE "public"."visibility_circles" OWNER TO "postgres";


COMMENT ON TABLE "public"."visibility_circles" IS 'A named set of friends, reusable across items (the "Certain friends" level). Deny-all: RLS on, zero policies, no grants -- reached only through SECURITY DEFINER RPCs, which do not exist yet. Phase 1 of docs/2026-10-30-one-visibility-ladder-plan.md.';



ALTER TABLE ONLY "public"."player_registry" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."player_registry_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."round_results" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."round_results_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."score_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."score_history_id_seq"'::"regclass");



ALTER TABLE ONLY "finance"."allocations"
    ADD CONSTRAINT "allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "finance"."coingecko_ids"
    ADD CONSTRAINT "coingecko_ids_pkey" PRIMARY KEY ("symbol");



ALTER TABLE ONLY "finance"."cost_basis_overrides"
    ADD CONSTRAINT "cost_basis_overrides_pkey" PRIMARY KEY ("asset_symbol", "platform");



ALTER TABLE ONLY "finance"."executed_trades"
    ADD CONSTRAINT "executed_trade_id_unique" UNIQUE ("executed_trade_id");



ALTER TABLE ONLY "finance"."executed_trades"
    ADD CONSTRAINT "executed_trades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "finance"."family_accounts"
    ADD CONSTRAINT "family_account_id_unique" UNIQUE ("family_account_id");



ALTER TABLE ONLY "finance"."family_accounts"
    ADD CONSTRAINT "family_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "finance"."family_contributions"
    ADD CONSTRAINT "family_contributions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "finance"."price_cache"
    ADD CONSTRAINT "price_cache_pkey" PRIMARY KEY ("asset_symbol");



ALTER TABLE ONLY "finance"."price_history"
    ADD CONSTRAINT "price_history_pkey" PRIMARY KEY ("asset_symbol", "captured_at");



ALTER TABLE ONLY "finance"."symbol_designations"
    ADD CONSTRAINT "symbol_designations_pkey" PRIMARY KEY ("asset_symbol", "platform");



ALTER TABLE ONLY "finance"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."account_features"
    ADD CONSTRAINT "account_features_pkey" PRIMARY KEY ("user_id", "feature");



ALTER TABLE ONLY "public"."activity_reads"
    ADD CONSTRAINT "activity_reads_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."bug_report"
    ADD CONSTRAINT "bug_report_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("user_id", "room_id");



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("room_id", "user_id");



ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_group_id_key" UNIQUE ("group_id");



ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronicle_activities"
    ADD CONSTRAINT "chronicle_activities_owner_name_key" UNIQUE ("owner", "name");



ALTER TABLE ONLY "public"."chronicle_activities"
    ADD CONSTRAINT "chronicle_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronicle_entries"
    ADD CONSTRAINT "chronicle_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronicle_goals"
    ADD CONSTRAINT "chronicle_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronicle_notes"
    ADD CONSTRAINT "chronicle_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronicle_plans"
    ADD CONSTRAINT "chronicle_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chronicle_routines"
    ADD CONSTRAINT "chronicle_routines_owner_name_key" UNIQUE ("owner", "name");



ALTER TABLE ONLY "public"."chronicle_routines"
    ADD CONSTRAINT "chronicle_routines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_group_members"
    ADD CONSTRAINT "circuit_group_members_pkey" PRIMARY KEY ("group_id", "user_id");



ALTER TABLE ONLY "public"."circuit_groups"
    ADD CONSTRAINT "circuit_groups_join_code_key" UNIQUE ("join_code");



ALTER TABLE ONLY "public"."circuit_groups"
    ADD CONSTRAINT "circuit_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_log_comments"
    ADD CONSTRAINT "circuit_log_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_log_reactions"
    ADD CONSTRAINT "circuit_log_reactions_pkey" PRIMARY KEY ("log_id", "user_id", "emoji");



ALTER TABLE ONLY "public"."circuit_logs"
    ADD CONSTRAINT "circuit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_movies"
    ADD CONSTRAINT "circuit_movies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_people"
    ADD CONSTRAINT "circuit_people_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_person_groups"
    ADD CONSTRAINT "circuit_person_groups_pkey" PRIMARY KEY ("person_id", "group_id");



ALTER TABLE ONLY "public"."circuit_ratings"
    ADD CONSTRAINT "circuit_ratings_pkey" PRIMARY KEY ("movie_id", "user_id");



ALTER TABLE ONLY "public"."circuit_watchlist"
    ADD CONSTRAINT "circuit_watchlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_messages"
    ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_pkey" PRIMARY KEY ("user_a", "user_b");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."leaderboard"
    ADD CONSTRAINT "leaderboard_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lounge_message_authors"
    ADD CONSTRAINT "lounge_message_authors_pkey" PRIMARY KEY ("message_id");



ALTER TABLE ONLY "public"."member_library"
    ADD CONSTRAINT "member_library_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_pictures"
    ADD CONSTRAINT "member_pictures_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."member_pictures"
    ADD CONSTRAINT "member_pictures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_pictures"
    ADD CONSTRAINT "member_pictures_thumb_key_key" UNIQUE ("thumb_key");



ALTER TABLE ONLY "public"."park_maps"
    ADD CONSTRAINT "park_maps_one_name_per_owner" UNIQUE ("owner", "name");



ALTER TABLE ONLY "public"."park_maps"
    ADD CONSTRAINT "park_maps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."park_room_invites"
    ADD CONSTRAINT "park_room_invites_pkey" PRIMARY KEY ("room_id", "user_id");



ALTER TABLE ONLY "public"."park_rooms"
    ADD CONSTRAINT "park_rooms_owner_key" UNIQUE ("owner");



ALTER TABLE ONLY "public"."park_rooms"
    ADD CONSTRAINT "park_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."picture_orphans"
    ADD CONSTRAINT "picture_orphans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_registry"
    ADD CONSTRAINT "player_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."player_registry"
    ADD CONSTRAINT "player_registry_player_name_key" UNIQUE ("player_name");



ALTER TABLE ONLY "public"."pool_people"
    ADD CONSTRAINT "pool_people_pkey" PRIMARY KEY ("pool_id", "user_id");



ALTER TABLE ONLY "public"."pool_votes"
    ADD CONSTRAINT "pool_votes_pkey" PRIMARY KEY ("item_id", "user_id");



ALTER TABLE ONLY "public"."pools"
    ADD CONSTRAINT "pools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_blocks"
    ADD CONSTRAINT "profile_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_notes"
    ADD CONSTRAINT "profile_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_room_invites"
    ADD CONSTRAINT "profile_room_invites_pkey" PRIMARY KEY ("room_id", "user_id");



ALTER TABLE ONLY "public"."profile_rooms"
    ADD CONSTRAINT "profile_rooms_owner_key" UNIQUE ("owner");



ALTER TABLE ONLY "public"."profile_rooms"
    ADD CONSTRAINT "profile_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."round_results"
    ADD CONSTRAINT "round_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."round_results"
    ADD CONSTRAINT "round_results_room_id_round_id_key" UNIQUE ("room_id", "round_id");



ALTER TABLE ONLY "public"."score_history"
    ADD CONSTRAINT "score_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_content"
    ADD CONSTRAINT "site_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trophies"
    ADD CONSTRAINT "trophies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."visibility_certain"
    ADD CONSTRAINT "visibility_certain_pkey" PRIMARY KEY ("item_kind", "item_id", "friend");



ALTER TABLE ONLY "public"."visibility_circle_members"
    ADD CONSTRAINT "visibility_circle_members_pkey" PRIMARY KEY ("circle_id", "member");



ALTER TABLE ONLY "public"."visibility_circles"
    ADD CONSTRAINT "visibility_circles_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "executed_trades_import_key_uidx" ON "finance"."executed_trades" USING "btree" ("import_key") WHERE ("import_key" IS NOT NULL);



CREATE INDEX "executed_trades_kind_idx" ON "finance"."executed_trades" USING "btree" ("kind") WHERE ("kind" IS NOT NULL);



CREATE INDEX "family_contributions_owner_date_idx" ON "finance"."family_contributions" USING "btree" ("user_id", "contributed_on");



CREATE INDEX "bug_report_open_idx" ON "public"."bug_report" USING "btree" ("created_at" DESC) WHERE (NOT "handled");



CREATE INDEX "chat_messages_room_time" ON "public"."chat_messages" USING "btree" ("room_id", "created_at" DESC);



CREATE UNIQUE INDEX "chronicle_auto_one_per_module" ON "public"."chronicle_activities" USING "btree" ("owner", "name") WHERE "auto";



CREATE INDEX "chronicle_entries_owner_started" ON "public"."chronicle_entries" USING "btree" ("owner", "started_at" DESC);



CREATE INDEX "chronicle_entries_picture" ON "public"."chronicle_entries" USING "btree" ("picture") WHERE ("picture" IS NOT NULL);



CREATE INDEX "chronicle_goals_activity" ON "public"."chronicle_goals" USING "btree" ("activity") WHERE ("activity" IS NOT NULL);



CREATE INDEX "chronicle_goals_flagged" ON "public"."chronicle_goals" USING "btree" ("owner", "priority" DESC) WHERE ("priority" > 0);



CREATE INDEX "chronicle_goals_owner_scope" ON "public"."chronicle_goals" USING "btree" ("owner", "scope", "anchor");



CREATE INDEX "chronicle_notes_by_entry" ON "public"."chronicle_notes" USING "btree" ("entry", "at");



CREATE UNIQUE INDEX "chronicle_one_running" ON "public"."chronicle_entries" USING "btree" ("owner") WHERE ("ended_at" IS NULL);



CREATE INDEX "chronicle_plans_by_day" ON "public"."chronicle_plans" USING "btree" ("owner", "starts_at");



CREATE INDEX "chronicle_routines_owner" ON "public"."chronicle_routines" USING "btree" ("owner", "name");



CREATE INDEX "circuit_logs_person_date_idx" ON "public"."circuit_logs" USING "btree" ("person_id", "date");



CREATE INDEX "circuit_ratings_user_idx" ON "public"."circuit_ratings" USING "btree" ("user_id");



CREATE INDEX "circuit_watchlist_pool_idx" ON "public"."circuit_watchlist" USING "btree" ("pool_id");



CREATE INDEX "contact_messages_created_idx" ON "public"."contact_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "ix_member_library_user" ON "public"."member_library" USING "btree" ("user_id", "kind");



CREATE INDEX "ix_visibility_certain_friend" ON "public"."visibility_certain" USING "btree" ("friend");



CREATE INDEX "ix_visibility_certain_owner" ON "public"."visibility_certain" USING "btree" ("owner");



CREATE INDEX "lounge_message_authors_user_idx" ON "public"."lounge_message_authors" USING "btree" ("user_id");



CREATE INDEX "member_pictures_owner_made" ON "public"."member_pictures" USING "btree" ("owner", "created_at" DESC);



CREATE INDEX "park_maps_owner_idx" ON "public"."park_maps" USING "btree" ("owner");



CREATE INDEX "park_rooms_map_idx" ON "public"."park_rooms" USING "btree" ("map_id");



CREATE UNIQUE INDEX "picture_orphans_one_per_key" ON "public"."picture_orphans" USING "btree" ("key") WHERE ("swept_at" IS NULL);



CREATE INDEX "picture_orphans_unswept" ON "public"."picture_orphans" USING "btree" ("at") WHERE ("swept_at" IS NULL);



CREATE INDEX "player_registry_user_idx" ON "public"."player_registry" USING "btree" ("user_id");



CREATE INDEX "pool_people_user_idx" ON "public"."pool_people" USING "btree" ("user_id");



CREATE INDEX "pool_votes_user_idx" ON "public"."pool_votes" USING "btree" ("user_id");



CREATE INDEX "profile_blocks_user_idx" ON "public"."profile_blocks" USING "btree" ("user_id", "position");



CREATE INDEX "profile_notes_author_idx" ON "public"."profile_notes" USING "btree" ("author_user_id");



CREATE INDEX "profile_notes_page_idx" ON "public"."profile_notes" USING "btree" ("profile_user_id", "created_at" DESC);



CREATE INDEX "score_history_name_submitted_at_idx" ON "public"."score_history" USING "btree" ("lower"("player_name"), "submitted_at" DESC);



CREATE INDEX "score_history_submitted_at_idx" ON "public"."score_history" USING "btree" ("submitted_at" DESC);



CREATE UNIQUE INDEX "ux_leaderboard_player_mode" ON "public"."leaderboard" USING "btree" ("player_id", "game_mode");



CREATE UNIQUE INDEX "ux_member_library_slot" ON "public"."member_library" USING "btree" ("user_id", "kind", "lower"("name"));



CREATE UNIQUE INDEX "ux_player_registry_name_ci" ON "public"."player_registry" USING "btree" ("player_name");



CREATE UNIQUE INDEX "ux_profiles_one_demo" ON "public"."profiles" USING "btree" ((true)) WHERE "is_demo";



CREATE UNIQUE INDEX "ux_visibility_circles_owner_lower_name" ON "public"."visibility_circles" USING "btree" ("owner", "lower"("name"));



CREATE INDEX "visibility_circle_members_member_idx" ON "public"."visibility_circle_members" USING "btree" ("member");



CREATE INDEX "visibility_circles_owner_idx" ON "public"."visibility_circles" USING "btree" ("owner");



CREATE OR REPLACE TRIGGER "bug_report_rate_limit_t" BEFORE INSERT ON "public"."bug_report" FOR EACH ROW EXECUTE FUNCTION "public"."bug_report_rate_limit"();



CREATE OR REPLACE TRIGGER "chat_messages_author_guard" BEFORE INSERT OR UPDATE ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."chat_messages_author_guard"();



CREATE OR REPLACE TRIGGER "chronicle_activities_drop_certain" AFTER UPDATE OF "visibility" ON "public"."chronicle_activities" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget_on_leaving"('chronicle_activity', 'id', 'visibility');



CREATE OR REPLACE TRIGGER "chronicle_activities_forget_certain" AFTER DELETE ON "public"."chronicle_activities" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget"('chronicle_activity');



CREATE OR REPLACE TRIGGER "chronicle_activities_tier_sync" BEFORE INSERT OR UPDATE OF "shared", "visibility" ON "public"."chronicle_activities" FOR EACH ROW EXECUTE FUNCTION "public"."chronicle_tier_sync"();



CREATE OR REPLACE TRIGGER "chronicle_goals_drop_certain" AFTER UPDATE OF "visibility" ON "public"."chronicle_goals" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget_on_leaving"('chronicle_goal', 'id', 'visibility');



CREATE OR REPLACE TRIGGER "chronicle_goals_forget_certain" AFTER DELETE ON "public"."chronicle_goals" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget"('chronicle_goal');



CREATE OR REPLACE TRIGGER "chronicle_goals_tier_sync" BEFORE INSERT OR UPDATE OF "shared", "visibility" ON "public"."chronicle_goals" FOR EACH ROW EXECUTE FUNCTION "public"."chronicle_tier_sync"();



CREATE OR REPLACE TRIGGER "circuit_group_chat_room" AFTER INSERT ON "public"."circuit_groups" FOR EACH ROW EXECUTE FUNCTION "public"."chat_room_for_new_group"();



CREATE OR REPLACE TRIGGER "circuit_movies_stamp_creator" BEFORE INSERT OR UPDATE ON "public"."circuit_movies" FOR EACH ROW EXECUTE FUNCTION "public"."circuit_movie_stamp_creator"();



CREATE OR REPLACE TRIGGER "circuit_people_drop_certain" AFTER UPDATE OF "visibility" ON "public"."circuit_people" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget_on_leaving"('circuit_person', 'id', 'visibility');



CREATE OR REPLACE TRIGGER "circuit_people_forget_certain" AFTER DELETE ON "public"."circuit_people" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget"('circuit_person');



CREATE OR REPLACE TRIGGER "circuit_people_tier_clamp" BEFORE INSERT OR UPDATE OF "visibility", "owner_user_id" ON "public"."circuit_people" FOR EACH ROW EXECUTE FUNCTION "public"."circuit_person_tier_clamp"();



CREATE OR REPLACE TRIGGER "circuit_watchlist_stamp_adder" BEFORE INSERT OR UPDATE ON "public"."circuit_watchlist" FOR EACH ROW EXECUTE FUNCTION "public"."watchlist_stamp_adder"();



CREATE OR REPLACE TRIGGER "leaderboard_best_score" BEFORE UPDATE ON "public"."leaderboard" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_best_score"();



CREATE OR REPLACE TRIGGER "player_registry_default_reveal" BEFORE INSERT OR UPDATE ON "public"."player_registry" FOR EACH ROW EXECUTE FUNCTION "public"."player_registry_default_reveal"();



CREATE OR REPLACE TRIGGER "player_registry_drop_certain" AFTER UPDATE OF "visibility" ON "public"."player_registry" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget_on_leaving"('player_registry', 'id', 'visibility');



CREATE OR REPLACE TRIGGER "player_registry_forget_certain" AFTER DELETE ON "public"."player_registry" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget"('player_registry');



CREATE OR REPLACE TRIGGER "profile_blocks_drop_certain" AFTER UPDATE OF "visibility" ON "public"."profile_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget_on_leaving"('profile_block', 'id', 'visibility');



CREATE OR REPLACE TRIGGER "profile_blocks_forget_certain" AFTER DELETE ON "public"."profile_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget"('profile_block');



CREATE OR REPLACE TRIGGER "profiles_drop_certain_activity" AFTER UPDATE OF "activity_visibility" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."visibility_certain_forget_on_leaving"('profile_activity', 'user_id', 'activity_visibility');



CREATE OR REPLACE TRIGGER "profiles_only_the_admin_demos" BEFORE INSERT OR UPDATE OF "is_demo", "user_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."only_the_admin_demos"();



CREATE OR REPLACE TRIGGER "trg_circuit_watchlist_default_group" BEFORE INSERT ON "public"."circuit_watchlist" FOR EACH ROW EXECUTE FUNCTION "public"."circuit_default_group"();



CREATE OR REPLACE TRIGGER "trg_leaderboard_no_score_drop" BEFORE UPDATE ON "public"."leaderboard" FOR EACH ROW EXECUTE FUNCTION "public"."leaderboard_no_score_drop"();



ALTER TABLE ONLY "finance"."allocations"
    ADD CONSTRAINT "allocations_family_account_fk" FOREIGN KEY ("family_account_id") REFERENCES "finance"."family_accounts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "finance"."family_accounts"
    ADD CONSTRAINT "family_accounts_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "finance"."family_contributions"
    ADD CONSTRAINT "family_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "finance"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."account_features"
    ADD CONSTRAINT "account_features_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_reads"
    ADD CONSTRAINT "activity_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bug_report"
    ADD CONSTRAINT "bug_report_reporter_fkey" FOREIGN KEY ("reporter") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_reads"
    ADD CONSTRAINT "chat_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_room_members"
    ADD CONSTRAINT "chat_room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_rooms"
    ADD CONSTRAINT "chat_rooms_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."circuit_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_activities"
    ADD CONSTRAINT "chronicle_activities_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_entries"
    ADD CONSTRAINT "chronicle_entries_activity_fkey" FOREIGN KEY ("activity") REFERENCES "public"."chronicle_activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_entries"
    ADD CONSTRAINT "chronicle_entries_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_entries"
    ADD CONSTRAINT "chronicle_entries_picture_fkey" FOREIGN KEY ("picture") REFERENCES "public"."member_pictures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chronicle_goals"
    ADD CONSTRAINT "chronicle_goals_activity_fkey" FOREIGN KEY ("activity") REFERENCES "public"."chronicle_activities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chronicle_goals"
    ADD CONSTRAINT "chronicle_goals_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_notes"
    ADD CONSTRAINT "chronicle_notes_entry_fkey" FOREIGN KEY ("entry") REFERENCES "public"."chronicle_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_notes"
    ADD CONSTRAINT "chronicle_notes_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_plans"
    ADD CONSTRAINT "chronicle_plans_activity_fkey" FOREIGN KEY ("activity") REFERENCES "public"."chronicle_activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_plans"
    ADD CONSTRAINT "chronicle_plans_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chronicle_routines"
    ADD CONSTRAINT "chronicle_routines_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_group_members"
    ADD CONSTRAINT "circuit_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."circuit_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_group_members"
    ADD CONSTRAINT "circuit_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_groups"
    ADD CONSTRAINT "circuit_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_log_comments"
    ADD CONSTRAINT "circuit_log_comments_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "public"."circuit_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_log_comments"
    ADD CONSTRAINT "circuit_log_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_log_reactions"
    ADD CONSTRAINT "circuit_log_reactions_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "public"."circuit_logs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_log_reactions"
    ADD CONSTRAINT "circuit_log_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_logs"
    ADD CONSTRAINT "circuit_logs_picture_fkey" FOREIGN KEY ("picture") REFERENCES "public"."member_pictures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."circuit_movies"
    ADD CONSTRAINT "circuit_movies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."circuit_movies"
    ADD CONSTRAINT "circuit_movies_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."circuit_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_people"
    ADD CONSTRAINT "circuit_people_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."circuit_person_groups"
    ADD CONSTRAINT "circuit_person_groups_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."circuit_person_groups"
    ADD CONSTRAINT "circuit_person_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."circuit_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_person_groups"
    ADD CONSTRAINT "circuit_person_groups_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."circuit_people"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_ratings"
    ADD CONSTRAINT "circuit_ratings_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "public"."circuit_movies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_ratings"
    ADD CONSTRAINT "circuit_ratings_picture_fkey" FOREIGN KEY ("picture") REFERENCES "public"."member_pictures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."circuit_ratings"
    ADD CONSTRAINT "circuit_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_watchlist"
    ADD CONSTRAINT "circuit_watchlist_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."circuit_watchlist"
    ADD CONSTRAINT "circuit_watchlist_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."circuit_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_watchlist"
    ADD CONSTRAINT "circuit_watchlist_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leaderboard"
    ADD CONSTRAINT "fk_leaderboard_player" FOREIGN KEY ("player_id") REFERENCES "public"."player_registry"("id");



ALTER TABLE ONLY "public"."score_history"
    ADD CONSTRAINT "fk_scorehistory_player" FOREIGN KEY ("player_id") REFERENCES "public"."player_registry"("id");



ALTER TABLE ONLY "public"."trophies"
    ADD CONSTRAINT "fk_trophies_leaderboard" FOREIGN KEY ("leaderboard_id") REFERENCES "public"."leaderboard"("id");



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leaderboard"
    ADD CONSTRAINT "leaderboard_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."player_registry"("id");



ALTER TABLE ONLY "public"."lounge_message_authors"
    ADD CONSTRAINT "lounge_message_authors_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lounge_message_authors"
    ADD CONSTRAINT "lounge_message_authors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_library"
    ADD CONSTRAINT "member_library_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_pictures"
    ADD CONSTRAINT "member_pictures_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."park_maps"
    ADD CONSTRAINT "park_maps_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."park_room_invites"
    ADD CONSTRAINT "park_room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."park_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."park_room_invites"
    ADD CONSTRAINT "park_room_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."park_rooms"
    ADD CONSTRAINT "park_rooms_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "public"."park_maps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."park_rooms"
    ADD CONSTRAINT "park_rooms_owner_fkey" FOREIGN KEY ("owner") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."player_registry"
    ADD CONSTRAINT "player_registry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pool_people"
    ADD CONSTRAINT "pool_people_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pool_people"
    ADD CONSTRAINT "pool_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pool_votes"
    ADD CONSTRAINT "pool_votes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."circuit_watchlist"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pool_votes"
    ADD CONSTRAINT "pool_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pools"
    ADD CONSTRAINT "pools_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_blocks"
    ADD CONSTRAINT "profile_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_notes"
    ADD CONSTRAINT "profile_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_notes"
    ADD CONSTRAINT "profile_notes_profile_user_id_fkey" FOREIGN KEY ("profile_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_room_invites"
    ADD CONSTRAINT "profile_room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."profile_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_room_invites"
    ADD CONSTRAINT "profile_room_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_rooms"
    ADD CONSTRAINT "profile_rooms_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_fkey" FOREIGN KEY ("username") REFERENCES "public"."player_registry"("player_name") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."score_history"
    ADD CONSTRAINT "score_history_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."player_registry"("id");



ALTER TABLE ONLY "public"."site_content"
    ADD CONSTRAINT "site_content_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trophies"
    ADD CONSTRAINT "trophies_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "public"."leaderboard"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visibility_certain"
    ADD CONSTRAINT "visibility_certain_friend_fkey" FOREIGN KEY ("friend") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visibility_certain"
    ADD CONSTRAINT "visibility_certain_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visibility_circle_members"
    ADD CONSTRAINT "visibility_circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "public"."visibility_circles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visibility_circle_members"
    ADD CONSTRAINT "visibility_circle_members_member_fkey" FOREIGN KEY ("member") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visibility_circles"
    ADD CONSTRAINT "visibility_circles_owner_fkey" FOREIGN KEY ("owner") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can manage own preferences" ON "finance"."user_preferences" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "finance"."allocations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allocations_select" ON "finance"."allocations" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "finance"."coingecko_ids" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "finance"."cost_basis_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "finance"."executed_trades" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "executed_trades_select" ON "finance"."executed_trades" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "finance"."family_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "family_accounts_select" ON "finance"."family_accounts" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "finance"."family_contributions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "finance"."price_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "price_cache_select" ON "finance"."price_cache" FOR SELECT USING (true);



ALTER TABLE "finance"."price_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "finance"."symbol_designations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "finance"."user_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Allow public read" ON "public"."leaderboard" FOR SELECT USING (true);



ALTER TABLE "public"."account_features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_features_admin_all" ON "public"."account_features" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "account_features_self_read" ON "public"."account_features" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."activity_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_reads_own_insert" ON "public"."activity_reads" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "activity_reads_own_select" ON "public"."activity_reads" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "activity_reads_own_update" ON "public"."activity_reads" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_users_select_self" ON "public"."admin_users" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "admins clear reports" ON "public"."bug_report" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admins manage reports" ON "public"."bug_report" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admins read reports" ON "public"."bug_report" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "anyone can read site content" ON "public"."site_content" FOR SELECT USING (true);



ALTER TABLE "public"."bug_report" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cg_delete" ON "public"."circuit_groups" FOR DELETE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "cg_insert" ON "public"."circuit_groups" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "cg_modify" ON "public"."circuit_groups" FOR UPDATE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("created_by" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "cg_select" ON "public"."circuit_groups" FOR SELECT TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."circuit_is_member"("id")));



CREATE POLICY "cgm_delete" ON "public"."circuit_group_members" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_group_members"."group_id") AND ("g"."created_by" = "auth"."uid"()))))));



CREATE POLICY "cgm_insert" ON "public"."circuit_group_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_group_members"."group_id") AND ("g"."created_by" = "auth"."uid"()))))));



CREATE POLICY "cgm_select" ON "public"."circuit_group_members" FOR SELECT TO "authenticated" USING ("public"."circuit_is_member"("group_id"));



CREATE POLICY "cgm_update" ON "public"."circuit_group_members" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_group_members"."group_id") AND ("g"."created_by" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_group_members"."group_id") AND ("g"."created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_select" ON "public"."chat_messages" FOR SELECT USING ("public"."chat_room_member"("room_id"));



ALTER TABLE "public"."chat_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_reads_own_select" ON "public"."chat_reads" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "chat_reads_own_update" ON "public"."chat_reads" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "chat_reads_own_write" ON "public"."chat_reads" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."chat_room_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_room_members_select" ON "public"."chat_room_members" FOR SELECT USING ("public"."chat_room_member"("room_id"));



ALTER TABLE "public"."chat_rooms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_rooms_select" ON "public"."chat_rooms" FOR SELECT USING ("public"."chat_room_member"("id"));



ALTER TABLE "public"."chronicle_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronicle_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronicle_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronicle_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronicle_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chronicle_routines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."circuit_group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."circuit_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."circuit_log_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_log_comments_not_suspended" ON "public"."circuit_log_comments" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



ALTER TABLE "public"."circuit_log_reactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_log_reactions_not_suspended" ON "public"."circuit_log_reactions" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



ALTER TABLE "public"."circuit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_logs_delete" ON "public"."circuit_logs" FOR DELETE TO "authenticated" USING ("public"."circuit_can_edit_person"("person_id"));



CREATE POLICY "circuit_logs_insert" ON "public"."circuit_logs" FOR INSERT TO "authenticated" WITH CHECK ("public"."circuit_can_edit_person"("person_id"));



CREATE POLICY "circuit_logs_not_suspended" ON "public"."circuit_logs" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "circuit_logs_select" ON "public"."circuit_logs" FOR SELECT TO "authenticated" USING ("public"."circuit_can_see_person"("person_id"));



CREATE POLICY "circuit_logs_update" ON "public"."circuit_logs" FOR UPDATE TO "authenticated" USING ("public"."circuit_can_edit_person"("person_id")) WITH CHECK ("public"."circuit_can_edit_person"("person_id"));



ALTER TABLE "public"."circuit_movies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_movies_delete" ON "public"."circuit_movies" FOR DELETE TO "authenticated" USING (("public"."circuit_is_member"("group_id") OR ("created_by" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "circuit_movies_insert" ON "public"."circuit_movies" FOR INSERT TO "authenticated" WITH CHECK (("public"."circuit_is_member"("group_id") OR (("group_id" IS NULL) AND ("auth"."uid"() IS NOT NULL)) OR "public"."is_admin"()));



CREATE POLICY "circuit_movies_not_suspended" ON "public"."circuit_movies" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "circuit_movies_select" ON "public"."circuit_movies" FOR SELECT TO "authenticated" USING (("public"."movie_visible"("id") OR "public"."is_admin"()));



CREATE POLICY "circuit_movies_update" ON "public"."circuit_movies" FOR UPDATE TO "authenticated" USING (("public"."circuit_is_member"("group_id") OR ("created_by" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."circuit_people" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_people_delete" ON "public"."circuit_people" FOR DELETE TO "authenticated" USING ("public"."circuit_can_edit_person"("id"));



CREATE POLICY "circuit_people_insert" ON "public"."circuit_people" FOR INSERT TO "authenticated" WITH CHECK ((("owner_user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "circuit_people_not_suspended" ON "public"."circuit_people" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "circuit_people_select" ON "public"."circuit_people" FOR SELECT TO "authenticated" USING ("public"."circuit_can_see_person"("id"));



CREATE POLICY "circuit_people_update" ON "public"."circuit_people" FOR UPDATE TO "authenticated" USING ("public"."circuit_can_edit_person"("id")) WITH CHECK ("public"."circuit_can_edit_person"("id"));



ALTER TABLE "public"."circuit_person_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."circuit_ratings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_ratings_delete" ON "public"."circuit_ratings" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "circuit_ratings_insert" ON "public"."circuit_ratings" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."movie_visible"("movie_id")));



CREATE POLICY "circuit_ratings_not_suspended" ON "public"."circuit_ratings" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "circuit_ratings_select" ON "public"."circuit_ratings" FOR SELECT TO "authenticated" USING ("public"."movie_visible"("movie_id"));



CREATE POLICY "circuit_ratings_update" ON "public"."circuit_ratings" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."circuit_watchlist" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "circuit_watchlist_delete" ON "public"."circuit_watchlist" FOR DELETE TO "authenticated" USING ((("added_by" = "auth"."uid"()) OR (("pool_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."pools" "p"
  WHERE (("p"."id" = "circuit_watchlist"."pool_id") AND ("p"."owner_user_id" = "auth"."uid"()))))) OR (("pool_id" IS NULL) AND "public"."circuit_is_member"("group_id")) OR "public"."is_admin"()));



CREATE POLICY "circuit_watchlist_insert" ON "public"."circuit_watchlist" FOR INSERT WITH CHECK (((("pool_id" IS NOT NULL) AND "public"."pool_visible"("pool_id")) OR (("pool_id" IS NULL) AND "public"."circuit_is_member"("group_id")) OR "public"."is_admin"()));



CREATE POLICY "circuit_watchlist_not_suspended" ON "public"."circuit_watchlist" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "circuit_watchlist_select" ON "public"."circuit_watchlist" FOR SELECT USING (((("pool_id" IS NOT NULL) AND "public"."pool_visible"("pool_id")) OR (("pool_id" IS NULL) AND "public"."circuit_is_member"("group_id")) OR "public"."is_admin"()));



CREATE POLICY "circuit_watchlist_update" ON "public"."circuit_watchlist" FOR UPDATE USING (((("pool_id" IS NOT NULL) AND "public"."pool_visible"("pool_id")) OR (("pool_id" IS NULL) AND "public"."circuit_is_member"("group_id")) OR "public"."is_admin"())) WITH CHECK (((("pool_id" IS NOT NULL) AND "public"."pool_visible"("pool_id")) OR (("pool_id" IS NULL) AND "public"."circuit_is_member"("group_id")) OR "public"."is_admin"()));



CREATE POLICY "clc_delete" ON "public"."circuit_log_comments" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "clc_insert" ON "public"."circuit_log_comments" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."circuit_can_see_log"("log_id")));



CREATE POLICY "clc_select" ON "public"."circuit_log_comments" FOR SELECT TO "authenticated" USING ("public"."circuit_can_see_log"("log_id"));



CREATE POLICY "clc_update" ON "public"."circuit_log_comments" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "clr_delete" ON "public"."circuit_log_reactions" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "clr_insert" ON "public"."circuit_log_reactions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."circuit_can_see_log"("log_id")));



CREATE POLICY "clr_select" ON "public"."circuit_log_reactions" FOR SELECT TO "authenticated" USING ("public"."circuit_can_see_log"("log_id"));



ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cpg_select" ON "public"."circuit_person_groups" FOR SELECT TO "authenticated" USING ("public"."circuit_is_member"("group_id"));



CREATE POLICY "cpg_write" ON "public"."circuit_person_groups" TO "authenticated" USING (("public"."is_admin"() OR ("public"."circuit_can_edit_person"("person_id") AND "public"."circuit_is_member"("group_id")) OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_person_groups"."group_id") AND ("g"."created_by" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR ("public"."circuit_can_edit_person"("person_id") AND "public"."circuit_is_member"("group_id")) OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_person_groups"."group_id") AND ("g"."created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."friendships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "friendships_select" ON "public"."friendships" FOR SELECT USING ((("auth"."uid"() = "user_a") OR ("auth"."uid"() = "user_b")));



ALTER TABLE "public"."invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leaderboard" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leaderboard_select" ON "public"."leaderboard" FOR SELECT USING (true);



ALTER TABLE "public"."lounge_message_authors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_library" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_pictures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."park_maps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."park_room_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."park_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."picture_orphans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."player_registry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "player_registry_select" ON "public"."player_registry" FOR SELECT USING (true);



ALTER TABLE "public"."pool_people" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pool_people_delete" ON "public"."pool_people" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."pools" "p"
  WHERE (("p"."id" = "pool_people"."pool_id") AND ("p"."owner_user_id" = "auth"."uid"()))))));



CREATE POLICY "pool_people_insert" ON "public"."pool_people" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."pools" "p"
  WHERE (("p"."id" = "pool_people"."pool_id") AND ("p"."owner_user_id" = "auth"."uid"())))) AND "public"."pool_can_invite"("user_id")));



CREATE POLICY "pool_people_not_suspended" ON "public"."pool_people" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "pool_people_select" ON "public"."pool_people" FOR SELECT TO "authenticated" USING (("public"."pool_visible"("pool_id") OR "public"."is_admin"()));



ALTER TABLE "public"."pool_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pool_votes_delete" ON "public"."pool_votes" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "pool_votes_insert" ON "public"."pool_votes" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."pool_item_visible"("item_id")));



CREATE POLICY "pool_votes_not_suspended" ON "public"."pool_votes" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "pool_votes_select" ON "public"."pool_votes" FOR SELECT TO "authenticated" USING (("public"."pool_item_visible"("item_id") OR "public"."is_admin"()));



ALTER TABLE "public"."pools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pools_delete" ON "public"."pools" FOR DELETE TO "authenticated" USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "pools_insert" ON "public"."pools" FOR INSERT TO "authenticated" WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "pools_not_suspended" ON "public"."pools" AS RESTRICTIVE TO "authenticated" USING ((NOT "public"."is_suspended"("auth"."uid"()))) WITH CHECK ((NOT "public"."is_suspended"("auth"."uid"())));



CREATE POLICY "pools_select" ON "public"."pools" FOR SELECT TO "authenticated" USING (("public"."pool_visible"("id") OR "public"."is_admin"()));



CREATE POLICY "pools_update" ON "public"."pools" FOR UPDATE TO "authenticated" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



ALTER TABLE "public"."profile_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_room_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "report a bug" ON "public"."bug_report" FOR INSERT TO "authenticated" WITH CHECK (("reporter" = "auth"."uid"()));



ALTER TABLE "public"."round_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "round_results_select" ON "public"."round_results" FOR SELECT USING (true);



ALTER TABLE "public"."score_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "score_history_select" ON "public"."score_history" FOR SELECT USING (true);



ALTER TABLE "public"."site_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trophies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trophies_select" ON "public"."trophies" FOR SELECT USING (true);



ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_select_self" ON "public"."user_roles" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."visibility_certain" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visibility_circle_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visibility_circles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "finance" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "finance"."_held_avg_costs"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."account_basis"("p_account" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."account_ledger"("p_account" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."account_payload"("p_account" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."family_share_at"("p_symbol" "text", "p_platform" "text", "p_at" timestamp with time zone) FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."fund_today"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."holding_periods"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."integrity_checks"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."position_overcredit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."refresh_prices"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."store_prices"("p_prices" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "finance"."trades_needing_review"("p_user" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_circuit_add_self"("p_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_circuit_add_self"("p_group" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_fund_timeline"("p_uid" "uuid", "p_all" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_fund_timeline"("p_uid" "uuid", "p_all" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_self_to_circuit"("p_group" "uuid", "p_name" "text", "p_color" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_self_to_circuit"("p_group" "uuid", "p_name" "text", "p_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_self_to_circuit"("p_group" "uuid", "p_name" "text", "p_color" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_add_contribution"("p_amount" numeric, "p_on" "date", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_add_contribution"("p_amount" numeric, "p_on" "date", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_add_contribution"("p_amount" numeric, "p_on" "date", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_attention"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_attention"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_attention"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_correct_position"("p_symbol" "text", "p_platform" "text", "p_true_units" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_correct_position"("p_symbol" "text", "p_platform" "text", "p_true_units" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_correct_position"("p_symbol" "text", "p_platform" "text", "p_true_units" numeric) TO "service_role";



GRANT SELECT ON TABLE "finance"."family_accounts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_create_family_account"("p_owner" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_family_account"("p_owner" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_family_account"("p_owner" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_contribution"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_contribution"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_contribution"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_family_account"("p_account" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_family_account"("p_account" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_family_account"("p_account" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_member"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_member"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_member"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_even_split_trades"("p_user_id" "uuid", "p_only_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_even_split_trades"("p_user_id" "uuid", "p_only_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_even_split_trades"("p_user_id" "uuid", "p_only_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_fund_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_fund_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_fund_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_get_member"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_get_member"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_member"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_get_portfolios"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_get_portfolios"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_portfolios"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_get_timeline"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_get_timeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_get_timeline"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_import_trades"("p_user_id" "uuid", "p_trades" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_import_trades"("p_user_id" "uuid", "p_trades" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_import_trades"("p_user_id" "uuid", "p_trades" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_link_snake_handle"("p_registry_id" bigint, "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_link_snake_handle"("p_registry_id" bigint, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_link_snake_handle"("p_registry_id" bigint, "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_contact_messages"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_contact_messages"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_contact_messages"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_contributions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_contributions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_contributions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_positions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_positions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_positions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_snake_handles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_snake_handles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_snake_handles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_member_features"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_member_features"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_member_features"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_members_without_age_band"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_members_without_age_band"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_members_without_age_band"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_picture_totals"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_picture_totals"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_picture_totals"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_reassign_family_account"("p_account" "uuid", "p_new_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reassign_family_account"("p_account" "uuid", "p_new_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reassign_family_account"("p_account" "uuid", "p_new_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_recent_reviews"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_recent_reviews"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_recent_reviews"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reconciliation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reconciliation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reconciliation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_refresh_prices"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_refresh_prices"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_refresh_prices"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_contact_handled"("p_id" "uuid", "p_handled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_contact_handled"("p_id" "uuid", "p_handled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_contact_handled"("p_id" "uuid", "p_handled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_feature"("p_user_id" "uuid", "p_feature" "text", "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_feature"("p_user_id" "uuid", "p_feature" "text", "p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_feature"("p_user_id" "uuid", "p_feature" "text", "p_enabled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_feed_consent"("p_username" "text", "p_age_band" "text", "p_feed_opt_in" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_feed_consent"("p_username" "text", "p_age_band" "text", "p_feed_opt_in" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_set_feed_consent"("p_username" "text", "p_age_band" "text", "p_feed_opt_in" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_set_price"("p_symbol" "text", "p_price" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_price"("p_symbol" "text", "p_price" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_price"("p_symbol" "text", "p_price" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_suspended"("p_user_id" "uuid", "p_suspended" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_suspended"("p_user_id" "uuid", "p_suspended" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_suspended"("p_user_id" "uuid", "p_suspended" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_symbol_designation"("p_symbol" "text", "p_platform" "text", "p_family" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_symbol_designation"("p_symbol" "text", "p_platform" "text", "p_family" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_symbol_designation"("p_symbol" "text", "p_platform" "text", "p_family" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_trade_allocation"("p_trade" "uuid", "p_fraction" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_trade_allocation"("p_trade" "uuid", "p_fraction" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_trade_allocation"("p_trade" "uuid", "p_fraction" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_tax_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_tax_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_tax_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_unallocated_trades"("p_limit" integer, "p_imported_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_unallocated_trades"("p_limit" integer, "p_imported_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_unallocated_trades"("p_limit" integer, "p_imported_since" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_update_family_account"("p_account" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_update_family_account"("p_account" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_family_account"("p_account" "uuid", "p_name" "text", "p_dollar_per_day" numeric, "p_start_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_update_member"("p_user_id" "uuid", "p_first_name" "text", "p_email" "text", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_update_member"("p_user_id" "uuid", "p_first_name" "text", "p_email" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_member"("p_user_id" "uuid", "p_first_name" "text", "p_email" "text", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."are_friends"("u1" "uuid", "u2" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."are_friends"("u1" "uuid", "u2" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."are_friends"("u1" "uuid", "u2" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bug_report_rate_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bug_report_rate_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_see"("p_owner" "uuid", "p_tier" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_see"("p_owner" "uuid", "p_tier" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_see"("p_owner" "uuid", "p_tier" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_see_item"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_see_item"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_see_item"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chat_messages_author_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chat_messages_author_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chat_room_for_new_group"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chat_room_for_new_group"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chat_room_member"("p_room" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chat_room_member"("p_room" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_room_member"("p_room" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chat_topic_member"("p_topic" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chat_topic_member"("p_topic" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_topic_member"("p_topic" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_activities_mine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_activities_mine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_activities_mine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_activity_archive"("p_id" "uuid", "p_archived" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_activity_archive"("p_id" "uuid", "p_archived" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_activity_archive"("p_id" "uuid", "p_archived" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_activity_save"("p_id" "uuid", "p_name" "text", "p_cat" "text", "p_colour" "text", "p_metric" "text", "p_session" integer, "p_shared" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_activity_save"("p_id" "uuid", "p_name" "text", "p_cat" "text", "p_colour" "text", "p_metric" "text", "p_session" integer, "p_shared" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_activity_save"("p_id" "uuid", "p_name" "text", "p_cat" "text", "p_colour" "text", "p_metric" "text", "p_session" integer, "p_shared" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_activity_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_activity_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_activity_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_activity_share"("p_id" "uuid", "p_on" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_activity_share"("p_id" "uuid", "p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_activity_share"("p_id" "uuid", "p_on" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entries_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entries_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entries_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entry_add"("p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entry_add"("p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entry_add"("p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entry_amount"("p_id" "uuid", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entry_amount"("p_id" "uuid", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entry_amount"("p_id" "uuid", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entry_drop"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entry_drop"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entry_drop"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entry_edit"("p_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text", "p_activity" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entry_edit"("p_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text", "p_activity" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entry_edit"("p_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text", "p_activity" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entry_picture"("p_entry" "uuid", "p_picture" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entry_picture"("p_entry" "uuid", "p_picture" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entry_picture"("p_entry" "uuid", "p_picture" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_entry_quality"("p_id" "uuid", "p_quality" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_entry_quality"("p_id" "uuid", "p_quality" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_entry_quality"("p_id" "uuid", "p_quality" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_export"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_export"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_export"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_friends_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_friends_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_friends_log"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_goal_drop"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_goal_drop"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_goal_drop"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_goal_progress"("p_id" "uuid", "p_progress" numeric, "p_done" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_goal_progress"("p_id" "uuid", "p_progress" numeric, "p_done" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_goal_progress"("p_id" "uuid", "p_progress" numeric, "p_done" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_goal_save"("p_id" "uuid", "p_title" "text", "p_scope" "text", "p_anchor" "date", "p_repeat" integer, "p_target" numeric, "p_unit" "text", "p_note" "text", "p_sort" integer, "p_activity" "uuid", "p_cat" "text", "p_counts" "text", "p_est" integer, "p_priority" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_goal_save"("p_id" "uuid", "p_title" "text", "p_scope" "text", "p_anchor" "date", "p_repeat" integer, "p_target" numeric, "p_unit" "text", "p_note" "text", "p_sort" integer, "p_activity" "uuid", "p_cat" "text", "p_counts" "text", "p_est" integer, "p_priority" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_goal_save"("p_id" "uuid", "p_title" "text", "p_scope" "text", "p_anchor" "date", "p_repeat" integer, "p_target" numeric, "p_unit" "text", "p_note" "text", "p_sort" integer, "p_activity" "uuid", "p_cat" "text", "p_counts" "text", "p_est" integer, "p_priority" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_goal_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_goal_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_goal_set_visibility"("p_id" "uuid", "p_tier" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_goal_share"("p_id" "uuid", "p_on" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_goal_share"("p_id" "uuid", "p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_goal_share"("p_id" "uuid", "p_on" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_goals_mine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_goals_mine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_goals_mine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_import"("p_doc" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_import"("p_doc" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_import"("p_doc" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_moments"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_moments"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_moments"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_moods"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_moods"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_moods"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_note_add"("p_entry" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_note_add"("p_entry" "uuid", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_note_add"("p_entry" "uuid", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_note_drop"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_note_drop"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_note_drop"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_note_edit"("p_id" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_note_edit"("p_id" "uuid", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_note_edit"("p_id" "uuid", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_plan_did"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_plan_did"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_plan_did"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_plan_drop"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_plan_drop"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_plan_drop"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_plan_save"("p_id" "uuid", "p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_plan_save"("p_id" "uuid", "p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_plan_save"("p_id" "uuid", "p_activity" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_plans_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_plans_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_plans_between"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_routine_drop"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_routine_drop"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_routine_drop"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_routine_save"("p_id" "uuid", "p_name" "text", "p_steps" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_routine_save"("p_id" "uuid", "p_name" "text", "p_steps" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_routine_save"("p_id" "uuid", "p_name" "text", "p_steps" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_routines_mine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_routines_mine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_routines_mine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_running_fix"("p_from" timestamp with time zone, "p_activity" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_running_fix"("p_from" timestamp with time zone, "p_activity" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_running_fix"("p_from" timestamp with time zone, "p_activity" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_share_timeline"("p_on" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_share_timeline"("p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_share_timeline"("p_on" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_shares_timeline"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_shares_timeline"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_shares_timeline"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_sharing_mine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_sharing_mine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_sharing_mine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_since"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_since"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_since"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_spans"("p_asks" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_spans"("p_asks" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_spans"("p_asks" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_spread"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_spread"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_start"("p_activity" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_start"("p_activity" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_start"("p_activity" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_stop"("p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_stop"("p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_stop"("p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_sum"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_activity" "uuid", "p_cat" "text", "p_what" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_sum"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_activity" "uuid", "p_cat" "text", "p_what" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_tally"("p_asks" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_tally"("p_asks" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_tally"("p_asks" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_tier_from_file"("p_vis" "text", "p_shared" boolean, "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_tier_from_file"("p_vis" "text", "p_shared" boolean, "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_tier_sync"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_tier_sync"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_totals"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_totals"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_totals"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."chronicle_visit"("p_module" "text", "p_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."chronicle_visit"("p_module" "text", "p_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."chronicle_visit"("p_module" "text", "p_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_can_edit_person"("p_person" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_can_edit_person"("p_person" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_can_edit_person"("p_person" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_can_see_log"("p_log" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_can_see_log"("p_log" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_can_see_log"("p_log" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_can_see_person"("p_person" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_can_see_person"("p_person" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_can_see_person"("p_person" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_default_group"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_default_group"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_group_is_public"("p_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_group_is_public"("p_group" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_is_member"("p_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_is_member"("p_group" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_is_member"("p_group" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_log_picture"("p_log" "text", "p_picture" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_log_picture"("p_log" "text", "p_picture" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_log_picture"("p_log" "text", "p_picture" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_movie_stamp_creator"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_movie_stamp_creator"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_person_tier_clamp"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_person_tier_clamp"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_public"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_public"() TO "anon";
GRANT ALL ON FUNCTION "public"."circuit_public"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_public"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."circuit_rating_picture"("p_movie" "text", "p_picture" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."circuit_rating_picture"("p_movie" "text", "p_picture" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."circuit_rating_picture"("p_movie" "text", "p_picture" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_my_reserved_snake_name"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_my_reserved_snake_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_my_reserved_snake_name"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_person"("p_person_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_person"("p_person_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_person"("p_person_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_snake_name"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_snake_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_snake_name"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."clamp_visibility"("p_owner" "uuid", "p_wanted" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clamp_visibility"("p_owner" "uuid", "p_wanted" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_park_room"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_park_room"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_park_room"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_profile_room"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_profile_room"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_profile_room"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_member_signup"("p_token" "uuid", "p_username" "text", "p_display_name" "text", "p_contact_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_member_signup"("p_token" "uuid", "p_username" "text", "p_display_name" "text", "p_contact_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_member_signup"("p_token" "uuid", "p_username" "text", "p_display_name" "text", "p_contact_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_circuit"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_circuit"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_circuit"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_invite"("p_class" "text", "p_label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_invite"("p_class" "text", "p_label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_invite"("p_class" "text", "p_label" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_circuit"("p_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_circuit"("p_group" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_circuit"("p_group" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_invite"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_invite"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_invite"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_profile_note"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_profile_note"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_profile_note"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."display_name"("p_user" "uuid", "p_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."display_name"("p_user" "uuid", "p_group" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."display_name"("p_user" "uuid", "p_group" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_best_score"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_best_score"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_best_score"("p_player_id" integer, "p_game_mode" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_best_score"("p_player_id" integer, "p_game_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_best_score"("p_player_id" integer, "p_game_mode" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feed_may_show"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feed_may_show"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feed_recent"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_per_member" integer, "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feed_recent"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_per_member" integer, "p_scope" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feed_recent"("p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_per_member" integer, "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_round_rpc"("p_room_id" "text", "p_round_id" "text", "p_game_mode" "text", "p_items" "jsonb", "p_players" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_round_rpc"("p_room_id" "text", "p_round_id" "text", "p_game_mode" "text", "p_items" "jsonb", "p_players" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_member_by_username"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_member_by_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_member_by_username"("p_username" "text") TO "service_role";



GRANT SELECT ON TABLE "finance"."allocations" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_allocations"("uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_allocations"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_allocations"("uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_demo_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_demo_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_demo_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_demo_profile"() TO "service_role";



GRANT SELECT ON TABLE "finance"."executed_trades" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_executed_trades"("uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_executed_trades"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_executed_trades"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_invite_by_token"("p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_invite_by_token"("p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_invite_by_token"("p_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_member_activity"("p_username" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_member_activity"("p_username" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_member_activity"("p_username" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_member_chronicle"("p_username" "text", "p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_member_chronicle"("p_username" "text", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_member_chronicle"("p_username" "text", "p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_member_profile"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_member_profile"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_member_profile"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_member_trophies"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_member_trophies"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_member_trophies"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_portfolio"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_portfolio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_portfolio"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_profile"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_public_page"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_public_page"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_public_page"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_timeline"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_timeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_timeline"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_park_room"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_park_room"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_park_room"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_park_room_map"("p_room" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_park_room_map"("p_room" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_park_room_map"("p_room" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_profile_blocks"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_blocks"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_blocks"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_profile_room"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_room"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_profile_room"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_activity"("p_username" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_activity"("p_username" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_activity"("p_username" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_activity"("p_username" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_profile"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_profile"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_profile"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_profile"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_usernames_for_users"("p_user_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_usernames_for_users"("p_user_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_usernames_for_users"("p_user_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."guestbook_open_to"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guestbook_open_to"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."guestbook_open_to"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_allocation"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_allocation"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_allocation"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_allocation"("uid" "uuid", "payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_allocation"("uid" "uuid", "payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_allocation"("uid" "uuid", "payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invite_to_park_room"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invite_to_park_room"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invite_to_park_room"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invite_to_profile_room"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invite_to_profile_room"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invite_to_profile_room"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_suspended"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_suspended"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_suspended"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."item_reaches_anyone"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."item_reaches_anyone"("p_owner" "uuid", "p_tier" "public"."visibility_tier", "p_item_kind" "text", "p_item_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_circuit"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_circuit"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_circuit"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leaderboard_no_score_drop"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leaderboard_no_score_drop"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."leave_circuit"("p_group" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leave_circuit"("p_group" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_circuit"("p_group" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."library_bodies"("p_slots" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."library_bodies"("p_slots" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."library_bodies"("p_slots" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."library_drop"("p_kind" "text", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."library_drop"("p_kind" "text", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."library_drop"("p_kind" "text", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."library_index"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."library_index"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."library_index"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."library_list"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."library_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."library_list"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."library_put"("p_kind" "text", "p_name" "text", "p_body" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."library_put"("p_kind" "text", "p_name" "text", "p_body" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."library_put"("p_kind" "text", "p_name" "text", "p_body" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."link_snake_names_to_accounts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_snake_names_to_accounts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_achievements"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_achievements"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_achievements"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_activity_notices"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_activity_notices"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_activity_notices"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_chat_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_chat_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_chat_overview"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_friends"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_friends"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_friends"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_fund_symbols"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_fund_symbols"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_fund_symbols"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_invites"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_invites"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_invites"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_member_directory"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_member_directory"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_member_directory"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_members"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_members"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_members"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_park_room_invites"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_park_room_invites"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_park_room_invites"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_profile_notes"("p_username" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_profile_notes"("p_username" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_profile_notes"("p_username" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_profile_room_invites"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_profile_room_invites"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_profile_room_invites"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_room_messages"("p_room" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_room_messages"("p_room" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_room_messages"("p_room" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_activity_seen"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_activity_seen"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_activity_seen"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_room_read"("p_room" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_room_read"("p_room" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_room_read"("p_room" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."may_i_publish_a_page"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."may_i_publish_a_page"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."may_i_publish_a_page"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."may_publish_a_page"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."may_publish_a_page"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."movie_visible"("p_movie" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."movie_visible"("p_movie" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."movie_visible"("p_movie" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_account"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_circuits"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_circuits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_circuits"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_features"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_features"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_features"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_fund_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_fund_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_fund_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_lounge_display_name"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_lounge_display_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_lounge_display_name"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_lounge_opt_in"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_lounge_opt_in"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_lounge_opt_in"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_park_room"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_park_room"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_park_room"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_profile_writable_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_profile_writable_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_profile_writable_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_snake_handles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_snake_handles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_snake_handles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_visibility_ceiling"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_visibility_ceiling"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_visibility_ceiling"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_visibility_circles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_visibility_circles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_visibility_circles"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."only_the_admin_demos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."only_the_admin_demos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_dm"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_dm"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_dm"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_park_room"("p_name" "text", "p_audience" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_park_room"("p_name" "text", "p_audience" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_park_room"("p_name" "text", "p_audience" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_park_rooms"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_park_rooms"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_park_rooms"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_profile_room"("p_audience" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_profile_room"("p_audience" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_profile_room"("p_audience" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."owns_item"("p_kind" "text", "p_id" "text", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."owns_item"("p_kind" "text", "p_id" "text", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."park_map_drop"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."park_map_drop"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."park_map_drop"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."park_map_get"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."park_map_get"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."park_map_get"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."park_map_mine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."park_map_mine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."park_map_mine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."park_map_put"("p_name" "text", "p_body" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."park_map_put"("p_name" "text", "p_body" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."park_map_put"("p_name" "text", "p_body" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."park_room_member"("p_room" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."park_room_member"("p_room" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."park_room_member"("p_room" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_alt"("p_id" "uuid", "p_alt" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_alt"("p_id" "uuid", "p_alt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."picture_alt"("p_id" "uuid", "p_alt" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_claim"("p_mime" "text", "p_bytes" integer, "p_thumb_bytes" integer, "p_w" integer, "p_h" integer, "p_alt" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_claim"("p_mime" "text", "p_bytes" integer, "p_thumb_bytes" integer, "p_w" integer, "p_h" integer, "p_alt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."picture_claim"("p_mime" "text", "p_bytes" integer, "p_thumb_bytes" integer, "p_w" integer, "p_h" integer, "p_alt" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_drop"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_drop"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."picture_drop"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_orphan_log"("p_owner" "uuid", "p_key" "text", "p_thumb_key" "text", "p_which" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_orphan_log"("p_owner" "uuid", "p_key" "text", "p_thumb_key" "text", "p_which" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_pending"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_pending"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."picture_pending"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_ready"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_ready"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."picture_ready"("p_id" "uuid", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."picture_ready"("p_id" "uuid", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pictures_i_can_see"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pictures_i_can_see"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pictures_i_can_see"("p_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."pictures_mine"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pictures_mine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pictures_mine"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."pictures_used"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pictures_used"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pictures_used"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."player_registry_default_reveal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."player_registry_default_reveal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."pool_can_invite"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pool_can_invite"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pool_can_invite"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pool_item_visible"("p_item" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pool_item_visible"("p_item" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pool_item_visible"("p_item" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pool_names"("p_pool" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pool_names"("p_pool" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pool_names"("p_pool" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pool_topic_member"("p_topic" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pool_topic_member"("p_topic" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pool_topic_member"("p_topic" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pool_visible"("p_pool" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pool_visible"("p_pool" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pool_visible"("p_pool" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."post_profile_note"("p_username" "text", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."post_profile_note"("p_username" "text", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."post_profile_note"("p_username" "text", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."presence_audience_ok"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."presence_audience_ok"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."presence_audience_ok"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."presence_topic_member"("p_topic" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."presence_topic_member"("p_topic" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."presence_topic_member"("p_topic" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."profile_room_member"("p_room" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profile_room_member"("p_room" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."profile_room_member"("p_room" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_friend"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_friend"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_friend"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rename_circuit"("p_group" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rename_circuit"("p_group" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_circuit"("p_group" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rename_my_handle"("p_new" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rename_my_handle"("p_new" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_my_handle"("p_new" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."renew_invite"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."renew_invite"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."renew_invite"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_friend"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_friend"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_friend"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_friend"("p_username" "text", "p_accept" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_friend"("p_username" "text", "p_accept" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."respond_friend"("p_username" "text", "p_accept" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_my_profile_blocks"("p_blocks" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_my_profile_blocks"("p_blocks" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_my_profile_blocks"("p_blocks" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_site_content"("p_id" "text", "p_doc" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_site_content"("p_id" "text", "p_doc" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_site_content"("p_id" "text", "p_doc" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_chat_message"("p_room" "uuid", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_chat_message"("p_room" "uuid", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_chat_message"("p_room" "uuid", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_lounge_display_name"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_lounge_display_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_lounge_display_name"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_lounge_opt_in"("p_on" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_lounge_opt_in"("p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_lounge_opt_in"("p_on" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_activity_visibility"("p_tier" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_activity_visibility"("p_tier" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_activity_visibility"("p_tier" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_circuit_nickname"("p_group" "uuid", "p_nickname" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_circuit_nickname"("p_group" "uuid", "p_nickname" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_circuit_nickname"("p_group" "uuid", "p_nickname" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_nicknames"("p_nickname" "text", "p_circuit_nickname" "text", "p_snake_nickname" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_nicknames"("p_nickname" "text", "p_circuit_nickname" "text", "p_snake_nickname" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_nicknames"("p_nickname" "text", "p_circuit_nickname" "text", "p_snake_nickname" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_page_style"("p_style" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_page_style"("p_style" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_page_style"("p_style" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_profile_look"("p_theme" "text", "p_palette" "jsonb", "p_flair" "text", "p_backdrop" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_profile_look"("p_theme" "text", "p_palette" "jsonb", "p_flair" "text", "p_backdrop" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_profile_look"("p_theme" "text", "p_palette" "jsonb", "p_flair" "text", "p_backdrop" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_public_page"("p_on" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_public_page"("p_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_public_page"("p_on" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_my_snake_visibility"("p_tier" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_my_snake_visibility"("p_tier" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_my_snake_visibility"("p_tier" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_person_visibility"("p_person_id" "text", "p_tier" "public"."visibility_tier") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_person_visibility"("p_person_id" "text", "p_tier" "public"."visibility_tier") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_person_visibility"("p_person_id" "text", "p_tier" "public"."visibility_tier") TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_display_name"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_display_name"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_display_name"("p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_friend_names"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_friend_names"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_friend_names"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_contact_message"("p_name" "text", "p_email" "text", "p_body" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_contact_message"("p_name" "text", "p_email" "text", "p_body" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_contact_message"("p_name" "text", "p_email" "text", "p_body" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_contact_message"("p_name" "text", "p_email" "text", "p_body" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_score"("p_name" "text", "p_score" integer, "p_game_mode" "text", "p_apples" integer, "p_time" integer, "p_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_score"("p_name" "text", "p_score" integer, "p_game_mode" "text", "p_apples" integer, "p_time" integer, "p_created_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."submit_score"("p_name" "text", "p_score" integer, "p_game_mode" "text", "p_apples" integer, "p_time" integer, "p_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_score"("p_name" "text", "p_score" integer, "p_game_mode" "text", "p_apples" integer, "p_time" integer, "p_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."uid_for_username"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."uid_for_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uid_for_username"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."uninvite_from_park_room"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."uninvite_from_park_room"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uninvite_from_park_room"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."uninvite_from_profile_room"("p_username" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."uninvite_from_profile_room"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uninvite_from_profile_room"("p_username" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_my_profile"("p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_contact_email" "text", "p_phone" "text", "p_birthday" "text", "p_address" "text", "p_venmo" "text", "p_cashapp" "text", "p_zelle" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_profile"("p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_contact_email" "text", "p_phone" "text", "p_birthday" "text", "p_address" "text", "p_venmo" "text", "p_cashapp" "text", "p_zelle" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_my_profile"("p_first_name" "text", "p_middle_name" "text", "p_last_name" "text", "p_contact_email" "text", "p_phone" "text", "p_birthday" "text", "p_address" "text", "p_venmo" "text", "p_cashapp" "text", "p_zelle" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_prices"("p_prices" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_prices"("p_prices" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_prices"("p_prices" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_ceiling"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_ceiling"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_certain_forget"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_certain_forget"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_certain_forget_on_leaving"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_certain_forget_on_leaving"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_certain_get"("p_kind" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_certain_get"("p_kind" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."visibility_certain_get"("p_kind" "text", "p_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_certain_set"("p_kind" "text", "p_id" "text", "p_usernames" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_certain_set"("p_kind" "text", "p_id" "text", "p_usernames" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."visibility_certain_set"("p_kind" "text", "p_id" "text", "p_usernames" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_circle_delete"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_circle_delete"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."visibility_circle_delete"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_circle_drop_ex_friends"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_circle_drop_ex_friends"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."visibility_circle_drop_ex_friends"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_circle_save"("p_id" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_circle_save"("p_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."visibility_circle_save"("p_id" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."visibility_circle_set_member"("p_id" "uuid", "p_username" "text", "p_in" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visibility_circle_set_member"("p_id" "uuid", "p_username" "text", "p_in" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."visibility_circle_set_member"("p_id" "uuid", "p_username" "text", "p_in" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."voice_topic_member"("p_topic" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."voice_topic_member"("p_topic" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."voice_topic_member"("p_topic" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."watchlist_stamp_adder"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."watchlist_stamp_adder"() TO "service_role";



GRANT INSERT,UPDATE ON TABLE "finance"."cost_basis_overrides" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "finance"."price_cache" TO "authenticated";



GRANT INSERT,UPDATE ON TABLE "finance"."price_history" TO "authenticated";



GRANT INSERT,UPDATE ON TABLE "finance"."symbol_designations" TO "authenticated";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "finance"."user_preferences" TO "authenticated";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."account_features" TO "authenticated";
GRANT ALL ON TABLE "public"."account_features" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."activity_reads" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."activity_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_reads" TO "service_role";



GRANT ALL ON TABLE "public"."admin_users" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_users" TO "anon";
GRANT SELECT ON TABLE "public"."admin_users" TO "authenticated";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."bug_report" TO "authenticated";
GRANT ALL ON TABLE "public"."bug_report" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_messages" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_reads" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_reads" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_room_members" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_room_members" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_room_members" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_rooms" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chat_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."chronicle_activities" TO "service_role";



GRANT ALL ON TABLE "public"."chronicle_entries" TO "service_role";



GRANT ALL ON TABLE "public"."chronicle_goals" TO "service_role";



GRANT ALL ON TABLE "public"."chronicle_notes" TO "service_role";



GRANT ALL ON TABLE "public"."chronicle_plans" TO "service_role";



GRANT ALL ON TABLE "public"."chronicle_routines" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_group_members" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_groups" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_log_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_log_comments" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_log_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_log_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."circuit_logs" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."circuit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."circuit_movies" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."circuit_movies" TO "authenticated";



GRANT ALL ON TABLE "public"."circuit_people" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."circuit_people" TO "authenticated";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_person_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_person_groups" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_ratings" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."circuit_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."circuit_watchlist" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."circuit_watchlist" TO "authenticated";



GRANT ALL ON TABLE "public"."contact_messages" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."friendships" TO "authenticated";
GRANT ALL ON TABLE "public"."friendships" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."invites" TO "authenticated";
GRANT ALL ON TABLE "public"."invites" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."leaderboard" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard" TO "service_role";



GRANT ALL ON SEQUENCE "public"."leaderboard_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."leaderboard_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."leaderboard_id_seq" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."trophies" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."trophies" TO "authenticated";
GRANT ALL ON TABLE "public"."trophies" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."leaderboard_with_trophies" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."leaderboard_with_trophies" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard_with_trophies" TO "service_role";



GRANT ALL ON TABLE "public"."lounge_message_authors" TO "service_role";



GRANT ALL ON TABLE "public"."member_library" TO "service_role";



GRANT ALL ON TABLE "public"."member_pictures" TO "service_role";



GRANT ALL ON TABLE "public"."park_maps" TO "service_role";



GRANT ALL ON TABLE "public"."park_room_invites" TO "service_role";



GRANT ALL ON TABLE "public"."park_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."picture_orphans" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."player_registry" TO "anon";
GRANT MAINTAIN ON TABLE "public"."player_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."player_registry" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."player_registry" TO "anon";
GRANT SELECT("id") ON TABLE "public"."player_registry" TO "authenticated";



GRANT SELECT("player_name") ON TABLE "public"."player_registry" TO "anon";
GRANT SELECT("player_name") ON TABLE "public"."player_registry" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."player_registry" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."player_registry" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."player_registry_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."player_registry_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."player_registry_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pool_people" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pool_people" TO "authenticated";
GRANT ALL ON TABLE "public"."pool_people" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pool_votes" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pool_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."pool_votes" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pools" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pools" TO "authenticated";
GRANT ALL ON TABLE "public"."pools" TO "service_role";



GRANT ALL ON TABLE "public"."profile_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."profile_notes" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profile_room_invites" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profile_room_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_room_invites" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profile_rooms" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profile_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."round_results" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."round_results" TO "authenticated";
GRANT ALL ON TABLE "public"."round_results" TO "service_role";



GRANT ALL ON SEQUENCE "public"."round_results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."round_results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."round_results_id_seq" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."score_history" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."score_history" TO "authenticated";
GRANT ALL ON TABLE "public"."score_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."score_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."score_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."score_history_id_seq" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."site_content" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."site_content" TO "authenticated";
GRANT ALL ON TABLE "public"."site_content" TO "service_role";



GRANT ALL ON SEQUENCE "public"."trophies_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."trophies_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."trophies_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."user_roles" TO "anon";
GRANT SELECT ON TABLE "public"."user_roles" TO "authenticated";



GRANT ALL ON TABLE "public"."visibility_certain" TO "service_role";



GRANT ALL ON TABLE "public"."visibility_circle_members" TO "service_role";



GRANT ALL ON TABLE "public"."visibility_circles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "authenticated" IN SCHEMA "finance" GRANT SELECT ON TABLES TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "finance" GRANT SELECT,INSERT,UPDATE ON TABLES TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







