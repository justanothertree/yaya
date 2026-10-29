-- ✅ APPLIED 29 Oct 2026 as `close_insert_allocation`.
--
-- Closes `public.insert_allocation`, which any signed-in member could call. From Yaxa's review
-- (Part B §0 #1). Every claim checked against the live database before writing this, not taken
-- from the draft's header:
--
--   proname            args                secdef  anon  authenticated  mentions is_admin
--   insert_allocation  payload jsonb       false   f     TRUE           false
--   insert_allocation  uid uuid, payload   false   f     TRUE           false
--
-- The old body validated three fields and `units_allocated > 0`, then inserted with
-- `user_id = auth.uid()`. It checked NOTHING about who owned the family account or the trade, and
-- `finance.account_payload` joins allocations by `family_account_id` alone — so units written this
-- way appear in that account's holdings whoever wrote them. The (uid, payload) overload delegates
-- to this one (verified: its whole body is a uid check and `return public.insert_allocation(payload)`),
-- so one guard covers both and the admin UI's call site at src/finance/portfolio.ts:341 is
-- untouched. Yaxa's own draft proposed a new `admin_assign_allocation` plus a revoke, which would
-- have broken that call site the moment it applied unless a client deploy landed in step — §8.
--
-- Severity today, stated accurately rather than alarmingly: 33 accounts, **1 owner**, so there is
-- no second member to attack or to attack from, and member payloads never return trade ids.
--
-- ⚠️ AND IT IS NOW SECURITY DEFINER, WHICH THE DRAFT DID NOT ASK FOR AND THE OTHER MIGRATION MADE
-- NECESSARY. 20261029153952_family_fund_safety.sql revokes INSERT/UPDATE/DELETE on the three
-- finance tables from `authenticated`. This function was SECURITY INVOKER, so its insert ran as
-- the caller — and the two changes applied in either order would have left the ADMIN unable to
-- hand-assign units, which is the regression this file's shape exists to avoid. Measured, both
-- halves, in rolled-back transactions:
--
--   as the admin, today                                        inserted 1 unit
--   same call with the revoke applied first   ERROR 42501 permission denied for table allocations
--                                             CONTEXT: insert_allocation(jsonb) line 28
--
-- So the write paths were enumerated rather than guessed at — ten functions write to those three
-- tables, and **nine are already SECURITY DEFINER**. `insert_allocation` was the only INVOKER, so
-- it is the only thing the revoke breaks, and DEFINER plus the gate below is what makes both
-- changes coherent: a deny-all table reached through a function that checks who is asking, which
-- is CLAUDE.md §3's house pattern.
--
--   select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public','finance') and p.prokind = 'f'
--     and pg_get_functiondef(p.oid) ~* '(insert into|update from|delete from)\s+finance\.(allocations|executed_trades|family_accounts)';
--
-- ⚠️ `units_allocated > 0` IS KEPT, DELIBERATELY, AND THE DRAFT WOULD HAVE WIDENED IT. Yaxa's
-- version relaxed the rule to "must not be zero" so a sell could be hand-assigned. Sells are real
-- here — 328 sell trades and 363 negative allocation rows — but they are all written by
-- `admin_even_split_trades` and `admin_set_trade_allocation`, never by this function, which has
-- always refused them. Letting them in is a feature decision, not part of closing a hole (§10), so
-- it is refused here with a sentence that names the function that does it.
--
-- The sign check is NOT dead code because of that, which is the part worth knowing: the TRADE can
-- be negative even when the allocation cannot. Today `insert_allocation` will happily write +5
-- units against a sell of −5, because it never looks at the trade at all.

create or replace function public.insert_allocation(payload jsonb)
returns finance.allocations
language plpgsql
security definer
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
$function$;

-- §3: anon never held this and this keeps it that way. `authenticated` keeps EXECUTE because the
-- gate is inside the function now, where an admin passes and nobody else does — and because
-- revoking it would break the admin UI, which signs in as a member like everybody else.
revoke all on function public.insert_allocation(jsonb) from public, anon;
revoke all on function public.insert_allocation(uuid, jsonb) from public, anon;
grant execute on function public.insert_allocation(jsonb) to authenticated;
grant execute on function public.insert_allocation(uuid, jsonb) to authenticated;
