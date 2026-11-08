-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- RUN D: print the live text of the functions the repeat-marks draft has to patch, as the
-- throwaway database has them after every migration, so the draft's anchors come from the real
-- thing rather than from reading migration files in order.
\pset format unaligned
\pset tuples_only on
select '=== ' || p.oid::regprocedure::text || E'\n' || pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('chronicle_export', 'chronicle_import', 'get_member_chronicle',
                    'chronicle_goals_mine', 'chronicle_goal_progress', 'chronicle_goal_drop')
order by p.proname;
select '=== writers of chronicle_goals: ' || string_agg(p.proname, ', ' order by p.proname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.chronicle_goals\M';
