-- Trim the anon-executable surface to only what anon genuinely needs. Run in the SQL editor.
--
-- ⚠️ THE PRINCIPLE: don't grant what cannot be used. Four of these functions refuse anon in
-- their own first line — `if auth.uid() is null then raise exception 'not authenticated'` — so
-- the anon grant has never done anything except make them reachable enough to appear in an
-- audit. Revoking changes no behaviour whatsoever; it removes surface.
--
-- Kept anon deliberately, because each is used by somebody who is not signed in:
--
--   submit_score            a stranger finishes a game of Snake. Bounded (max 2304, which is a
--                           full 48x48 board) and rate limited (40 per name, 200 overall, hourly).
--   submit_contact_message  a visitor uses the contact form. Validates name/email/body, caps
--                           lengths, and rate limits per sender and overall.
--   get_invite_by_token     you look at an invite before you have an account. Returns only a
--                           label and whether it is used or expired, and only to somebody who
--                           already holds the uuid token.
--   circuit_public          the public board. Filtered to `visibility = 'public'` inside the
--                           function, so what anon may call and what anon may see are the same
--                           question, answered in one place.
--
-- The pattern below is the one docs/2026-07-30-anon-lockdown.sql established: revoke from public
-- and anon, then grant back to authenticated explicitly. Revoking from `public` alone would take
-- the right away from signed-in users too, since that is where their default came from.

-- reads a viewer's own permissions; already refuses anon
revoke all on function public.get_member_trophies(text) from public, anon;
grant execute on function public.get_member_trophies(text) to authenticated;

-- finishes signup for somebody who has just authenticated; already refuses anon
revoke all on function public.complete_member_signup(uuid, text, text, text) from public, anon;
grant execute on function public.complete_member_signup(uuid, text, text, text) to authenticated;

-- writes to YOUR profile, so there is nothing for anon to write; already refuses anon.
-- ⚠️ Both overloads. The three-argument one predates the backdrop and the site no longer calls
-- it, but it is still callable, so leaving it granted would leave the hole this closes. It is
-- revoked rather than dropped: dropping is irreversible and it costs nothing to leave in place.
revoke all on function public.set_my_profile_look(text, jsonb, text) from public, anon;
grant execute on function public.set_my_profile_look(text, jsonb, text) to authenticated;

revoke all on function public.set_my_profile_look(text, jsonb, text, text) from public, anon;
grant execute on function public.set_my_profile_look(text, jsonb, text, text) to authenticated;
