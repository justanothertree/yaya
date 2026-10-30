-- ✅ APPLIED 30 Oct 2026 as `the_demo_trigger_is_not_a_public_function`.
--
-- ⚠️ CAUGHT BY ITS OWN NEW TEST, ON THE FIRST RUN, AGAINST CODE WRITTEN AN HOUR EARLIER.
-- `supabase/tests/visibility-guards.sql` ends with a check that fails if any SECURITY DEFINER
-- function outside a short allow-list is executable by `anon`. Its first run named
-- `only_the_admin_demos()` -- the trigger function added by
-- `helpers_answer_only_about_you_and_the_demo_door_closes`.
--
-- The cause is the one CLAUDE.md §3 already describes for tables, reaching functions too: the
-- schema's default ACL grants EXECUTE to PUBLIC on every new function, so a function is open
-- unless it is closed. A trigger function has no business being callable at all.
--
-- ⚠️ AND REVOKING DOES NOT DISARM THE TRIGGER. A trigger fires as part of the statement and does
-- not consult the caller's EXECUTE privilege. Checked rather than assumed, because a security fix
-- that quietly removes the protection it was guarding would be worse than the hole: after the
-- revoke, giving `is_demo` to a non-admin is still refused with "is_demo is the site owner's row
-- only", while both `anon` and `authenticated` report false for EXECUTE on the function.

revoke all on function public.only_the_admin_demos() from public, anon, authenticated;
