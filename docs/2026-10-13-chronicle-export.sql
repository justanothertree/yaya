-- ✅ APPLIED as migration `chronicle_export`, 13 Oct 2026
--
-- chronicle_export(): everything one person has recorded, as one document.
--
-- WHY
-- ---
-- Chronicle is the only store on this site with no local copy, and that was the right call: a
-- record of your days has to be the same on a phone and a laptop, so there is one copy and it is
-- the server's (see the note at the top of src/chronicle/cloud.ts). The cost of that decision was
-- never named until now — it left chronicle the only thing here nobody could take out. The Account
-- page offers songs, drawings, looks and minions as a file on the stated grounds that "a file is
-- the copy that survives losing the account", and chronicle had no such file. The thing this room
-- replaced kept everything in localStorage, where it was the person's by accident; this makes it
-- theirs on purpose.
--
-- ONE DOCUMENT, NOT FIVE RESULT SETS
-- ----------------------------------
-- The obvious build is client-side: call the five list RPCs and stitch the answers together. The
-- reason not to is truncation. A set comes back through PostgREST, which can cap rows, and a cap
-- it applies quietly turns "everything you ever recorded" into "some of it" — with the download
-- looking exactly as successful either way. That is the same shape as a local ceiling under the
-- server's, where the person is told the thing worked. One row cannot be truncated by a row limit,
-- and it is one round trip rather than five.
--
-- THREE THINGS THE FUNCTION IS CAREFUL ABOUT
-- ------------------------------------------
--  · `owner` is not in the file. It is the same uuid on every row, it is the caller's own account
--    id, and the file is meant to be carried between machines. Writing it out would put an account
--    identifier in that file in exchange for nothing a restore could not work out.
--  · Every list is ordered, so two exports of unchanged data are byte-identical. Nothing needs
--    that today; somebody diffing last month's file against this month's does, and an unordered
--    jsonb_agg would make every line look changed.
--  · It is not bounded, deliberately. An export that quietly stopped at N rows would be the exact
--    failure it exists to prevent. The ceiling is what one person has written about their own days,
--    and the authenticator role's 8s statement_timeout is the backstop.
--
-- MEASURED
-- --------
--  · No session: refused, `not authenticated`.
--  · A session owning nothing sees goals=0 plans=0 entries=0 routines=0 activities=0 — the
--    `owner = me` filter doing real work, since without it it would see the owner's rows.
--  · The owner sees their own 4 activities, 5 entries, 1 goal; header is {kind, version, at} and
--    the owner's uuid appears nowhere in the file.
--  · Two calls in one transaction are md5-identical.
--  · Synthesised at three years of three sittings a day: 45-52ms, 3,293 entries out for 3,293 rows
--    in, 931 kB of json, ascending. Well inside the 8s timeout.
--  · End to end in the preview harness: pressing the button produced a 12,912-byte
--    application/json blob named chronicle-2026-10-13.json carrying the column names
--    (started_at, repeat_every, done_at, est_mins) rather than the room's vocabulary.
--
-- THE DOUBLE
-- ----------
-- src/dev/chroniclePreview.ts gained pvExport, and it is the one place in that file that has to
-- speak the SERVER's vocabulary rather than the room's: everywhere else an entry has `start`, a
-- goal has `every` and `done`, an activity has `archived`. A double that exported its own words
-- would be internally consistent, would look right in the pane, and would agree about a file no
-- member will ever be sent. Six tests pin it, and seven perturbations were run against them —
-- three of which passed at first and are the interesting ones:
--   · deleting the sort from the entries list stayed green, because the fixture happened to insert
--     them in ascending order. A list that arrives sorted is sorted whether or not anything sorts
--     it. The fixture now inserts out of order on purpose.
--   · deleting the sort from the PLANS list stayed green against a test that compared two exports
--     for equal bytes — two unsorted lists agree with each other perfectly. Each list is now asked
--     about its own key.
--   · replacing the fixed timestamp with `new Date()` stayed green, because the two calls landed in
--     the same millisecond. The comparison now has a few milliseconds between the calls.

-- the standing check
select p.proname,
       p.prosecdef as definer,
       p.provolatile as volatility,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       coalesce(array_to_string(p.proacl::text[], ' | '), '(default: PUBLIC)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'chronicle_export';

-- ── WHAT THE FILE DOES NOT CARRY, 15 OCT 2026 ───────────────────────────────────────────────
--
-- The double's key lists in src/dev/chroniclePreview.test.ts are hand-written, because vitest
-- cannot reach Postgres — and CLAUDE.md §11 is about exactly that shape: rpc-inventory.md was a
-- hand-kept table of 116 functions and was wrong in both directions inside four weeks. The lists
-- have to stay, so the drift gets a query instead of a habit.
--
-- Run on 15 Oct 2026, after `shared` was added to chronicle_goals the day before:
--
--   chronicle_activities   6 rows    owner
--   chronicle_entries      9 rows    owner
--   chronicle_goals        1 row     owner, shared
--   chronicle_plans        0 rows    ⚠ NOT CHECKED
--   chronicle_routines     0 rows    ⚠ NOT CHECKED
--
-- `owner` is deliberate and tested: the file is passed between machines and never names an
-- account. So `chronicle_goals.shared` is the ONLY column on any chronicle table that the file
-- leaves behind.
--
-- ⚠️ AND IT SHOULD STAY THAT WAY. `chronicle_import` ignores the column on purpose, so that a
-- file somebody sends you cannot put goals on your profile. Exporting a flag that nothing will
-- ever read back would only write a privacy fact into a file that gets passed around, and the
-- file carries no owner id, so "this one is mine" is not a question it can answer. What it costs
-- is that a restore leaves your goals private until you tick them again — the direction this
-- should fail in. Checked by reading the function's own output rather than its source.
--
-- ⚠️ THE ⚠ MATTERS AS MUCH AS THE ANSWER. The first version of this query derived the keys from
-- the exported rows and reported every column of chronicle_plans and chronicle_routines as
-- missing — because the account has none of either, so there were no rows to take keys from. A
-- list with nothing in it has no keys, and a sweep that cannot say so reports a catastrophe.
-- Run it against an account that has at least one of each, or read those two off the function.

begin;
select set_config('request.jwt.claims',
       json_build_object('sub', owner, 'role', 'authenticated')::text, true)
  from public.chronicle_entries group by owner order by count(*) desc limit 1;
set local role authenticated;
select set_config('probe.f', public.chronicle_export()::text, true);
reset role;

with f as (select current_setting('probe.f')::jsonb as j),
map(tbl, list) as (values
  ('chronicle_activities','activities'), ('chronicle_entries','entries'),
  ('chronicle_goals','goals'), ('chronicle_routines','routines'), ('chronicle_plans','plans')),
seen as (
  select m.list, jsonb_array_length(coalesce(f.j->m.list,'[]'::jsonb)) as rows from map m, f
),
keys as (
  select m.list, k.key
    from map m, f,
         lateral jsonb_array_elements(coalesce(f.j->m.list,'[]'::jsonb)) r,
         lateral jsonb_object_keys(r.value) k(key)
  group by m.list, k.key
)
select m.tbl,
       s.rows as rows_examined,
       case when s.rows = 0 then '⚠ NOT CHECKED — no rows on this account'
            else coalesce(string_agg(c.column_name, ', ' order by c.column_name)
                            filter (where k.key is null), '(nothing)')
       end as columns_the_file_does_not_carry
from map m
join seen s on s.list = m.list
join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = m.tbl
left join keys k on k.list = m.list and k.key = c.column_name
group by m.tbl, s.rows
order by m.tbl;
rollback;
