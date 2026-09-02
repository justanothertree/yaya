-- 2026-09-02 — Reading all 141 security advisories, and what is actually worth doing.
--
-- Run after the site_content migration. Everything here is OPTIONAL hardening: nothing below
-- fixes a live hole, and that conclusion is the point of the file — the advisor list is long
-- enough that it is worth writing down which entries were checked and dismissed, so the next
-- sweep does not re-litigate them.
--
--
-- WHAT CAME BACK
--
--   120  WARN  authenticated_security_definer_function_executable
--    12  INFO  rls_enabled_no_policy
--     7  WARN  anon_security_definer_function_executable
--     1  WARN  extension_in_public
--     1  WARN  auth_leaked_password_protection
--
--
-- 1. THE 120. This is the architecture, not a finding. Every table is closed and every write goes
--    through a SECURITY DEFINER rpc that checks auth.uid() itself. "A signed-in user can call the
--    functions" is a description of the design. Dismissed.
--
-- 2. THE 12 "RLS enabled, no policy". Already audited on 2026-08-19: RLS on with no policy is
--    deny-all, so those tables are closed, not open. Unchanged. Dismissed.
--
-- 3. THE 7 ANON-CALLABLE ONES. Six are deliberately public and have to be:
--       circuit_public()            the signed-out Circuit demo
--       get_invite_by_token()       an invite link is opened before you have an account
--       complete_member_signup()    likewise — the token is the secret
--       submit_contact_message()    the public contact form
--       submit_score()              the public Snake leaderboard
--       get_member_trophies()       trophies on a profile
--    The seventh, set_my_profile_look, is a WRITER, so it was read in full: its first statement
--    is `if v_me is null then raise exception 'not authenticated'`. An anonymous call dies on
--    line one. The advisory flags that a function is EXECUTABLE, which is not the same as
--    exploitable. Dismissed — but see step B, which found something else while looking.
--
-- 4. extension_in_public — pg_net. Worth a proper look rather than a shrug, because pg_net is an
--    HTTP client living inside the database: if a browser could reach it, the site would have a
--    server-side request forgery hole pointed at its own infrastructure. Both `anon` and
--    `authenticated` do hold EXECUTE on net.http_get / http_post / http_delete.
--
--    They cannot reach it. Measured, not assumed: POSTing to /rest/v1/rpc/http_post as anon
--    returns PGRST202 "Searched for the function public.http_post" — PostgREST resolves rpc names
--    in the exposed schema only, and pg_net's functions live in `net`, which is not exposed. A
--    known-good function called the same way behaves identically, so this is schema resolution
--    and not a hidden spec.
--
--    So: not a live hole, and step A is defence in depth. It costs nothing and closes the
--    question permanently, rather than leaving it resting on a PostgREST config setting that
--    nobody would think to re-check after changing.
--
-- 5. auth_leaked_password_protection — a dashboard toggle, not SQL. See the note at the bottom.

begin;

-- ── A. pg_net, out of reach of the browser roles ────────────────────────────
-- Nothing in this project calls pg_net. If something ever needs it, it should be a SECURITY
-- DEFINER function in `public` that calls it — which keeps the URL out of the caller's hands.
revoke execute on all functions in schema net from anon, authenticated;
revoke usage on schema net from anon, authenticated;

-- ── B. the superseded set_my_profile_look ───────────────────────────────────
-- Found while reading advisory 3. There are TWO overloads: the current four-argument version, and
-- an older three-argument one from before backdrops existed. The client always sends all four, so
-- PostgREST resolves unambiguously and nothing is broken today — but the old one is a second
-- SECURITY DEFINER function on the public surface that no caller wants, and if anything ever did
-- send three arguments it would silently take the version that cannot save a backdrop.
drop function if exists public.set_my_profile_look(text, jsonb, text);

commit;

-- ── C. not SQL: turn on leaked-password protection ──────────────────────────
-- Dashboard → Authentication → Policies → "Leaked password protection". It checks new passwords
-- against HaveIBeenPwned's corpus of breached credentials. It is free, it is one switch, and the
-- attack it stops — someone reusing a password that is already in a public dump — is the single
-- most likely way an account on a small site is actually taken.
--
-- ── afterwards, to confirm ──────────────────────────────────────────────────
-- select has_function_privilege('anon', p.oid, 'execute') as anon_can
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'net' and p.proname = 'http_post';        -- expect false
-- select count(*) from pg_proc where proname = 'set_my_profile_look';   -- expect 1
