-- ✅ APPLIED 29 Oct 2026 as `family_fund_safety`.
--
-- ⚠️ THIS FILE DIVERGES FROM THE STATEMENT RECORDED IN `schema_migrations`, ON PURPOSE AND BY
-- EXACTLY ONE GUARD. Everything here ran as written; what was added afterwards is the wrapper
-- that lets it run a SECOND time without failing, so the repository can rebuild its own schema
-- from a baseline (see docs/ci/db-guards.yml). The md5 check in supabase/migrations/README.md
-- will report this file as changed, which is the intended and documented exception rather than
-- drift -- the SQL that touches the database is identical.
--
-- Yaxa's review, Part B §0 #2 and Part C "Database tightening". Two independent changes, both
-- about the first time a fund account belongs to somebody other than Evan.
--
-- WHAT BOUNDS THE URGENCY, measured today: 33 accounts, **1 owner**, 1 distinct start_date,
-- 0 orphan allocations. So neither problem below can currently be reached by anybody. Both become
-- live on the first handover, which is when a migration is the last thing you want to be writing.
--
-- ⚠️ §3 AND §4 OF THE DRAFT ARE NOT HERE, and that is deliberate rather than an omission. They
-- were written as prose sketches — "take the current text first, then add these two guards" — and
-- they replace two long live functions. They are in their own files, built from the live
-- definitions with a baseline either side: 20261029154440 (suspension) and 20261029154808 (the
-- even split). A sketch applied as SQL is a no-op that reports success.

-- ─── 1. Members cannot edit their own fund records ─────────────────────────────────────────────
--
-- `family_accounts_insert/_update/_delete` all allowed `auth.uid() = user_id`, and `authenticated`
-- held DELETE, INSERT, SELECT, UPDATE on all three tables — verified, not assumed. Today
-- `finance` is not reachable through PostgREST, which is configuration rather than a decision; the
-- client never touches these tables either way (checked: no `.schema(` call anywhere in src, and
-- every finance read goes through an RPC). With the schema exposed, a member could set their own
-- `dollar_per_day`, move their own `start_date` and rewrite their whole accrual history, or delete
-- their account. A minor could.
--
-- SELECT stays, so members keep reading their own rows.
--
-- ⚠️ `drop policy if exists` BY NAME IS A GUESS UNLESS THE NAMES ARE CHECKED — a name that does
-- not match drops nothing and raises nothing, so this block could report success having done half
-- of what it says. Checked against pg_policies first; all nine exist with these exact names, all
-- on role `{public}`, and the assertion at the end of the block is what makes it true by
-- construction rather than by my having looked.
--
-- ⚠️ AND THE REVOKE NAMES `anon` EXPLICITLY. It holds nothing on these tables today, but
-- `revoke … from public` would not cover it if it did — in this project `anon` holds privileges
-- directly, which is how it kept EXECUTE on thirteen things for a month (§3).
drop policy if exists family_accounts_insert on finance.family_accounts;
drop policy if exists family_accounts_update on finance.family_accounts;
drop policy if exists family_accounts_delete on finance.family_accounts;
revoke insert, update, delete on finance.family_accounts from authenticated, anon;

drop policy if exists executed_trades_insert on finance.executed_trades;
drop policy if exists executed_trades_update on finance.executed_trades;
drop policy if exists executed_trades_delete on finance.executed_trades;
revoke insert, update, delete on finance.executed_trades from authenticated, anon;

drop policy if exists allocations_insert on finance.allocations;
drop policy if exists allocations_update on finance.allocations;
drop policy if exists allocations_delete on finance.allocations;
revoke insert, update, delete on finance.allocations from authenticated, anon;

do $$
declare v int;
begin
  select count(*) into v from pg_policies
   where schemaname = 'finance'
     and tablename in ('family_accounts','executed_trades','allocations')
     and cmd in ('INSERT','UPDATE','DELETE');
  if v > 0 then
    raise exception '% member write policies still on the finance tables — check the names', v;
  end if;
end $$;

-- ⚠️ THE ONE THING THIS BREAKS WAS FIXED FIRST, IN ITS OWN MIGRATION. Ten functions write to
-- these three tables and nine were already SECURITY DEFINER, so they are unaffected.
-- `insert_allocation` was the only SECURITY INVOKER one — its insert ran as the caller, so this
-- revoke took the ADMIN's ability to hand-assign units down with the member's. Measured in a
-- rolled-back transaction before any of this was applied:
--
--   as the admin, with the revoke applied first
--   ERROR 42501 permission denied for table allocations
--   CONTEXT: insert_allocation(jsonb) line 28
--
-- 20261029153649_close_insert_allocation.sql makes it SECURITY DEFINER with an `is_admin()` gate,
-- and must be applied BEFORE this file. Re-checked after: the admin's hand-assign still inserts.

