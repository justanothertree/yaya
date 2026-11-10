-- ⛔ A READ-ONLY CHECK for docs/2026-11-09-chronicle-release-plan.md. Nothing here writes. Each
-- block says when it is run and what it must return; the expected values are written into the
-- query, so a reader compares one column rather than thirty hashes.
--
-- Where the values come from: production's text was read on 9 Nov 2026 (read-only), and run C7
-- (GitHub Actions 42733400210, scratch branch chronicle/ci-probe-flow at 60bf16f0) built a database
-- from main's 82 migrations, found the same six fingerprints, applied the six drafts in the plan's
-- order and printed every function's fingerprint after step 6 and after step 7.

-- ── C. AFTER STEP 6 — every function the release creates or patches, as C7 left it ─────────────
-- Must return 26 rows, every `same` true. get_member_chronicle is still its old self here.
with want(fn, md5) as (values
  ('chronicle_cell_lock',                    '429fefb8972ee17b2c85e6798c6e8a38'),
  ('chronicle_day_note_add',                 'f4c9397712bcd4478c07492f59496c40'),
  ('chronicle_day_notes_between',            'ecd3337c12871efa25625d3be426fbe0'),
  ('chronicle_entry_amount',                 '417d779dd1f47ecb979103dc99e464b8'),
  ('chronicle_entry_edit_day',               'd508a49c9f53021ff92cdeae769ed0ff'),
  ('chronicle_exercise_link',                '23c78d7efc41cd6f4a4b5eec3233beed'),
  ('chronicle_export',                       '9bb2b52fbccc5879ead3e617f101f627'),
  ('chronicle_goal_days_set',                '9164870d9aac4dbbe26baa03eb85aab6'),
  ('chronicle_goal_mark',                    '746fd6d8229c5a2f4fe254067d0c21e9'),
  ('chronicle_goal_marks_for',               '053d98a5dc3b881fccdf2c3a727ed337'),
  ('chronicle_goals_mine',                   'b3f40aa5f541fede5e4df896e31de93c'),
  ('chronicle_import',                       'e8b9c4d5cf0c62f9a45a3a584f2de66a'),
  ('chronicle_link_ok',                      'fa9797c19430290b14cefaa864659343'),
  ('chronicle_manual_amount',                '74ed882d616c58924dcdb5638b93f58f'),
  ('chronicle_my_exercises',                 'a5c10e77a93f8d3bc2c3acd29b71f294'),
  ('chronicle_running_fix_day',              'f0f4f5fcdd16d2179c9a9b36b511074a'),
  ('chronicle_set_add',                      '827483f855f2634df3a60d53fc9a5d58'),
  ('chronicle_set_change',                   'ee75568ddace16f39547a4d64c3ab2b4'),
  ('chronicle_set_drop',                     '8de7bcc6353133ae034701005a88e9e8'),
  ('chronicle_sets_between',                 '9322952ba8fc8895c239be5215a213e2'),
  ('chronicle_sets_uncount_if_unit_changed', 'd4d7cd4d6f0d7fbe14597ce60626b02e'),
  ('chronicle_tally',                        'aaa13a2eb614d0eec0ece6aa7c770a8a'),
  ('chronicle_unit',                         'cc7f53c48a8f1a9b27170a445a9a07a9'),
  ('circuit_cell_set',                       'e2eba58fb63b85a450eb01bd3dd9f3c9'),
  ('circuit_session_sums',                   '6c7c5faa978bb66d68418d0d6080d8df'),
  ('get_member_chronicle',                   '6f86f652a8f27991880a2ff890b5799a'))
select w.fn, count(p.oid) as defs,
       coalesce(bool_and(md5(pg_get_functiondef(p.oid)) = w.md5), false) as same
  from want w
  left join pg_proc p on p.proname = w.fn and p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
 group by w.fn order by w.fn;
