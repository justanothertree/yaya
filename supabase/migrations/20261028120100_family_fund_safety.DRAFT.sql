-- ⛔ DRAFT — NOT APPLIED. Evan reviews and applies. Nothing in this file has run.
--
-- The rest of the "before the first family account is handed out" set, from Yaxa's review
-- (Part B §0 #2/#4, Part C "Database tightening", Part E §0). Four independent changes; they are
-- in one file because they share one trigger — the first handover — but each block stands alone
-- and can be split if Evan would rather apply them one at a time.
--
-- VERIFIED READ-ONLY BEFORE WRITING, every one:
--   family_accounts_user_fk confdeltype              = 'c'  (CASCADE)
--   foreign keys on finance.allocations              = 0    (none at all)
--   get_my_portfolio mentions is_suspended           = false
--   get_my_timeline  mentions is_suspended           = false
--   finance.family_accounts INSERT/UPDATE/DELETE policies = 3
--   finance.family_accounts grants to authenticated  = DELETE, INSERT, SELECT, UPDATE
--
-- AND WHAT BOUNDS THE URGENCY, measured: 33 accounts, 1 owner, 1 distinct start_date
-- (2025-12-10), 33 active. So today there is no second member to protect from, and the even-split
-- bug in §4 cannot fire. Both become live on the first handover.

-- ─── 1. Members cannot edit their own fund records ─────────────────────────────────────────
--
-- `family_accounts_insert/_update/_delete` all allow `auth.uid() = user_id`, and `authenticated`
-- holds arwd. Today `finance` is not exposed through PostgREST (the API answers PGRST106), which
-- is the only thing standing in the way — configuration, not a decision. With it exposed, a
-- member could set their own `dollar_per_day`, move their own `start_date` (changing their whole
-- accrual history), or delete their account. A minor could.
--
-- The admin RPCs are SECURITY DEFINER and do not need these. SELECT stays, so members keep
-- reading their own rows.
drop policy if exists family_accounts_insert on finance.family_accounts;
drop policy if exists family_accounts_update on finance.family_accounts;
drop policy if exists family_accounts_delete on finance.family_accounts;
revoke insert, update, delete on finance.family_accounts from authenticated;

drop policy if exists executed_trades_insert on finance.executed_trades;
drop policy if exists executed_trades_update on finance.executed_trades;
drop policy if exists executed_trades_delete on finance.executed_trades;
revoke insert, update, delete on finance.executed_trades from authenticated;

drop policy if exists allocations_insert on finance.allocations;
drop policy if exists allocations_update on finance.allocations;
drop policy if exists allocations_delete on finance.allocations;
revoke insert, update, delete on finance.allocations from authenticated;

-- ⚠️ `drop policy if exists` BY NAME IS A GUESS UNLESS THE NAMES ARE CHECKED. Confirm first:
--   select policyname, cmd, roles::text, qual from pg_policies
--    where schemaname='finance' and tablename in
--          ('family_accounts','executed_trades','allocations') order by tablename, cmd;
-- A name that does not match drops nothing and raises nothing, so this block can report success
-- having done half of what it says. Assert it afterwards:
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

-- ─── 2. Deleting a login must not silently take somebody's shares ─────────────────────────
--
-- `family_accounts.user_id` CASCADEs from `auth.users`, and `allocations` has no foreign key at
-- all. So Members → 🗑 Delete removes the login, the cascade removes the fund account and its
-- contributions, and the allocations are left pointing at an account id that no longer exists —
-- the person's holdings vanish from every total with nothing to say they were ever there.
-- The confirm copy says only "Delete @username permanently?".
alter table finance.allocations
  add constraint allocations_family_account_fk
  foreign key (family_account_id) references finance.family_accounts(id) on delete restrict;

alter table finance.family_accounts
  drop constraint family_accounts_user_fk,
  add constraint family_accounts_user_fk
  foreign key (user_id) references auth.users(id) on delete restrict;

-- ⚠️ `restrict` MAKES admin_delete_member FAIL rather than cascade, which is the point — but a
-- raw foreign-key violation is not a sentence anybody can act on. Pair this with a check inside
-- `admin_delete_member` that counts the accounts first and says so:
--   "This person owns N fund accounts — reassign or delete them first."
-- Without that, the admin screen will show a Postgres error string.
--
-- ⚠️ And the FK in the first statement will FAIL if any orphan allocations already exist. Check
-- before applying (measured today: 0 orphans, so it is clean):
--   select count(*) from finance.allocations al
--    where not exists (select 1 from finance.family_accounts fa where fa.id = al.family_account_id);

-- ─── 3. Suspension and the finance switch belong on the server ─────────────────────────────
--
-- `get_my_portfolio` and `get_my_timeline` check `auth.uid()` and nothing else — verified, neither
-- definition mentions `is_suspended`. The redirect is client-side in App.tsx. So a suspended
-- member, or one with finance switched off, can still read their own account through the API.
-- It is only ever their own data, which is why this is #3 and not #1 — but "Suspend" should mean
-- what the admin thinks it means.
--
-- ⚠️ WRITTEN AS A SKETCH ON PURPOSE. Both functions are long and this file must not guess at
-- their bodies: replacing a live function from a half-remembered definition is how a working
-- feature gets rewritten by accident. Take the current text first —
--   select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname in ('get_my_portfolio','get_my_timeline');
-- — then add these two guards immediately after the existing `auth.uid() is null` check:
--
--   if public.is_suspended(auth.uid()) then
--     raise exception 'account suspended';
--   end if;
--
-- For the feature switch, decide which answer is wanted and say so in the migration: an empty
-- result reads as "you have nothing", a raised exception reads as "this is not for you". The
-- review suggests returning '[]'; a one-line card in the UI (Part D §7) needs to tell those
-- apart, so an exception the client recognises is probably the better pair.
--
-- ⚠️ AND TAKE A BASELINE EITHER WAY (CLAUDE.md §4). md5 the output in a simulated session before
-- and after, so "no change for a member in good standing" is measured rather than assumed.

-- ─── 4. The even split loses units when start dates differ ─────────────────────────────────
--
-- `admin_even_split_trades` computes `v_n` ONCE, outside the loop, as every account with
-- `dollar_per_day > 0` — then inserts only where `v_trade.execution_time::date >= fa.start_date`.
-- So `v_per = units / v_n` divides by more accounts than it inserts for, and the difference is
-- simply lost. `admin_set_trade_allocation` gets this right by counting eligible accounts.
--
-- Dormant today: 1 distinct start_date, so every account is eligible for every trade. It fires
-- the first time a 34th member joins with a later start date and an older CSV is re-imported.
--
-- ⚠️ THERE IS A SECOND BUG IN THE SAME LOOP THAT THE REVIEW DID NOT NAME, and it is the one that
-- would hide the first. The counter says
--     if found then v_trades := v_trades + 1; v_allocs := v_allocs + v_n; end if;
-- so `allocationsCreated` reports `v_n` per trade whatever the start-date filter actually
-- inserted. The import screen would report a clean 33-way split while having written fewer rows.
-- Use `row_count` from the insert instead:
--     get diagnostics v_rows = row_count;
--     v_allocs := v_allocs + v_rows;
--
-- The fix for the divisor is to count per trade, with the same filter as the insert:
--
--   select count(*) into v_eligible
--     from finance.family_accounts fa
--    where fa.id = any(v_accounts)
--      and v_trade.execution_time::date >= fa.start_date;
--   if v_eligible = 0 then continue; end if;   -- nobody had started yet; not a 0-divisor
--   v_per := v_trade.units_acquired / v_eligible;
--
-- Write it as a full `create or replace` of the function, taken from the live definition, with a
-- test: two accounts, start dates a month apart, a trade dated between them. The eligible account
-- must receive the WHOLE trade, and the sum of allocations must equal `units_acquired` exactly.
-- That test fails against today's function, which is how you know it is the right test.