-- ─── 2. Deleting a login must not silently take somebody's shares ─────────────────────────────
--
-- `family_accounts.user_id` was ON DELETE CASCADE (confdeltype 'c', verified) and
-- `finance.allocations` has NO foreign keys at all — not one, on either column. So Members →
-- 🗑 Delete removed the login, the cascade removed the fund account and its contributions, and the
-- allocations were left pointing at an account id that no longer existed: the person's holdings
-- vanish from every total with nothing left to say they were ever there. The confirm copy says
-- only "Delete @username permanently?".
--
-- ⚠️ THE FIRST STATEMENT WOULD FAIL IF ANY ORPHAN ALREADY EXISTED. Checked immediately before
-- applying — 0 of 14,223 allocations point at a missing account:
--   select count(*) from finance.allocations al
--    where not exists (select 1 from finance.family_accounts fa where fa.id = al.family_account_id);
-- ⚠️ GUARDED AFTER THE FACT so the file can be replayed over a schema baseline; see the note at
-- the top of this header. Postgres has no `add constraint if not exists`, so this is the same
-- do-block shape `feed_waits_for_an_adult` already uses for `profiles_age_band_check`. The
-- statement inside is byte for byte what was applied.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'allocations_family_account_fk') then
    alter table finance.allocations
      add constraint allocations_family_account_fk
      foreign key (family_account_id) references finance.family_accounts(id) on delete restrict;
  end if;
end $$;

alter table finance.family_accounts
  drop constraint family_accounts_user_fk,
  add constraint family_accounts_user_fk
  foreign key (user_id) references auth.users(id) on delete restrict;

-- ⚠️ `restrict` MAKES THE DELETE FAIL RATHER THAN CASCADE, WHICH IS THE POINT — AND A RAW FOREIGN
-- KEY VIOLATION IS NOT A SENTENCE ANYBODY CAN ACT ON. Without the block below, the admin screen
-- would show `update or delete on table "users" violates foreign key constraint
-- "family_accounts_user_fk" on table "family_accounts"` where it used to show nothing at all, and
-- the person reading it has no idea that the fix is to reassign an account.
--
-- `admin_reassign_family_account(p_account, p_new_owner)` and `admin_delete_family_account(p_account)`
-- both already exist, so the sentence can name what to do. Taken from the live definition rather
-- than rewritten: everything else here is byte for byte what was there.
--
-- `admin_delete_family_account` deletes allocations before the account (checked), so the new
-- RESTRICT on allocations does not break it.
create or replace function public.admin_delete_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare v_accounts int;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_user_id = auth.uid() then raise exception 'you cannot delete your own account'; end if;
  if exists(select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'cannot delete an admin account';
  end if;

  /* ⚠️ COUNTED AND NAMED, BEFORE ANYTHING IS DELETED. The FK would refuse this anyway now, which
     is the safety; this is so the refusal says what to do about it. `finance` is qualified because
     this function's search_path does not include it. */
  select count(*) into v_accounts from finance.family_accounts fa where fa.user_id = p_user_id;
  if v_accounts > 0 then
    raise exception
      'that person owns % fund account(s) — reassign or delete them first, or their holdings go with the login',
      v_accounts;
  end if;

  delete from public.invites where used_by = p_user_id; -- clears the NO ACTION FK
  delete from public.user_roles where user_id = p_user_id; -- no FK / cascade
  delete from auth.users where id = p_user_id; -- cascades profiles + account_features + auth internals
end;
$function$;

-- ⚠️ "1 fund account(s)" BELOW IS WRONG AND IS LEFT HERE ON PURPOSE. It is what this migration
-- actually ran; 20261029154129_admin_delete_member_counts_accounts.sql fixes the wording two
-- minutes later. Writing the correction into this file instead is what produced the drift Evan
-- caught — seven files against eight applied versions, and a file whose contents no longer matched
-- the migration of its own name. Replaying both in order lands on the right text anyway.
--
-- A comment INSIDE a function body is part of the stored definition, so it has to match too:
-- `pg_get_functiondef` returns it, and a file that differs there reproduces a different function.
-- Everything from `create or replace` down is byte for byte what was applied.

-- ⚠️ ONE ORPHAN PATH IS LEFT OPEN ON PURPOSE, NAMED RATHER THAN CLOSED (§10).
-- `allocations.executed_trade_id` still has no foreign key, so deleting a trade would orphan its
-- allocations the same way. Nothing deletes trades today — checked across every function in
-- `public` and `finance`, and only `allocations` is ever deleted from — so there is no path to the
-- bug and adding the constraint would be scope this file did not ask for. Worth doing if a
-- "remove an imported trade" control is ever added, which is exactly when it would bite.
