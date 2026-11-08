-- ⛔ DRAFT — NOT APPLIED, NOT APPROVED FOR PRODUCTION. Nothing in this file has been run against
-- any database. When it is applied, this header is replaced by the migration's name, the way the
-- four drafts of 29 Oct were (see docs/2026-10-29-the-four-drafts-applied.md) — a "not applied"
-- line left standing after the fact is exactly the sentence that goes stale.
--
-- Selected-weekday recurrence for a repeating day goal: "swim on Tuesdays", "floss every day but
-- Sunday". The client half is src/chronicle/weekdays.ts, which is written and tested (17 tests,
-- seven perturbations each turned some red) and imported by nothing until this exists.
--
-- ── THE ONE RULE, SET BY EVAN ───────────────────────────────────────────────────────────────
--
-- "Schedule changes affect future occurrences, not historical completion records."
--
-- That rules out the obvious shape — one `days` column on chronicle_goals — because a column can
-- only say what the schedule IS, and the streak and the mark row judge thirty-one days of what it
-- WAS. Changing "every day" to "Tuesdays" in a column would re-judge the whole past month under
-- the new rule the moment it was saved. So the schedule is a history: each change is a row with
-- the day it starts, and every day is judged by the row in force on that day.
--
-- ── WHERE THE RULES LIVE ────────────────────────────────────────────────────────────────────
--
-- Windows are already computed on the CLIENT — `chronicle_tally` takes the windows it is asked
-- about rather than knowing any rules, because a local day begins at local midnight and the
-- server does not know where anybody is. Scheduling is the same kind of rule, so it stays there:
-- this file adds storage and one writer, and `chronicle_tally` is untouched. That is also why the
-- profile block (`get_member_chronicle`) needs only to CARRY the rows; the arithmetic that reads
-- them is the same module either way.
--
-- ── THE TABLE ───────────────────────────────────────────────────────────────────────────────

create table if not exists public.chronicle_goal_days (
  goal      uuid not null references public.chronicle_goals(id) on delete cascade,
  -- carried so the writer can check ownership in one place, and so the export can select by it
  owner     uuid not null references public.profiles(user_id) on delete cascade,
  -- the local day this schedule starts on, as the client names it
  from_day  date not null,
  -- seven bits, Sunday = bit 0 (Date.getDay()), and never zero: a goal for no days is a goal in
  -- no list, which the room has already had to fix once for quarter goals
  days      smallint not null check (days between 1 and 127),
  set_at    timestamptz not null default now(),
  primary key (goal, from_day)
);

-- ⚠️ "ONLY A REPEATING DAY GOAL HAS A SCHEDULE" CANNOT BE A CHECK, because it is a fact about a
-- row in another table. It is enforced in the writer below — which makes this exactly the half-a-
-- rule shape CLAUDE.md §4 names for `chronicle_goals.counts`, and the reason the import (which
-- is the second write path) must be given the same guard in the server's own words.

-- ── DENY-ALL, EXPLICITLY, INCLUDING anon ────────────────────────────────────────────────────
-- pg_default_acl on `public` hands arwdDxtm to anon and authenticated on every new table, so
-- deny-all is something this table has to be given. A revoke aimed at PUBLIC leaves anon alone.

alter table public.chronicle_goal_days enable row level security;
revoke all on table public.chronicle_goal_days from public, anon, authenticated;

-- ── THE WRITER ──────────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_goal_days_set(p_goal uuid, p_days smallint, p_from date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_days is null or p_days < 1 or p_days > 127 then
    raise exception 'a goal has to be for at least one day';
  end if;

  -- ⚠️ THE FORWARD-ONLY RULE, KEPT BY THE SERVER RATHER THAN TRUSTED TO THE CLIENT. A schedule
  -- dated in the past is a rewrite of history by another name. The server does not know the
  -- member's time zone, and every local "today" on Earth falls within a day either side of UTC's,
  -- so the bound is UTC's date minus one. That leaves a one-day window in which a member far east
  -- of UTC could date a change to their own yesterday — named here rather than discovered.
  if p_from is null or p_from < (now() at time zone 'utc')::date - 1 then
    raise exception 'a schedule change starts today or later';
  end if;

  -- ownership and shape, by hand: the table is deny-all and this function is the only door
  if not exists (
    select 1 from public.chronicle_goals g
     where g.id = p_goal and g.owner = v_me
       and g.scope = 'day' and g.repeat_every is not null
  ) then
    raise exception 'no such repeating daily goal';
  end if;

  -- changing it twice on one day replaces that day's entry rather than stacking two
  insert into public.chronicle_goal_days (goal, owner, from_day, days)
  values (p_goal, v_me, p_from, p_days)
  on conflict (goal, from_day) do update set days = excluded.days, set_at = now();
end $$;

revoke all on function public.chronicle_goal_days_set(uuid, smallint, date) from public, anon;
grant execute on function public.chronicle_goal_days_set(uuid, smallint, date) to authenticated;

-- ── THE READERS, DESCRIBED RATHER THAN WRITTEN ──────────────────────────────────────────────
--
-- Each is a `create or replace` of a live function, and §4 says a live function is replaced
-- from its LIVE body with a behavioural baseline taken first — so writing a body here, from a
-- copy that may already be stale, would be the wrong kind of help. What each must gain:
--
--   chronicle_goals_mine      each goal carries `days: [{from, days}]`, empty for none
--   get_member_chronicle      the same, for goals the member has shared — the mark row on a
--                             profile is drawn by the same weekdays.ts, so it needs the rows
--   chronicle_export          a top-level `goal_days` list
--   chronicle_import          takes `goal_days`, add-never-replace keyed on (goal, from_day),
--                             and refuses a row whose goal is not a repeating day goal — the
--                             writer's guard, in the writer's words, because a rule only one
--                             path keeps is a rule the other path gets around
--   chronicle_goal_save       if a goal stops being a repeating day goal, its rows are DELETED,
--                             not left to be read by a goal they no longer describe
--
-- ⚠️ AND NOT chronicle_tally. See "where the rules live" above.
--
-- ── ISOLATED TESTS, AS REFUSALS ─────────────────────────────────────────────────────────────
--
-- To be run in a transaction that ends in a raise, against a throwaway database — the CI job
-- `db guards` already builds one from these migrations with `supabase db reset`, and runs exactly
-- one file in it. Running a second file there is a one-line workflow change, which is Evan's call
-- (OPEN-DECISIONS §16a). NOT against production: the fixtures write rows.
--
--   anon / authenticated: select, insert, update, delete, TRUNCATE on the table   all refused
--   anon executes chronicle_goal_days_set                                         refused
--   a member sets a schedule on ANOTHER member's goal                             refused
--   a member sets one on their own one-off goal, or their own weekly goal         refused
--   a member sets one dated two days ago (UTC)                                    refused
--   days = 0, days = 128                                                          refused
--   the same goal twice on one day                                                one row, the later mask
--   delete the goal                                                               its rows go too
--
-- And the standing check this project runs after every new function:
--
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');
--
-- ── RELEASE, EACH STEP INERT ALONE ──────────────────────────────────────────────────────────
--
--   1. this file: a table nobody reads and a writer nobody calls. Changes no behaviour.
--   2. the readers, one at a time, each a create-or-replace revertible to its git version.
--      A goal with no rows reads exactly as today.
--   3. the client: the day picker in the goal form, and weekdays.ts wired into `inScope`, the
--      mark row and the streak.
--
-- ROLLBACK at any step: `drop table public.chronicle_goal_days cascade` and the function. It loses
-- only schedules, and every goal falls back to "every day" — the behaviour before step 1.
