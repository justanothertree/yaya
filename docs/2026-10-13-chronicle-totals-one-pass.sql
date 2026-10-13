-- ✅ APPLIED 13 Oct 2026 — migrations `chronicle_totals_one_pass` and `chronicle_spread_divides_last`
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MEASURED, NOT GUESSED
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything in chronicle had been exercised against a week of fixture data. Seeded with a year
-- of a heavy user — 2,196 sessions over 19 activities, inside begin/rollback — the picture was:
--
--   one day's entries        1.1 ms
--   chronicle_activities     2.1 ms
--   chronicle_moods, a year  5.7 ms
--   chronicle_totals, a year 180.7 ms      <—
--   chronicle_totals, a MONTH 177.9 ms     <— the tell
--
-- A month costing the same as a year says the range was never the cost. chronicle_totals called
-- the scalar chronicle_sum once per activity for the minutes, again for the amount, AND AGAIN IN
-- ITS OWN ORDER BY — roughly forty scans of the window where one would do. Looking back makes this
-- call on every horizon tab, beside chronicle_moods, which was already doing it right with a
-- single GROUP BY.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FIX: ONE SHARED PASS
-- ─────────────────────────────────────────────────────────────────────────────
-- A third copy of the overlap expression inside chronicle_totals would have been the duplication
-- CLAUDE.md warns about, three ways. So the grouped scan is lifted into chronicle_spread(from, to)
-- — one row per (activity, rating) with seconds and amount — and both readers aggregate from it.
-- One copy of the arithmetic, one scan each. chronicle_spread is granted to NOBODY, like
-- chronicle_sum beside it, which still serves chronicle_minutes and the goal tally.
--
--   chronicle_totals, a year  180.7 ms -> 2.8 ms      (65x)
--   chronicle_totals, a month 177.9 ms -> 1.6 ms
--   chronicle_moods,  a year    5.7 ms -> 2.6 ms
--   both together (what Looking back does)    5.0 ms
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ DIVIDE LAST — AND THE md5 BASELINE IS WHAT CAUGHT IT
-- ─────────────────────────────────────────────────────────────────────────────
-- The first version divided by 60 inside the grouped scan, so each group's quotient was rounded
-- to numeric's scale and the caller summed ROUNDED quotients. Against the real rows chronicle_moods
-- then returned 86.9048353499999999 where it had returned 86.9048353500000000 — 1e-16 of a minute,
-- which matters not at all on screen and entirely to the claim that the change was a no-op.
-- Summing numerics is exact and associative, so chronicle_spread returns SECONDS and each reader
-- divides once at the end. Taking the baseline before replacing a live function (CLAUDE.md §4) is
-- the only reason this was visible at all.
--
-- ⚠️ ONE DIFFERENCE REMAINS, AND IT IS TEXT RATHER THAN VALUE. The new output carries more decimal
-- places — 68.8468066833333333 where the old gave 68.84680668333333, and 0.00000000000000000000
-- where it gave 0 — because the old value passed through chronicle_sum's CASE expression, which
-- scaled it. Proven row by row against a reconstruction of the old expression: 4 of 4 exactly
-- equal, biggest difference 0. The client does Number(x) and renders whole minutes, so this is
-- invisible; it is recorded because an md5 that no longer matches should never be waved past.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ AND THE CROSS-CHECK WAS PASSING BY LUCK
-- ─────────────────────────────────────────────────────────────────────────────
-- docs/2026-10-13-chronicle-quality.sql holds a probe asserting that chronicle_moods and
-- chronicle_totals agree about a window. It compared them for EXACT equality and passed on four
-- fixture rows. At a year of real volume it failed — by 0.0000000000000001 of a minute out of
-- 143,566, six femtoseconds — because the two functions divide by 60 at different groupings and
-- summing separately-divided numerics in two groupings is not exactly equal. The probe now
-- compares to a tolerance and says why; see that file. A check that only passes on small fixtures
-- is a check that has not been run.

-- The standing checks:
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('chronicle_spread','chronicle_sum');
-- expected: both false for both functions — they are internal to the readers above

select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and has_function_privilege('anon', p.oid, 'execute');
-- expected: zero rows for anything chronicle_%
