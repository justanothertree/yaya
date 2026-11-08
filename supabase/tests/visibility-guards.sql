-- ⛔ SCRATCH BRANCH chronicle/ci-probe-flow ONLY — never to be merged.
-- The db guards job runs exactly this file; on this branch it runs the Chronicle flow test
-- instead, so that test can execute once in CI's throwaway database before it is proposed.
\ir chronicle-daily-flow.sql
