-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- RUN M: the repeat-marks drafts, applied to the throwaway database for real (it is thrown away
-- after the job), then every suite that could notice them: the standing visibility guards, the
-- daily flow, the export/import round trip — and the marks test itself last.
\echo === applying step 1
\ir ../../docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql
\echo === applying step 3
\ir ../../docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql
\echo === the standing guards, against a schema with both drafts in it
\ir visibility-guards.orig.sql
\echo === the daily flow
\ir chronicle-daily-flow.sql
\echo === the export/import round trip
\ir chronicle-round-trip.sql
\echo === the marks
\ir chronicle-repeat-marks.sql
