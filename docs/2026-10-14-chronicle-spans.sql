-- ✅ APPLIED — migration: chronicle_spans_and_since
--
-- The whole record, a year at a time — and why the windows come from the client.
--
-- ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────────────────────
--
-- Six horizon views, and five of them say something about the record. Today and Tomorrow have the
-- day's own totals two inches above them. Week, month and year each get `Looking` — hours, the
-- three categories, how it compares with the same stretch before. **Years had its life-scope goals
-- and not one word about the record**, which is a strange thing for the view whose whole subject
-- is the things that take years.
--
-- The note at Looking's call site SAID why — quoted here as it stood before this change, because
-- it has since been reworded to point forward at the answer rather than to read as a dead end:
--
--   "⚠️ AND NOT FOR Years, which has no window to add up. All-time totals are a different question
--    and the range cap is 400 days, so pretending would mean quietly showing a year and calling it
--    everything."
--
-- `chronicle_totals` really does raise above 400 days, and showing a year labelled "everything"
-- would be exactly the kind of quiet lie this room is built against. But that is a fact about one
-- function rather than a reason to show nothing. "A different question" is a description of work
-- to do, so this is that work.
--
-- ── WHY THE CALLER COMPUTES THE WINDOWS ─────────────────────────────────────────────────────
--
-- ⚠️ A YEAR BEGINS AT LOCAL MIDNIGHT, AND THE SERVER DOES NOT KNOW THE ZONE. The obvious shortcut
-- is to pass a UTC offset and let Postgres bucket by it — and it is wrong twice a year, because an
-- offset taken today is not the offset that was in force on the 1st of January. An hour
-- misattributed at a boundary is small and it is also exactly the class of error that makes a
-- total impossible to reconcile later.
--
-- So `chronicle_spans` takes the windows already computed, the same way `chronicle_tally` does and
-- for the same reason. `src/chronicle/year.ts` builds them with `new Date(y, 0, 1)`, which is local
-- by construction, and its test asserts the property rather than any boundary: the windows TILE —
-- each one ends where the next begins — so the sum over all of them is the whole record, with no
-- sitting dropped between two of them or counted by both.
--
-- ⚠️ AND THE OVERLAP SUM IS chronicle_sum'S, CHARACTER FOR CHARACTER. A sitting that began in one
-- year and ended in the next belongs to both, for the part that lands in each. Attributing it to
-- the year it STARTED would be simpler and would disagree with every other total in the room.
--
-- ── chronicle_since ─────────────────────────────────────────────────────────────────────────
--
-- One line, and it exists so the client knows how many years to ask about. The alternative was to
-- ask for a fixed ten and filter the empty ones, which is wrong in both directions: it pads a new
-- member's view with blanks and silently truncates anybody who has been at this longer.
--
-- ⚠️ NULL FOR AN EMPTY RECORD rather than today, because "you have been at this since today" is a
-- sentence about nothing, and the view needs to tell those two apart to say the right thing.
--
-- ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────────────────
--
--   chronicle_since()                     2026-10-13  (the earliest sitting on the account)
--   spans for 2026 and 2025               {"2025": {}, "2026": {"free": 31, "locked": 69}}
--   anon can execute either               false, false
--   the anon-callable set afterwards      still exactly 8 functions, unchanged
--
-- A year with nothing in it answers `{}` rather than being absent, so a caller can tell "no time"
-- from "not asked about".
--
-- Driven through the room afterwards, with three sittings added to the preview seed in earlier
-- years so the view has something to be a view of:
--
--   16h 23m recorded in all · since August 5, 2024 · 801 days
--   2026   11h 28m    locked 595px · free 164 · life 37
--   2025    3h 55m    locked 272
--   2024       1h     free 69
--
-- 11h28 + 3h55 + 1h = 16h23, which is the headline — checked by hand rather than by trusting the
-- same sum twice. The segments scale against the BIGGEST year rather than the total, the rule every
-- other bar in this room uses: against the total, six years of records would be six slivers.
--
-- ── CHECKED AGAIN, 15 OCT 2026: A SITTING THAT CROSSES THE BOUNDARY ─────────────────────────
--
-- The overlap sum above is the whole reason this function exists rather than a `group by` on the
-- year a sitting started in, and nothing had ever asked it about a sitting that straddles one.
--
-- Read-only, in a rolled-back transaction, with windows placed INSIDE an existing 69-minute
-- sitting rather than by inserting one into a real record:
--
--   two touching ten-minute windows     {"first ten": {"locked":10,"free":9}, "second ten": {"locked":10}}
--   the twenty minutes they tile        {"the twenty": {"locked":20,"free":9}}
--
-- locked 10 + 10 = 20, free 9 + 0 = 9. The windows tile and so do the answers.
--
-- ⚠️ THE MEASUREMENT WAS CHOSEN TO DISCRIMINATE, which is the only kind worth running: both
-- windows begin AFTER the sitting started, so attributing a sitting to the window containing its
-- start would have answered 0 and 0, and counting it whole in every window it touches would have
-- answered 69 and 69. Agreement with the client's own `yearsBetween` split (1h either side of New
-- Year, checked in the room) is then two implementations agreeing rather than one repeated.
--
-- A category with nothing in a window is ABSENT from that window's object rather than zero —
-- `second ten` has no `free` key — which is the `having … >= 1` filter, and matches what the
-- client does with it.

