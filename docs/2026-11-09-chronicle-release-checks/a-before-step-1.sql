-- ⛔ A READ-ONLY CHECK for docs/2026-11-09-chronicle-release-plan.md. Nothing here writes. Each
-- block says when it is run and what it must return; the expected values are written into the
-- query, so a reader compares one column rather than thirty hashes.
--
-- Where the values come from: production's text was read on 9 Nov 2026 (read-only), and run C7
-- (GitHub Actions 42733400210, scratch branch chronicle/ci-probe-flow at 60bf16f0) built its database
-- from the schema baseline, a dump of production (the job never runs the migration files; corrected
-- 10 Nov), found the same six fingerprints, applied the six drafts in the plan's
-- order and printed every function's fingerprint after step 6 and after step 7.

-- ── A. BEFORE STEP 1 — production is still exactly what the drafts were tested against ──────────
-- Must return 6 rows, every `same` true. One false means production moved since 9 Nov: stop.
with want(fn, md5) as (values
  ('chronicle_entry_amount', '257c45b4256bf9d278210b86704f561e'),
  ('chronicle_export',       'f3e16bed381e455b3905c13d9f3deeae'),
  ('chronicle_goals_mine',   'bff4311d27e4e8f24dbe30a2ad95c258'),
  ('chronicle_import',       'bc19f91904908b0831338ddbc2a7a1f8'),
  ('chronicle_tally',        '543f0572c074f53fc320db7f40903ee4'),
  ('get_member_chronicle',   '6f86f652a8f27991880a2ff890b5799a'))
select w.fn, count(p.oid) as defs,
       coalesce(bool_and(md5(pg_get_functiondef(p.oid)) = w.md5), false) as same
  from want w
  left join pg_proc p on p.proname = w.fn and p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
 group by w.fn order by w.fn;

-- And nothing the release creates exists yet. Must return one row: 0 functions, 0 tables, 0 columns.
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
     'chronicle_entry_edit_day','chronicle_running_fix_day','chronicle_set_add','chronicle_set_change',
     'chronicle_set_drop','chronicle_sets_between','chronicle_cell_lock','chronicle_exercise_link',
     'chronicle_link_ok','chronicle_manual_amount','chronicle_my_exercises',
     'chronicle_sets_uncount_if_unit_changed','chronicle_unit','circuit_cell_set','circuit_session_sums',
     'chronicle_goal_days_set','chronicle_goal_mark','chronicle_goal_marks_for','chronicle_day_note_add',
     'chronicle_day_notes_between')) as functions,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in (
     'chronicle_sets','chronicle_exercise_links','chronicle_goal_days','chronicle_goal_marks')) as tables,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'chronicle_notes' and column_name = 'on_day') as columns;
