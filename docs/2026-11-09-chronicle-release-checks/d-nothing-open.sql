-- ⛔ A READ-ONLY CHECK for docs/2026-11-09-chronicle-release-plan.md. Nothing here writes. Each
-- block says when it is run and what it must return; the expected values are written into the
-- query, so a reader compares one column rather than thirty hashes.
--
-- Where the values come from: production's text was read on 9 Nov 2026 (read-only), and run C7
-- (GitHub Actions 42733400210, scratch branch chronicle/ci-probe-flow at 60bf16f0) built a database
-- from main's 82 migrations, found the same six fingerprints, applied the six drafts in the plan's
-- order and printed every function's fingerprint after step 6 and after step 7.

-- ── D. AFTER STEP 6, AND AGAIN AFTER STEP 7 — nothing is open that should not be ──────────────
-- Must return no rows: anon may execute none of the release's functions (CLAUDE.md §3 — a revoke
-- from PUBLIC does not reach anon here), and each new table is deny-all: RLS on, no policies, no
-- privilege of any kind for anon or authenticated (TRUNCATE included, which RLS never covers).
select 'anon can execute' as problem, p.proname as item
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and has_function_privilege('anon', p.oid, 'execute')
   and p.proname in (
     'chronicle_entry_edit_day','chronicle_running_fix_day','chronicle_set_add','chronicle_set_change',
     'chronicle_set_drop','chronicle_sets_between','chronicle_cell_lock','chronicle_exercise_link',
     'chronicle_link_ok','chronicle_manual_amount','chronicle_my_exercises',
     'chronicle_sets_uncount_if_unit_changed','chronicle_unit','circuit_cell_set','circuit_session_sums',
     'chronicle_goal_days_set','chronicle_goal_mark','chronicle_goal_marks_for','chronicle_day_note_add',
     'chronicle_day_notes_between','chronicle_export','chronicle_import','chronicle_tally',
     'chronicle_entry_amount','chronicle_goals_mine')
union all
select 'RLS off', c.relname from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
   and c.relname in ('chronicle_sets','chronicle_exercise_links','chronicle_goal_days','chronicle_goal_marks')
union all
select 'has a policy', pol.tablename from pg_policies pol
 where pol.schemaname = 'public'
   and pol.tablename in ('chronicle_sets','chronicle_exercise_links','chronicle_goal_days','chronicle_goal_marks')
union all
select 'granted ' || g.privilege_type || ' to ' || g.grantee, g.table_name
  from information_schema.role_table_grants g
 where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated', 'PUBLIC')
   and g.table_name in ('chronicle_sets','chronicle_exercise_links','chronicle_goal_days','chronicle_goal_marks');
