-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- RUN C8 = C7 + the release plan's own check files, run at their checkpoints. RUN C7 (the release, exactly): the six drafts the release applies, in the release plan's order,
-- with NO conversion draft, on a database built from main's migrations — which production has
-- applied, every one (checked read-only on 9 Nov). Then the profile reader, step 7. Fingerprints of
-- every function the release touches are printed before and after, to compare with production's.

\echo === FINGERPRINT BEFORE — the six functions the release patches, as the migrations build them
select p.proname as fn, md5(pg_get_functiondef(p.oid)) as md5, length(pg_get_functiondef(p.oid)) as bytes,
       md5(pg_get_functiondef(p.oid)) = case p.proname
         when 'chronicle_entry_amount' then '257c45b4256bf9d278210b86704f561e'
         when 'chronicle_export'       then 'f3e16bed381e455b3905c13d9f3deeae'
         when 'chronicle_goals_mine'   then 'bff4311d27e4e8f24dbe30a2ad95c258'
         when 'chronicle_import'       then 'bc19f91904908b0831338ddbc2a7a1f8'
         when 'chronicle_tally'        then '543f0572c074f53fc320db7f40903ee4'
         when 'get_member_chronicle'   then '6f86f652a8f27991880a2ff890b5799a'
       end as same_as_production_9_nov
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and p.proname in ('chronicle_entry_amount','chronicle_export','chronicle_goals_mine',
                     'chronicle_import','chronicle_tally','get_member_chronicle')
 order by 1;

\echo === CHECK FILE A, before step 1: six rows all same=t, then 0 0 0
\ir ../../docs/2026-11-09-chronicle-release-checks/a-before-step-1.sql
\echo === 1. the sets draft (19d)
\ir ../../docs/2026-11-08-chronicle-sets.DRAFT.sql
\echo === 2. the links draft (20c, after the sets)
\ir ../../docs/2026-11-09-chronicle-sets-links.DRAFT.sql
\echo === 3. the grid draft (20c, after the links)
\ir ../../docs/2026-11-09-circuit-grid-sessions.DRAFT.sql
\echo === 4. the weekdays draft (19c)
\ir ../../docs/2026-11-08-chronicle-weekdays.DRAFT.sql
\echo === 5. the marks draft, step 1 (17d)
\ir ../../docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql
\echo === 6. the day-notes draft (18a)
\ir ../../docs/2026-11-08-chronicle-day-notes.DRAFT.sql

\echo === FINGERPRINT AFTER STEP 6 — every function the release creates or patches
select p.proname as fn, md5(pg_get_functiondef(p.oid)) as md5, length(pg_get_functiondef(p.oid)) as bytes
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and p.proname in ('chronicle_entry_amount','chronicle_export','chronicle_goals_mine','chronicle_import',
     'chronicle_tally','get_member_chronicle','chronicle_entry_edit_day','chronicle_running_fix_day',
     'chronicle_set_add','chronicle_set_change','chronicle_set_drop','chronicle_sets_between',
     'chronicle_cell_lock','chronicle_exercise_link','chronicle_link_ok','chronicle_manual_amount',
     'chronicle_my_exercises','chronicle_sets_uncount_if_unit_changed','chronicle_unit',
     'circuit_cell_set','circuit_session_sums','chronicle_goal_days_set','chronicle_goal_mark',
     'chronicle_goal_marks_for','chronicle_day_note_add','chronicle_day_notes_between')
 order by 1;

\echo === CHECK FILE C, after step 6: 26 rows all same=t
\ir ../../docs/2026-11-09-chronicle-release-checks/c-after-step-6.sql
\echo === CHECK FILE D, after step 6: no rows
\ir ../../docs/2026-11-09-chronicle-release-checks/d-nothing-open.sql
\echo === 7. the marks profile reader, step 3 of 17d (after the room is deployed)
\ir ../../docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql
\echo === FINGERPRINT AFTER STEP 7
select p.proname as fn, md5(pg_get_functiondef(p.oid)) as md5, length(pg_get_functiondef(p.oid)) as bytes
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname = 'get_member_chronicle';

\echo === CHECK FILE E, after step 7: one row same=t
\ir ../../docs/2026-11-09-chronicle-release-checks/e-after-step-7.sql
\echo === CHECK FILE D, after step 7: no rows
\ir ../../docs/2026-11-09-chronicle-release-checks/d-nothing-open.sql
\echo === the standing guards from main, against the released schema
\ir visibility-guards.orig.sql
\echo === the daily flow
\ir chronicle-daily-flow.sql
\echo === the export/import round trip
\ir chronicle-round-trip.sql
\echo === the marks
\ir chronicle-repeat-marks.sql
\echo === the day notes
\ir chronicle-day-notes.sql
\echo === the weekdays
\ir chronicle-weekdays.sql
\echo === the sets
\ir chronicle-sets.sql
\echo === the links
\ir chronicle-sets-links.sql
\echo === the grid
\ir circuit-grid-sessions.sql
\echo === (no conversion: it is not in the release, §20d)
\echo === real Supabase Auth and PostgREST — LAST, because it COMMITS two accounts to this throwaway database
create table public.api_probe(ok boolean not null, detail text not null);
\! PROBE_CONVERSION=no bash supabase/tests/api-probe.sh
select ok, detail from public.api_probe order by ok, detail;
do $$
declare n int; m int;
begin
  select count(*) filter (where not ok), count(*) filter (where ok) into n, m from public.api_probe;
  raise notice 'API PROBE: % passed, % failed', m, n;
  if n > 0 or m < 68 then
    raise exception 'CHRONICLE API PROBE FAILED -- % failed, % passed of 68', n, m;
  end if;
end $$;
select 'the release holds through Auth and PostgREST, with no conversion' as result;
