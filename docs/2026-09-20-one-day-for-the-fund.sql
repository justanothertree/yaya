-- ✅ APPLIED as migrations `fund_counts_days_on_the_family_calendar` and
-- `tax_view_counts_days_on_the_family_calendar`, 20 Sept 2026.
--
-- THE BUG
-- ────────
-- "A dollar a day" was counted in UTC, on both sides. The database's TimeZone is UTC, so
-- `current_date` rolls over at 8pm Eastern — and from then until midnight the fund believed
-- tomorrow had already happened. Measured at 21:39 Eastern on Sunday 20 September:
--
--     current_date                        2026-09-21   ← a day nobody had lived through
--     (now() at time zone 'America/New_York')::date    2026-09-20
--     promised, 33 accounts, UTC          $9,405.00
--     promised, 33 accounts, family day   $9,372.00    ← $33 of promise that had not accrued
--
-- The same day leaked out in four more places a reader could see: the chart's last bucket and
-- the caption under it ("prices through Mon, Sep 21" on Sunday night), the Tax view's 'asOf',
-- its "days since the last buy" and "days until this goes long-term" counters, and the date
-- input for logging a contribution, which would have accepted tomorrow all evening.
--
-- WHY IT WAS UTC, AND WHY LOCAL IS NOT THE FIX
-- ─────────────────────────────────────────────
-- The note on daysOnPlan records what happened the last time the two halves disagreed: the
-- summary card counted LOCAL days and the chart counted UTC ones, and with 33 accounts that is
-- $33 between two figures on the same screen with nothing to explain the gap. The answer then
-- was "UTC on both sides, because the server counts in UTC too". That was right about the
-- constraint and wrong about the value: it made the two sides agree with each other and
-- disagree with the family.
--
-- Making the client local again would put that split straight back. Using each VIEWER's local
-- day would be worse still — the fund is one family's, and Mom's "promised to date" has to read
-- the same number whether Mom is at home or Ava is looking at it from another country. Two
-- people seeing different figures for the same account on the same afternoon is not an
-- improvement on being a few hours out.
--
-- So: ONE named zone, on both sides.
--
--     finance.fund_today()            -> (now() at time zone 'America/New_York')::date
--     src/finance/fundDay.ts          -> fundToday(), the same date via Intl 'en-CA'
--
-- These two have to move together. Changing the zone is changing what a day means for the
-- promise, so it is a constant with a comment rather than a setting.
--
-- THE HALF THAT IS IN THE CLIENT
-- ───────────────────────────────
-- daysOnPlan took an INSTANT and answered a question about DAYS, which is what let a timezone
-- reach a place it had no business being: buildDailySeries was handing it a chart bucket's
-- millisecond timestamp, and a bucket already IS a date. Split in two, so the mistake has
-- nowhere left to live:
--
--     daysBetween(startDate, dayISO)  pure date arithmetic, consults no clock at all
--     daysOnPlan(startDate, atMs)     daysBetween(startDate, fundToday(atMs))
--
-- Only fundToday knows about a zone, and it is asked exactly once per question.
--
-- WHAT WAS REWRITTEN, AND HOW
-- ────────────────────────────
-- public.my_fund_status          promised: current_date -> finance.fund_today()
-- public.admin_fund_status       the same, or the admin total and the member cards disagree
-- public.admin_add_contribution  the "not in the future" guard, against the same day
-- public.admin_tax_status        6 occurrences
-- finance.holding_periods        1 occurrence (the long-term cutoff)
--
-- ⚠️ THE LAST TWO WERE REWRITTEN BY SUBSTITUTION RATHER THAN BY HAND. They are ~11KB of tax
-- arithmetic between them, and retyping either one to change a date source is how an error
-- gets into a wash-sale window. The migration reads pg_get_functiondef, replaces the
-- identifier and executes the result, so the body that went back in is provably the body that
-- came out with one name changed. Checked beforehand that all seven occurrences were live
-- expressions rather than text inside comments or strings.
--
-- BASELINES, per CLAUDE.md §4
-- ────────────────────────────
--   md5(pg_get_functiondef) before:
--     finance.holding_periods         227060d194dbb8ebb8917ecb2de850db
--     public.admin_add_contribution   e558d0e195dbbf404dd7e5c1ab770035
--     public.admin_fund_status        8690c234b1199064d17bad730331ba3f
--     public.admin_tax_status         579216b089a044955f0187a3ef83973b
--     public.my_fund_status           d92d2e35dace1382429cfa4ed7ffe444
--
--   AFTER, as a real member / a real admin inside begin/rollback, while UTC was already the 21st:
--     my_fund_status, first account (start 2025-12-10)  promised 284.00
--       — 284 days from 10 Dec 2025 to 20 Sep 2026, counted by hand off a calendar rather than
--         from the same sum. UTC would have said 285.
--     admin_fund_status promised    9372.00   (was 9405.00)
--     admin_tax_status  asOf        2026-09-20 (was 2026-09-21)
--     no row was read or written by any of it.
--
--   finance.fund_today() is revoked from public, anon AND authenticated — the definer
--   functions reach it, nothing else does. Confirmed by a direct call as authenticated
--   failing with "permission denied for function fund_today".

-- ── STANDING CHECKS ────────────────────────────────────────────────────────────────────────

-- 1. No second definition of "today" has crept back into the fund. EXPECT: zero rows.
select n.nspname || '.' || p.proname as fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'finance')
   and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M'
   and pg_get_functiondef(p.oid) !~* 'fund_today\(\), not current_date'   -- the one comment
   and (p.proname like '%fund%' or p.proname like '%tax%' or p.proname like '%holding%'
        or p.proname like '%contribution%');

-- 2. The clock helper stays out of reach. EXPECT: anon and authenticated both false.
select has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'finance' and p.proname = 'fund_today';

-- 3. And what the difference currently is, which is zero for most of the day and one day's
--    worth of promise all evening.
select current_date as utc_today,
       (now() at time zone 'America/New_York')::date as fund_today,
       (select coalesce(round(sum(dollar_per_day *
          ((now() at time zone 'America/New_York')::date - current_date)), 2), 0)
          from finance.family_accounts) as promise_difference;
