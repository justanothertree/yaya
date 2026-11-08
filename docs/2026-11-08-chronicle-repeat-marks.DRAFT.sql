-- ⛔ DRAFT — NOT APPLIED, NOT APPROVED FOR PRODUCTION. Nothing in this file has been run against
-- any database. When it is applied, this header is replaced by the migration's name.
--
-- A repeating goal you move by hand forgets nothing and resets nothing.
--
-- ── THE DEFECT, WHICH IS LIVE TODAY ─────────────────────────────────────────────────────────
--
-- `chronicle_goals` keeps ONE `done_at` and ONE `progress` per goal, and `chronicle_goal_progress`
-- writes `done_at = coalesce(done_at, now())`. For a one-off goal that is right — it has one
-- window. For a REPEATING goal moved by hand it is wrong in every window after the first:
--
--   "Floss every day" (a tick-box)       ticked once, reads ticked on every later day, so it can
--                                        never be ticked again and never be missed
--   "Stretch 20 min a day" (− and +)     the count carries over, so day two starts at yesterday's
--                                        total and the goal is "met" for ever after one good day
--
-- Read from the code (`chronicle_goal_progress` above; `finished()` in goal.ts reads `done` with
-- no window) and shown in the preview double, which keeps the same single flag: a new daily
-- tick-box ticked on Today was already ticked on Tomorrow. NOT exercised against production.
-- Goals the RECORD answers for are unaffected — the tally is asked per window.
--
-- "Floss every day: simple check-off" is the first example in the brief Chronicle was rebuilt
-- from on 7 Nov, which is why this is worth a migration rather than a note.
--
-- ── THE MODEL: ONE ROW PER GOAL PER WINDOW ──────────────────────────────────────────────────

create table if not exists public.chronicle_goal_marks (
  goal        uuid not null references public.chronicle_goals(id) on delete cascade,
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  -- the local start of the window this is about — a day, a Sunday, a 1st, a 1 January — sent
  -- by the client, exactly as the tally's windows are, because local midnight is the client's
  window_from date not null,
  progress    numeric not null default 0 check (progress >= 0 and progress <= 1e9),
  done_at     timestamptz,
  set_at      timestamptz not null default now(),
  primary key (goal, window_from)
);

-- deny-all, and the revoke names anon because pg_default_acl hands it arwdDxtm on every new table
alter table public.chronicle_goal_marks enable row level security;
revoke all on table public.chronicle_goal_marks from public, anon, authenticated;

-- ── THE WRITER ──────────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_goal_mark(
  p_goal uuid, p_from date, p_progress numeric, p_done boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then
    raise exception 'your account is suspended';
  end if;
  -- ⚠️ ONLY A REPEATING GOAL HAS WINDOWS. A one-off keeps using chronicle_goal_progress, whose
  -- single row IS its single window — so a mark on one would be a second answer to one question.
  if not exists (
    select 1 from public.chronicle_goals g
     where g.id = p_goal and g.owner = v_me and g.repeat_every is not null
  ) then
    raise exception 'no such repeating goal';
  end if;
  -- ⚠️ NO FUTURE WINDOWS. Ticking tomorrow's floss today is a claim about a day nobody has had;
  -- the bound is UTC's date plus one, because the server does not know the member's zone.
  if p_from is null or p_from > (now() at time zone 'utc')::date + 1 then
    raise exception 'that window has not started';
  end if;

  -- null means "I am not talking about this", as everywhere else in this room (CLAUDE.md §8)
  insert into public.chronicle_goal_marks (goal, owner, window_from, progress, done_at)
  values (p_goal, v_me, p_from,
          greatest(0, least(coalesce(p_progress, 0), 1e9)),
          case when p_done then now() end)
  on conflict (goal, window_from) do update
     set progress = case when p_progress is null then chronicle_goal_marks.progress
                         else greatest(0, least(p_progress, 1e9)) end,
         done_at  = case when p_done is null then chronicle_goal_marks.done_at
                         when p_done then coalesce(chronicle_goal_marks.done_at, now())
                         else null end,
         set_at   = now();
end $$;

revoke all on function public.chronicle_goal_mark(uuid, date, numeric, boolean) from public, anon;
grant execute on function public.chronicle_goal_mark(uuid, date, numeric, boolean) to authenticated;

-- ── THE READER ──────────────────────────────────────────────────────────────────────────────
-- Asked for the windows on screen, the way chronicle_tally is: the client sends (goal, from) pairs
-- and gets back the marks that exist. A window with no mark is untouched — progress 0, not done —
-- which is `asOf` in src/chronicle/marks.ts, written and tested (9 tests, four perturbations).
--
--   chronicle_goal_marks_for(p_asks jsonb) returns jsonb   -- yours only, by auth.uid(), deny-all
--
-- And streaks: a repeating tick-box can finally HAVE one. `streakAsks` today skips any goal that
-- is not derived; with marks it can ask for thirty-one windows of them the same way.
--
-- ── WHAT ELSE MUST CARRY IT ─────────────────────────────────────────────────────────────────
--   chronicle_export / chronicle_import   a `goal_marks` list; add-never-replace on (goal, from)
--   get_member_chronicle                  this window's mark for a SHARED goal, so a friend's view
--                                         of "Floss" is not stuck on the day it was first ticked
--   chronicle_goal_progress               unchanged for one-offs; for a repeating goal the client
--                                         stops calling it, and the row's own done_at/progress are
--                                         no longer read for one
--
-- ── ISOLATED TESTS, AS REFUSALS — against a throwaway database, never production ────────────
--   anon / authenticated: every privilege on the table, TRUNCATE included          refused
--   anon executes chronicle_goal_mark                                              refused
--   a member marks another member's goal                                           refused
--   a member marks their own ONE-OFF goal                                          refused
--   a member marks a window two days in the future (UTC)                           refused
--   a suspended member marks anything                                              refused
--   tick Floss for the 7th; read the 7th and the 8th                               done / untouched
--   progress null on an existing mark                                              unchanged
--   delete the goal                                                                its marks go too
--
-- ── THE LEGACY ROWS — a decision, recorded in OPEN-DECISIONS §17b ───────────────────────────
-- Repeating goals that exist today may carry a `done_at` or a `progress` on the row. Nothing here
-- deletes or rewrites them. The recommendation is that the migration COPIES a repeating goal's
-- `done_at` into a mark for the window that contains it — that is a true fact: it was done then —
-- and leaves `progress` on the row unread, because nothing records which window a hand-moved count
-- belonged to and inventing one would be a claim about a day nobody can check.
--
-- ── RELEASE, EACH STEP INERT ALONE ──────────────────────────────────────────────────────────
--   1. table, writer and reader: nothing calls them. No behaviour changes.
--   2. the legacy copy (§17b), in its own migration so it can be read and reverted alone.
--   3. the client: `asOf` over the goal list for every view, tick and ± sent to the mark writer
--      for a repeating goal, and the streak asks widened.
-- ROLLBACK: the client goes back to the row; `drop table public.chronicle_goal_marks cascade`.
-- Marks made in between are lost, and every repeating goal reads as it does today.
