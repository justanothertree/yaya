-- ✅ APPLIED 29 Oct 2026 as `import_absorbs_symbol_change_rounding`.
--
-- Plan P3.1: "when an incoming zero-dollar row with negative units would leave that symbol and
-- broker below 0.0001 shares (or below zero), remove exactly the current position instead."
--
-- THE ARITHMETIC THAT CAUSES IT. Robinhood rounds a symbol change to four decimals; the buys it
-- cancels are not rounded. CCIV is the real case — 6 + 0.286364 bought, then "6.2864S" removed
-- when it became LCID — and the two do not meet. Measured by running that import against the
-- PREVIOUS definition in a rolled-back transaction:
--
--   CCIV after the symbol change   -0.000036     negative
--
-- A position very slightly negative, for ever, in a symbol that no longer exists under that name.
-- It is what lights the "oversold?" flag on the admin positions table, and it is arithmetic
-- rather than a missing trade — so the correct-position tool is the wrong instrument for it.
--
-- After, on the same input: exactly 0.000000, LCID 6.2864, and the result reports `trimmed: 1`.
--
-- ⚠️ BOUNDED, AND THE BOUNDS WERE TESTED SEPARATELY, because a clamp that fires too widely edits
-- somebody's share count without being asked. All measured in rolled-back transactions:
--
--   10 held, 0.5 removed (a real partial)        -> 9.5,  trimmed 0
--   a SELL of 4.9 against 4 held (real money)    -> -0.9, trimmed 0
--   3 removed against nothing held               -> -3,   trimmed 0
--
-- The sell is the important one: an overshoot there is a genuine data problem and must stay
-- visible. So is the third — a removal against nothing is recorded as it arrived, because
-- silently zeroing it would hide a buy that never imported.
--
-- ⚠️ AND IT IS COUNTED. `trimmed` is new in the return, because this changes a number the broker
-- sent: a reconciliation against Robinhood will differ by exactly that rounding, which is the
-- honest side of the trade against a position the fund knows is impossible. The import panel does
-- not display it yet — the figure crosses the relay on its way back and wiring it through is UI
-- work this file did not do. Named rather than left to be noticed.
--
-- ⚠️ THE PARSER DELIBERATELY DOES NOT DO THIS. It reports what the broker said;
-- `server/lib/parseTrades.test.mjs` pins that with a CCIV fixture asserting the residue is
-- -0.000036 and negative. Only the database can see the whole position, and duplicating the rule
-- in two places is how the two stop agreeing.

create or replace function public.admin_import_trades(p_user_id uuid, p_trades jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
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
$function$;