-- ── A NEIGHBOURING FACT, RECORDED BEFORE IT BECOMES A BUG ───────────────────────────────────
--
-- Every function that answers "how much time" was read for its join at the same time, because
-- four of them answer it and a disagreement is a total that cannot be reconciled. They agree.
--
--   chronicle_entries.activity   on delete CASCADE   → an orphaned entry is impossible
--   chronicle_goals.activity     on delete SET NULL  → a goal can lose its source
--
-- and `chronicle_tally` only answers goals `where (gl.activity is not null or gl.cat is not
-- null)`. So deleting an activity would turn every goal pointed at it into one that is never
-- answered — reading 0 with the minutes sitting in the totals above it, and nothing on screen to
-- say why. ⚠️ NOTHING DELETES FROM chronicle_activities today; the only path is
-- chronicle_activity_archive. This is a note for whoever adds the first delete button.

-- ── THE FUNCTIONS ───────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_since()
returns timestamptz
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select min(e.started_at) from public.chronicle_entries e where e.owner = auth.uid();
$$;

create or replace function public.chronicle_spans(p_asks jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare out_j jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_asks is null or jsonb_typeof(p_asks) <> 'array' then return out_j; end if;
  -- a hundred and twenty years is more than anybody will ask for, and it is still bounded
  if jsonb_array_length(p_asks) > 120 then raise exception 'too many at once'; end if;

  with ask as (
    select x->>'key' as k, (x->>'from')::timestamptz as f, (x->>'to')::timestamptz as t
      from jsonb_array_elements(p_asks) x
  )
  select coalesce(jsonb_object_agg(z.k, z.cats), '{}'::jsonb) into out_j
  from (
    select a.k,
           coalesce(jsonb_object_agg(s.cat, s.mins) filter (where s.cat is not null), '{}'::jsonb) as cats
      from ask a
      -- one indexed range scan per ask, on chronicle_entries_owner_started (owner, started_at)
      left join lateral (
        select ac.cat,
               round(sum(greatest(0, extract(epoch from (
                 least(coalesce(e.ended_at, clock_timestamp()), a.t)
                 - greatest(e.started_at, a.f))))) / 60.0) as mins
          from public.chronicle_entries e
          join public.chronicle_activities ac on ac.id = e.activity and ac.owner = auth.uid()
         where e.owner = auth.uid()
           and e.started_at < a.t
           and coalesce(e.ended_at, clock_timestamp()) > a.f
         group by ac.cat
         having sum(greatest(0, extract(epoch from (
                  least(coalesce(e.ended_at, clock_timestamp()), a.t)
                  - greatest(e.started_at, a.f))))) / 60.0 >= 1
      ) s on true
     group by a.k
  ) z;
  return out_j;
end $fn$;

revoke all on function public.chronicle_since() from public, anon;
revoke all on function public.chronicle_spans(jsonb) from public, anon;
grant execute on function public.chronicle_since() to authenticated;
grant execute on function public.chronicle_spans(jsonb) to authenticated;

-- ── the standing check, after ───────────────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in ('chronicle_since','chronicle_spans');
-- → both false
