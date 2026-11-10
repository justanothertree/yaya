-- ⛔ A READ-ONLY CHECK for docs/2026-11-09-chronicle-release-plan.md. Nothing here writes. Each
-- block says when it is run and what it must return; the expected values are written into the
-- query, so a reader compares one column rather than thirty hashes.
--
-- Where the values come from: production's text was read on 9 Nov 2026 (read-only), and run C7
-- (GitHub Actions 42733400210, scratch branch chronicle/ci-probe-flow at 60bf16f0) built its database
-- from the schema baseline, a dump of production (the job never runs the migration files; corrected
-- 10 Nov), found the same six fingerprints, applied the six drafts in the plan's
-- order and printed every function's fingerprint after step 6 and after step 7.

-- ── B. AFTER EACH STEP — the text that ran is the text in the file ─────────────────────────────
-- The newest migration's statement must md5 to the body md5 the plan lists for that step. A
-- mismatch means the SQL sent was not the file, whatever else the step's checks say.
select version, name, md5(statements[1]) as body_md5
  from supabase_migrations.schema_migrations order by version desc limit 1;
