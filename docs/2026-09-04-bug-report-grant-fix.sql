-- Lock down the bug-report rate-limit trigger. Run this in the SQL editor.
--
-- ⚠️ WHAT WAS WRONG. The migration that added bug_report revoked the table's rights from anon
-- and granted only what was needed — but said nothing about the trigger FUNCTION it created, so
-- the function kept Postgres's default of EXECUTE to public. Supabase's advisor flags it as
-- "anon can execute a SECURITY DEFINER function", and it is the only trigger function in this
-- project in that state: every other one was locked down, so this is a gap in one migration
-- rather than a pattern.
--
-- ⚠️ HOW BAD. Low, and worth being accurate about rather than alarming: the function returns
-- `trigger`, and Postgres refuses to call a trigger function directly, so PostgREST cannot
-- actually invoke it. There is no known way to reach it. This closes the grant because a
-- SECURITY DEFINER function that nothing should ever call should not be callable — not because
-- there is a live hole.
--
-- It stays SECURITY DEFINER on purpose: it counts rows in bug_report, which the person inserting
-- cannot read (reads are admin-only), so the check has to run with the owner's rights.

revoke all on function public.bug_report_rate_limit() from public, anon, authenticated;

-- the trigger itself keeps working: triggers run as the table owner and do not consult EXECUTE
-- grants, which is exactly why revoking is safe here.
