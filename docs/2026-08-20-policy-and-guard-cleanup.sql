-- ============================================================================
-- ✅ APPLIED 2026-08-20. Migrations: finance_policies_one_generation_not_three,
--    admin_list_snake_handles_raises_like_the_others
--
-- Two consistency cleanups found during the security sweep and deferred at the time. Neither
-- fixed an exposure; both remove a shape that HIDES a future one.
--
-- ── 1. Three generations of RLS policy on the finance tables ──────────────
-- finance.allocations, finance.executed_trades and finance.family_accounts each carried SEVEN
-- policies expressing one rule three different ways:
--     "users manage own X"            ALL      auth.uid() = user_id
--     "Authenticated can select X"    SELECT   user_id = auth.uid()
--     "Authenticated can insert X"    INSERT   user_id = auth.uid()
--     X_select / X_insert / X_update / X_delete       auth.uid() = user_id
--
-- Permissive policies are OR'd, so the effective permission was always identical and nothing was
-- ever exposed. Removed anyway: seven policies where four will do is how a future tightening
-- gets silently undone — narrow one, and a forgotten duplicate keeps the old permission alive.
-- Same failure shape as a rule enforced in an RPC while the table hands the data out regardless.
--
-- Generation 3 kept: per-command, explicit, and with a real with_check on UPDATE (generation
-- 1's ALL policy has none of its own, merely inheriting `using`).
--
-- VERIFIED identical before and after, by simulated JWT:
--     owner            1568 trades / 14619 allocations / 33 accounts  (unchanged)
--     another member   0 / 0 / 0                                       (unchanged)
--     writes           own insert OK, another user's insert blocked
--
-- ── 2. The one admin function that returned empty instead of raising ──────
-- 19 of 20 admin_* functions raise 'admin required'. admin_list_snake_handles used the FILTER
-- form (`where public.is_admin()`), so a non-admin got zero rows rather than an error. Safe, and
-- verified as such — but the weaker pattern: an empty list is indistinguishable from "there is
-- genuinely nothing here", so a future bug that breaks the check would look like normal quiet
-- output. A raise cannot be mistaken for data.
--
-- VERIFIED: non-admin now raises 'admin required'; admin still gets 25 handles. The client
-- already tolerated this — AdminPanel does `setHandles(snakeRes.error ? [] : ...)` on purpose,
-- so one failing RPC cannot take member management down with it.
--
-- Standing audit after the batch: anon-executable outside the allowlist = none.
-- ============================================================================

drop policy if exists "users manage own allocations"          on finance.allocations;
drop policy if exists "Authenticated can insert allocations"  on finance.allocations;
drop policy if exists "Authenticated can select allocations"  on finance.allocations;

drop policy if exists "users manage own trades"                    on finance.executed_trades;
drop policy if exists "Authenticated can insert executed_trades"   on finance.executed_trades;
drop policy if exists "Authenticated can select executed_trades"   on finance.executed_trades;

drop policy if exists "users manage own family accounts"          on finance.family_accounts;
drop policy if exists "Authenticated can insert family_accounts"  on finance.family_accounts;
drop policy if exists "Authenticated can select family_accounts"  on finance.family_accounts;

-- admin_list_snake_handles: body recreated in the migration named above, swapping
-- `where public.is_admin()` for a leading `if not public.is_admin() then raise ...`.
