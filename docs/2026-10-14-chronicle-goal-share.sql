-- ✅ APPLIED — migrations: chronicle_goal_share, chronicle_goals_mine_shared
--
-- Goals on a profile, behind two switches that are both required.
--
-- This is the other half of what Evan asked for — "a profile block for the goals or stats" — and
-- the half I deliberately did not ship with the block, saying at the time that if titles were
-- wanted they belonged behind a per-goal opt-in rather than a block-level one. This is that.
--
-- ── WHY IT IS TWO SWITCHES AND NOT ONE ──────────────────────────────────────────────────────
--
-- A goal is free text somebody wrote about their own life. The seed for this room has "Ring the
-- dentist" in it, which is the mild end; real ones are franker. Showing the hours you spent on
-- drawing and showing what you are trying to fix about yourself are different acts, and a single
-- control that did both would collect the second consent while asking for the first.
--
-- So:
--
--   1. `chronicle_goals.shared` — the owner ticks ONE GOAL, in the room, next to that goal.
--   2. `profile_blocks.config->>'goals'` — the block says it is willing to show goals at all.
--
-- Neither alone shows anybody anything, and both default to off. A member who ticks a goal and
-- has no chronicle block has published nothing; a block that asks for goals on an account where
-- none are ticked shows nothing. Proven both ways round in SQL and then again through the two
-- controls themselves — see "What was checked".
--
-- ⚠️ AND `shared` IS READ FROM THE ROW, NOT PASSED BY THE CALLER, exactly as `live` is. The window
-- (`p_days`) is a parameter because it is not a privacy boundary — somebody who agreed to show
-- their hours did not make a separate decision about seven of them versus ninety. What a goal is
-- called is a different matter, so there is deliberately no way for a caller to ask for one.
--
-- ⚠️ SIX AT MOST. A profile should not become a wall of somebody's ambitions, and an unbounded
-- list is also an unbounded payload on a page a stranger's browser draws.
--
-- ⚠️ AN IMPORTED GOAL IS NEVER SHARED. `chronicle_import` does not carry the column, so a file
-- somebody sends you cannot put goals on your profile — it lands private like everything else and
-- waits to be ticked. The preview double does the same, deliberately, so the behaviour is
-- exercisable without a session.
--
-- ── WHAT IT SHOWS, AND THE ONE THING IT DOES NOT ────────────────────────────────────────────
--
-- Title, target, unit, and whether it has been reached. **No progress figure.**
--
-- That is a scoping decision with a reason rather than a shrug: a goal's window comes from
-- `goalWindow` in `src/chronicle/goal.ts` — six scopes, an anchor-or-repeat rule, and the
-- Sunday-week convention — and the server has no copy of it. That is also precisely why
-- `chronicle_tally` takes its windows FROM the caller rather than deriving them. A progress bar
-- here would buy one line of UI and cost a second home for all of that date arithmetic, living in
-- SQL and obliged to agree with the TypeScript forever. CLAUDE.md has more scar tissue about a
-- rule in two places than about any other shape in this repository.
--
-- What a shared goal says, then, is what it IS, not how far along: "Read ten books · 10 books".
--
-- ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────────────────
--
-- The write path, in a rolled-back transaction with simulated sessions:
--
--   existing rows after the column is added      0 shared of 1   ← the default is private
--   owner shares their own goal                  1 shared of 1
--   another member tries to unshare it           refused: no such goal
--   …and it is still shared afterwards           1 shared of 1
--   anon can execute chronicle_goal_share        false
--
-- The refusal says "no such goal" for both "not yours" and "not there", so it cannot be used to
-- find out which.
--
-- The read path, each switch moved alone so neither result could be explained by the other:
--
--   block silent,  goal unshared   []
--   block silent,  goal SHARED     []     ← the block gate holds on its own
--   block ASKS,    goal SHARED     [the goal]
--   block ASKS,    goal unshared   []     ← the goal gate holds on its own
--
-- Then through the controls themselves rather than by setting config: ◯ beside two goals in the
-- room put exactly those two on the card and left the other nine off; unticking the block's own
-- "Show the goals I've picked" emptied the list while the hours stayed.
--
-- `chronicle_goals_mine` gained one key on a jsonb return, so no drop was needed and a bundle
-- somebody has open receives an extra key and ignores it — the same as when `chronicle_totals`
-- gained `colour`.
--
-- ── THE FUNCTIONS ───────────────────────────────────────────────────────────────────────────

alter table public.chronicle_goals
  add column if not exists shared boolean not null default false;

-- Its own small function rather than a parameter on chronicle_goal_save, which already takes
-- fourteen: one concern, and no drop-and-recreate of the save path everything else goes through.
create or replace function public.chronicle_goal_share(p_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.chronicle_goals
     set shared = coalesce(p_on, false), updated_at = now()
   where id = p_id and owner = auth.uid();
  -- the same message for "not yours" and "not there", so this cannot be used to find out which
  if not found then raise exception 'no such goal'; end if;
end $fn$;

revoke all on function public.chronicle_goal_share(uuid, boolean) from public, anon;
grant execute on function public.chronicle_goal_share(uuid, boolean) to authenticated;

-- get_member_chronicle gained `v_wants_goals` beside `v_live` in the same pass over the blocks,
-- and the goals block below. See 2026-10-14-chronicle-profile-block.sql for the whole function.
--
--   if v_wants_goals then
--     select coalesce(jsonb_agg(
--              jsonb_build_object('title', g.title, 'target', g.target,
--                                 'unit', g.unit, 'done', g.done)
--              order by g.ord), '[]'::jsonb)
--       into v_goals
--     from (
--       select gl.title, gl.target, gl.unit, (gl.done_at is not null) as done,
--              row_number() over (order by gl.priority desc, gl.sort, gl.title) as ord
--         from public.chronicle_goals gl
--        where gl.owner = v_target and gl.shared
--        order by gl.priority desc, gl.sort, gl.title
--        limit 6
--     ) g;
--   end if;

-- ── the standing check, after ───────────────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in
--   ('chronicle_goal_share','get_member_chronicle','chronicle_goals_mine');
-- → all false
