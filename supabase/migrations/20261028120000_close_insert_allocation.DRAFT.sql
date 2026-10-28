-- ⛔ DRAFT — NOT APPLIED. Evan reviews and applies. Nothing in this file has run.
--
-- Closes `public.insert_allocation`, which any signed-in member can call today.
-- Found by Yaxa's review (Part B §0 #1). Every claim in it verified read-only before writing this:
--
--   proname            args                prosecdef  anon  authenticated  mentions is_admin
--   insert_allocation  payload jsonb       false      f     TRUE           false
--   insert_allocation  uid uuid, payload   false      f     TRUE           false
--
-- The body validates the three fields and `units_allocated > 0`, then inserts with
-- `user_id = auth.uid()`. It checks NOTHING about who owns the family account or the trade.
-- `finance.account_payload` joins allocations by `family_account_id` alone — verified: its
-- definition never mentions `al.user_id` — so units inserted this way appear in that account's
-- holdings regardless of who wrote them.
--
-- Severity today: low, and worth being accurate about rather than alarming. There is 1 account
-- owner (Evan) and 33 accounts, so there is no second member to attack or to attack from. Member
-- payloads (`get_my_portfolio`, `get_my_timeline`) never return trade ids, and uuids are not
-- guessable. It becomes real on the first handover, which is exactly when the review says to fix
-- it.
--
-- ⚠️ I HAVE NOT FOLLOWED THE REVIEW'S SUGGESTED SHAPE, AND THE REASON IS COUPLING.
--
-- Part B's SQL draft revokes EXECUTE and routes the admin UI through a new
-- `admin_assign_allocation`. That closes the hole and breaks the admin Trades ledger the moment
-- it is applied, because `src/finance/portfolio.ts:341` still calls `insert_allocation` — so the
-- migration and a client deploy would have to land together, in order, or assigning units stops
-- working with no warning. CLAUDE.md §8: a contract that must break is handled deliberately.
--
-- Putting the guard INSIDE the existing function closes the same hole with no client coupling at
-- all: the admin UI keeps calling what it already calls, and every non-admin caller starts getting
-- a refusal. If a separate `admin_assign_allocation` is wanted later for naming, it can be added
-- when there is a client change to pair it with.
--
-- It also gains two checks the original never had, both of which are the real bug underneath:
-- the trade has to be the caller's, and the allocation cannot exceed what is left of the trade.

create or replace function public.insert_allocation(payload jsonb)
returns finance.allocations
language plpgsql
security invoker
set search_path to 'public', 'finance', 'pg_temp'
as $function$
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

  /* ⚠️ THE CHECK THIS FUNCTION NEVER HAD. It is reachable from the REST API by anybody signed in,
     and it writes rows that `finance.account_payload` reads by `family_account_id` alone. Without
     this line a member could add holdings to an account that is not theirs. */
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
  if v_units_allocated is null or v_units_allocated = 0 then
    raise exception 'units_allocated must not be zero';
  end if;

  /* the account has to exist — there was no FK and no lookup, so a typo wrote an orphan row */
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
   * ⚠️ SIGN-AWARE, BECAUSE A SELL IS NEGATIVE UNITS. "Don't allocate more than the trade holds"
   * is `abs(sum) <= abs(units_acquired)` with both parts the same sign — comparing raw numbers
   * would let a sell be allocated without limit in the negative direction, which is how a family
   * ends up short a stock it has exited (see docs/…lcid… for that shape happening by hand).
   */
  if sign(v_units_allocated) <> sign(v_trade_units) then
    raise exception 'allocation runs the opposite way to the trade';
  end if;

  select coalesce(sum(al.units_allocated), 0) into v_already
    from finance.allocations al
   where al.executed_trade_id = v_executed_trade_id;

  if abs(v_already + v_units_allocated) > abs(v_trade_units) + 1e-9 then
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
$function$;

-- the (uid, payload) overload already delegates to the one above, so it inherits every check.
-- Left in place so the admin UI's current call site keeps working unchanged.

-- §3: anon never had it, and this keeps it that way. `authenticated` keeps EXECUTE because the
-- gate is now inside the function, where an admin passes and nobody else does.
revoke all on function public.insert_allocation(jsonb) from public, anon;
revoke all on function public.insert_allocation(uuid, jsonb) from public, anon;
grant execute on function public.insert_allocation(jsonb) to authenticated;
grant execute on function public.insert_allocation(uuid, jsonb) to authenticated;

-- AFTERWARDS, prove it. As a non-admin member this must raise 'admin only':
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','<a non-admin member uuid>','role','authenticated')::text, true);
--   set local role authenticated;
--   select public.insert_allocation(jsonb_build_object(
--     'family_account_id','<any account uuid>',
--     'executed_trade_id','<any trade uuid>',
--     'units_allocated',1));
--   rollback;
--
-- And as the admin, assigning units through the Trades ledger must still work — that is the
-- regression this shape exists to avoid, so check it in the browser, not only in SQL.
