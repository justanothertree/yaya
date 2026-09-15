-- 2026-09-15 — the two new switch functions were left reachable by anon
--
-- Found by probing the live site as an anonymous visitor after
-- docs/2026-09-15-a-page-you-can-link.sql was run:
--
--   get_my_public_page()  ->  200, "false"
--
-- It should have been 401. It is harmless in effect — auth.uid() is null for a stranger, so the
-- select matches no row and it answers false about nobody — and set_my_public_page raises 'not
-- signed in' on its first line before it can touch anything. Neither leaks and neither writes.
--
-- ⚠️ BUT IT BREAKS THE STANDING RULE, and the rule is the thing doing the work.
-- docs/2026-09-04-anon-surface-trim.sql: "don't grant what cannot be used" — four functions there
-- refused anon in their own first line and were revoked anyway, precisely so that the list of
-- what anon may execute stays short enough to read and audit. A function that refuses anon but
-- is still callable by anon is an entry in that list which has to be reasoned about every time
-- somebody reviews it.
--
-- ⚠️ THE CAUSE IS THE REVOKE, AND IT IS WORTH WRITING DOWN. The new functions did:
--
--     revoke all on function ... from public;
--
-- and the house pattern, from that same file, is `from public, anon`. Revoking from PUBLIC alone
-- was assumed to be enough on the reasoning that anon inherits its rights through PUBLIC. It does
-- not here: this project's anon role holds execute directly, so a revoke aimed at PUBLIC leaves
-- it exactly where it was. The probe above is what proved it rather than argued it.
--
-- get_public_profile is NOT touched. Its anon grant is the entire point of it.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.set_my_public_page(boolean) from public, anon;
grant execute on function public.set_my_public_page(boolean) to authenticated;

revoke all on function public.get_my_public_page() from public, anon;
grant execute on function public.get_my_public_page() to authenticated;


-- ── HOW TO CHECK IT ─────────────────────────────────────────────────────────────────────────
-- Every function anon can execute, which should be a list you can read in one go:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and has_function_privilege('anon', p.oid, 'execute')
--    order by 1;
--
-- Expect only the deliberate ones: get_demo_profile, get_public_profile, circuit_public,
-- can_see, submit_score, submit_contact_message, get_invite_by_token — and nothing whose name
-- starts with set_my_ or get_my_.
--
-- And the set of pages a stranger can reach at all, which should be exactly the people who
-- asked to be reachable:
--
--   select username from public.profiles where public_page;
