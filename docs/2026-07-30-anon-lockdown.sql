-- ============================================================================
-- 2026-07-30 — close the anon EXECUTE surface on RPCs never meant to be public.
--
-- In Postgres a GRANT does not imply a REVOKE: every new function gets EXECUTE
-- for PUBLIC by default, so writing `grant execute ... to authenticated` leaves
-- anon able to call it too. This is the same mistake that briefly made
-- display_name() / snake_display_name() anon-callable.
--
-- Audited with:
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
--
-- 29 functions came back. All but one already refuse anon internally
-- (`if auth.uid() is null then raise exception ...`), so most of this is
-- defence in depth — with one real exception: are_friends() is plain SQL with
-- no gate at all, so anon could ask whether any two user uuids were friends.
--
-- DELIBERATELY LEFT ANON-CALLABLE (the pre-sign-in / public surface):
--   circuit_public          public signed-out board
--   get_invite_by_token     the invite page, before an account exists
--   complete_member_signup  signup itself
--   submit_score            anonymous Snake players post scores
--   finalize_round_rpc      the Render ws-relay calls this as anon
--   is_admin                invoker; returns false for anon, gates nav only
--
-- Nothing here is dropped or altered, only re-permissioned. To reopen any of
-- them: grant execute on function <signature> to anon;
-- ============================================================================

-- The one that actually leaked.
revoke all on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- Social / directory / profile reads.
revoke all on function public.get_member_profile(text) from public, anon;
grant execute on function public.get_member_profile(text) to authenticated;

revoke all on function public.list_member_directory() from public, anon;
grant execute on function public.list_member_directory() to authenticated;

revoke all on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;

-- Social writes.
revoke all on function public.request_friend(text) from public, anon;
grant execute on function public.request_friend(text) to authenticated;

revoke all on function public.respond_friend(text, boolean) from public, anon;
grant execute on function public.respond_friend(text, boolean) to authenticated;

revoke all on function public.remove_friend(text) from public, anon;
grant execute on function public.remove_friend(text) to authenticated;

revoke all on function public.open_dm(text) from public, anon;
grant execute on function public.open_dm(text) to authenticated;

-- Chat.
revoke all on function public.send_chat_message(uuid, text) from public, anon;
grant execute on function public.send_chat_message(uuid, text) to authenticated;

revoke all on function public.chat_room_member(uuid) from public, anon;
grant execute on function public.chat_room_member(uuid) to authenticated;

-- Destructive circuit op.
revoke all on function public.delete_circuit(uuid) from public, anon;
grant execute on function public.delete_circuit(uuid) to authenticated;

-- Finance, member-facing.
revoke all on function public.get_my_portfolio() from public, anon;
grant execute on function public.get_my_portfolio() to authenticated;

revoke all on function public.get_allocations(uuid) from public, anon;
grant execute on function public.get_allocations(uuid) to authenticated;

revoke all on function public.get_executed_trades(uuid) from public, anon;
grant execute on function public.get_executed_trades(uuid) to authenticated;

revoke all on function public.insert_allocation(uuid, jsonb) from public, anon;
grant execute on function public.insert_allocation(uuid, jsonb) to authenticated;

revoke all on function public.insert_allocation(jsonb) from public, anon;
grant execute on function public.insert_allocation(jsonb) to authenticated;

-- Finance, admin-only (each already checks is_admin() internally).
revoke all on function public.admin_get_portfolios() from public, anon;
grant execute on function public.admin_get_portfolios() to authenticated;

revoke all on function public.admin_create_family_account(uuid, text, numeric, date) from public, anon;
grant execute on function public.admin_create_family_account(uuid, text, numeric, date) to authenticated;

revoke all on function public.admin_update_family_account(uuid, text, numeric, date) from public, anon;
grant execute on function public.admin_update_family_account(uuid, text, numeric, date) to authenticated;

revoke all on function public.admin_delete_family_account(uuid) from public, anon;
grant execute on function public.admin_delete_family_account(uuid) to authenticated;

-- Trigger functions: never called directly, so no role needs EXECUTE. The
-- trigger still fires — same pattern already used on circuit_default_group().
revoke all on function public.chat_room_for_new_group() from public, anon, authenticated;
revoke all on function public.enforce_best_score() from public, anon, authenticated;

-- Snake helper — only referenced by src/dev/supabaseDebug.ts (DEV-gated).
revoke all on function public.enforce_best_score(integer, text) from public, anon;
grant execute on function public.enforce_best_score(integer, text) to authenticated;


-- ============================================================================
-- VERIFY — should return zero rows.
-- ============================================================================
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
  and p.proname not in ('circuit_public', 'get_invite_by_token', 'complete_member_signup',
                        'submit_score', 'finalize_round_rpc', 'is_admin')
order by p.proname;
