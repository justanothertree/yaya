-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- RUN W2 (perturbed): the profile reads "current" as "began within a day" — E2 must fail and E must not.
-- after the job), then every suite that could notice them: the standing visibility guards, the
-- daily flow, the export/import round trip — and the marks test itself last.
\echo === applying step 1
\ir ../../docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql
\echo === applying step 3
\ir ../../docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql
\echo === applying the day-notes draft (AFTER marks)
\ir ../../docs/2026-11-08-chronicle-day-notes.DRAFT.sql
\echo === the standing guards, against a schema with both drafts in it
\ir visibility-guards.orig.sql
\echo === the daily flow
\ir chronicle-daily-flow.sql
\echo === the export/import round trip
\ir chronicle-round-trip.sql
\echo === the marks
\ir chronicle-repeat-marks.sql
\echo === the day notes
\ir chronicle-day-notes.sql
\echo === real Supabase Auth and PostgREST — LAST, because it COMMITS two accounts to this throwaway database
create table public.api_probe(ok boolean not null, detail text not null);
\! bash supabase/tests/api-probe.sh
select ok, detail from public.api_probe order by ok, detail;
do $$
declare n int; m int;
begin
  select count(*) filter (where not ok), count(*) filter (where ok) into n, m from public.api_probe;
  if n > 0 or m < 32 then
    raise exception 'CHRONICLE API PROBE FAILED -- % failed, % passed of 32', n, m;
  end if;
end $$;
select 'the daily flow and the marks hold through Auth and PostgREST' as result;
