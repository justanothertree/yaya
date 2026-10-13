-- ✅ APPLIED as migration `chronicle_tally_span_bound`, 13 Oct 2026
--
-- chronicle_tally: one pass per GOAL instead of one per WINDOW.
--
-- WHAT WAS WRONG
-- --------------
-- Nothing, in the answer. This is cost. The batch exists because a streak asks the same goal about
-- thirty-one separate days (goal.ts, STREAK_BACK), so a few repeating goals make ~190 windows in
-- one call. The previous shape joined chronicle_entries to every one of those windows, and the only
-- lower bound it carried was the window's own
--
--     coalesce(e.ended_at, clock_timestamp()) > a.f
--
-- which no index can serve, because the value being compared is computed. The practical effect is
-- that each of the ~190 windows considered EVERY entry the person had ever made. The cost is the
-- product of two things that both only grow: how long somebody has used the site, and how far back
-- a streak looks.
--
-- Today that is invisible — there are 5 entries in the table. Synthesised at three years of three
-- sittings a day (3,293 entries, 192 windows, 6 goals) it was 656ms, measured against the new shape
-- at 14.8ms in the same transaction on the same rows. 44x, and the gap widens every year.
--
-- WHAT CHANGED
-- ------------
-- Every window a goal is asked about lies inside [min(from), max(to)) taken across that goal's own
-- asks. So the candidate entries can be gathered ONCE per goal against that span, and the per-window
-- arithmetic then runs over that small set. The span bound is lossless by construction, and
-- `started_at < t1` can finally use chronicle_entries_owner_started.
--
-- MATERIALIZED is load-bearing. Inlined, the planner is free to push the per-window join back down
-- and re-derive the candidate set for each one, which is precisely the cost being removed.
--
-- The client needs no change, and the ask list is identical. A goal whose asks are all one day wide
-- gets a span of about a month; a life-scope goal gets its own wide span and loses nothing, because
-- it is not a repeating goal and so is never asked for thirty-one days as well.
--
-- HOW IT WAS CHECKED
-- ------------------
--  · A differential sweep, eight rounds of random entries and random windows, with the live function
--    as the oracle: 40 random sittings over 60 days, plus a sitting that began 400 days before any
--    window and ended inside one, plus one exactly a whole day on both boundaries, plus one half an
--    hour wholly inside a day, plus (every fourth round) the one open entry the table allows. Goals
--    covering all four source shapes — activity, category, counts='amount', and one with no source
--    at all — plus an id that is not a goal. Result: 0.0000 minutes apart on every round, no key in
--    one answer and not the other, and the no-source goal and the ghost id absent from both.
--  · THE FIRST VERSION OF THAT SWEEP WAS BLIND, and this is the part worth remembering. Perturbed
--    with the lower bound asking `e.started_at >= s.f0` — where the entry STARTED rather than
--    whether it had ENDED, which drops the long sitting that began before the span — it reported
--    agreement on all eight rounds. The reason was in the fixture, not the code: it hung a
--    life-scope window on EVERY goal, which drags min(from) back to 1970 and makes any lower bound
--    a no-op. A fixture can neutralise the very thing under test and still look thorough. With the
--    life window given a goal of its own, the same perturbation is 3,068-4,106 minutes wrong across
--    21-23 keys, every round.
--  · Behavioural baseline on the live rows before and after: md5 99914b932bd37a50b983c5e7c90ae93b
--    both times (the one real goal is hand-moved, so the honest answer is {} and must stay {}).
--  · After replacing: one function, one signature (no overload), SECURITY DEFINER, STABLE,
--    search_path pinned; anon false, authenticated true, nothing granted to PUBLIC; an
--    unauthenticated call still raises `not authenticated`; 1,201 windows still raises
--    `too many at once`; and three years of entries over 124 windows answers in 9.0-9.5ms.

-- the standing check, which cannot go stale the way a table of numbers does
select p.proname,
       p.prosecdef as definer,
       p.provolatile as volatility,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       coalesce(array_to_string(p.proacl::text[], ' | '), '(default: PUBLIC)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'chronicle_tally';
