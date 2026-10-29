-- ✅ APPLIED 29 Oct 2026 as `even_split_counts_eligible`.
--
-- §4 of Yaxa's family-fund safety set, which the draft left as prose because it wanted the fix
-- written "as a full `create or replace` of the function, taken from the live definition, with a
-- test". Both are here. The body below is `pg_get_functiondef`'s text with four changes and
-- nothing else touched.
--
-- TWO BUGS IN ONE LOOP, and the second hid the first.
--
-- 1. THE DIVISOR COUNTED ACCOUNTS THAT GOT NOTHING. `v_n` was computed ONCE, before the loop, as
--    every account with `dollar_per_day > 0`. The insert then filtered
--    `v_trade.execution_time::date >= fa.start_date`. So `v_per = units / v_n` divided by more
--    accounts than it inserted rows for, and the difference was simply gone — not held back, not
--    reported, just absent from a fund that is supposed to add up.
--
-- 2. THE COUNTER REPORTED THE DIVISOR, NOT THE ROWS. `if found then v_allocs := v_allocs + v_n;`
--    adds the candidate count per trade whatever the insert actually did. That figure is DISPLAYED
--    — ImportPanel.tsx:432 renders "split N trades across M accounts (K allocations)" — so the
--    import screen would report a clean 33-way split having written fewer rows. Which is why this
--    one had to be fixed too: with it, the first bug cannot be seen from the screen at all.
--
-- MEASURED, both at once, with the draft's own test: two accounts with start dates two months
-- apart, one ordinary 10-unit buy dated between them, every real account parked at
-- `dollar_per_day = 0` so the split sees only the fixture. Against the live function:
--
--   it reported creating   2 allocations
--   rows actually written  1
--   units allocated        5 of 10      ← five units lost
--
-- ⚠️ THE TEST WAS RUN BEFORE THE FIX AND FAILED, which is the only thing that makes it a test
-- rather than a second copy of the code (CLAUDE.md §2). After: 1 row, 10 units, reported 1.
--
-- DORMANT UNTIL THE FIRST SECOND MEMBER, measured today: 33 accounts, 1 distinct start_date
-- (2025-12-10), 0 with a NULL one. It fires the first time somebody joins with a later start date
-- and an older export is re-imported.
--
-- ⚠️ AND `start_date` IS NULLABLE, WHICH IS A THIRD DOOR INTO THE SAME BUG. `>= fa.start_date` is
-- NULL for such an account, so it never receives a row while still counting toward the divisor —
-- and `count(distinct start_date)` would not have shown it, because it ignores NULLs. There are
-- none today (checked with `count(*) - count(start_date)`, not with count(distinct)), and
-- `admin_create_family_account` accepts a null `p_start_date`, so the door is open. The fix below
-- closes it for free, which is the whole reason to count with the insert's OWN predicate rather
-- than with a second one that has to be kept in agreement.
--
-- `admin_set_trade_allocation` already counts eligible accounts per trade with exactly this
-- predicate, so this makes the two siblings agree rather than inventing a rule.
--
-- NOT AFFECTED, checked rather than assumed: `admin_set_symbol_designation` also returns
-- `allocationsCreated`, but it counts the rows for its symbol before and after and reports the
-- difference — it measures where this one asserted, so its number was always honest.

create or replace function public.admin_even_split_trades(p_user_id uuid, p_only_active boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
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
$function$;
