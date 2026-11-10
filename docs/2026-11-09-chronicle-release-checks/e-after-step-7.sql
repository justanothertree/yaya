-- ⛔ A READ-ONLY CHECK for docs/2026-11-09-chronicle-release-plan.md. Nothing here writes. Each
-- block says when it is run and what it must return; the expected values are written into the
-- query, so a reader compares one column rather than thirty hashes.
--
-- Where the values come from: production's text was read on 9 Nov 2026 (read-only), and run C7
-- (GitHub Actions 42733400210, scratch branch chronicle/ci-probe-flow at 60bf16f0) built its database
-- from the schema baseline, a dump of production (the job never runs the migration files; corrected
-- 10 Nov), found the same six fingerprints, applied the six drafts in the plan's
-- order and printed every function's fingerprint after step 6 and after step 7.

-- ── E. AFTER STEP 7 — the profile reader, as C7 left it ─────────────────────────────────────────
-- Must return one row, `same` true.
select md5(pg_get_functiondef(p.oid)) = '9f34dcc9bd275a75f3fb57ef3f1336ac' as same
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname = 'get_member_chronicle';
