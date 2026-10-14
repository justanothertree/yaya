-- ✅ APPLIED — migrations: chronicle_profile_block, chronicle_profile_block_window,
--                           chronicle_profile_block_live
--
-- A profile block for chronicle, and the one question it has to answer correctly.
--
-- Evan asked for "a profile block for the goals or stats". The block itself is easy; what is NOT
-- easy is that chronicle is the first thing on this site where the data being shown is a record of
-- somebody's own life, hour by hour. Everything a profile block has carried until now was made to
-- be looked at — a drawing, a song, a minion, a status. A chronicle is made for yourself, and some
-- of it is shown to other people only because its owner decided so, once, in a settings row they
-- will not revisit. So the whole design question is where the switch lives and what it governs.
--
-- ── WHERE THE SWITCH LIVES ──────────────────────────────────────────────────────────────────
--
-- ⚠️ THE BLOCK IS THE SWITCH, AND THERE IS NO OTHER ONE. `get_member_chronicle` returns null
-- unless the target HAS a chronicle block, and then only if the viewer may see that block. No
-- block, no answer — not an empty answer, no answer. That means a member who has never added the
-- block cannot leak anything through this path however the client is called, and taking the block
-- off the page is a complete revocation rather than a hiding.
--
-- This is deliberately NOT the pattern `stats` uses. The stats block renders `snake_best`, which
-- rides along in `get_member_profile` gated by `profiles.activity_visibility` — one tier covering
-- the snake score, the shared circuits and the movie count together. Three unrelated facts behind
-- one switch is already more than that switch can honestly mean, and chronicle would have been a
-- fourth and by far the most personal. "What may be read" is one question answered in one place,
-- which is the house pattern for member data everywhere else in this schema.
--
-- ⚠️ A CHRONICLE BLOCK CANNOT BE PUBLIC, refused in save_my_profile_blocks rather than discouraged
-- in the UI. CLAUDE.md §3 records what "Anyone" cost last time: it honestly meant "any member" for
-- as long as only members could load a profile, and everybody who chose it chose it under that
-- meaning. Here it would be worse than ambiguous, it would be backwards — `can_see(owner,'public')`
-- is `true` unconditionally, including for anon, but this RPC refuses an unauthenticated caller on
-- its first line. So a chronicle block set to 'public' would READ as "the whole internet" and
-- BEHAVE as "members". A tier whose name overstates what it does is the one thing a privacy
-- control must never be. Three tiers remain and each means exactly what it says.
--
-- ⚠️ AND IT IS NOT IN get_public_profile. That function is the anon-callable one, for a published
-- page a stranger can open. Chronicle stays out of it entirely — a published page shows a visitor
-- no hours at all. That is a decision to revisit deliberately or not at all, never by adding a key
-- to a payload because it was convenient.
--
-- ⚠️ AND THAT HOLDS WITHOUT A SECOND RULE TO KEEP IN SYNC, which is why the refusal is worth more
-- than it first looks. get_public_profile returns blocks `where b.visibility = 'public'` — that
-- tier and no other. A chronicle block can never carry that tier, so it can never appear there,
-- structurally. One rule in one place, rather than an allowlist here and a denylist over there
-- that have to agree forever.
--
-- ── WHAT IT SHOWS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────
--
-- Hours over a window the owner picks (1–90 days, default 7), split by the three categories the
-- room already names, plus the top five activities with their colours, plus two counts: goals
-- reached in that window and goals still open.
--
-- ⚠️ THE WINDOW IS A PARAMETER, AND THE SECOND MIGRATION IS WHY. It was read off the first
-- chronicle block's config, which is fine until somebody adds a second one — the server answered
-- both from block #1, so block #2's "How far back" picker silently did nothing. A control that
-- does nothing is worse than one that is not offered, and this was found by adding a second block
-- in the workbench rather than by reading the code. It is not a privacy boundary: the owner opted
-- into showing their hours, and 7 days of the same three figures is not a different consent from
-- 90. The server clamps it to 1–90 and does not otherwise trust it; the GATE is untouched and is
-- still the block's own visibility. `create or replace` cannot add a parameter — it makes an
-- overload — so this was a drop and recreate with a DEFAULT, which keeps a one-argument call from
-- an already-loaded bundle resolving.
--
-- The gate became "does this member have a chronicle block THIS viewer may see", which is the same
-- question as before for one block and the right one for two.
--
-- ⚠️ AND, ONLY IF ASKED FOR, WHAT THEY ARE DOING AT THIS MOMENT — the third migration, and the
-- rest of what Evan asked for: "chronicle tied to account and profile status if shared". The
-- account half was already true (it syncs); this is the profile half, a page that says what its
-- owner is actually doing.
--
-- ⚠️ IT IS OFF UNTIL SWITCHED ON, AND THE SWITCH IS READ FROM THE BLOCK — NOT FROM A PARAMETER,
-- which is the whole difference between it and `days`. A window is not a privacy boundary:
-- somebody who agreed to show their hours did not make a separate decision about seven of them
-- versus ninety, so a caller may ask for either. What they are doing RIGHT NOW, by name, to
-- anyone who opens the page, is a different decision from "here is my week" — so there is
-- deliberately no way for a caller to request it. `v_live` comes off `config->>'live'` on a block
-- the viewer can already see, in the same pass as the gate.
--
-- The real data made the case for that better than any argument: the first test run of it printed
-- an activity of Evan's called "talking with josh and parker". That is the sort of thing an
-- activity name is, and it is why this one is opt-in and why the editor says in plain words what
-- the card will show — including changing that sentence the moment the box is ticked.
--
-- ⚠️ → SUPERSEDED THE SAME DAY, and deliberately: the per-goal opt-in this paragraph asks for is
-- built, in docs/2026-10-14-chronicle-goal-share.sql. Two switches, both off by default — the
-- block says it will show goals, and each goal is ticked on its own. The paragraph stays because
-- the reasoning in it is why the feature has the shape it has.
--
-- ⚠️ → SUPERSEDED THE SAME DAY, and deliberately: the per-goal opt-in this paragraph asks for is
-- built, in docs/2026-10-14-chronicle-goal-share.sql. Two switches, both off by default — the
-- block says it will show goals, and each goal is ticked on its own. The paragraph stays, because
-- the reasoning in it is why the feature has the shape it has.
--
-- ⚠️ NO GOAL TITLES, in this first version, and that is a privacy decision rather than a scoping
-- one. A goal is free text somebody wrote about their own life — the seed for this room has "Ring
-- the dentist" in it, and real ones will be franker than that. Agreeing to show how many hours you
-- put into drawing is a different act from agreeing to show what you are trying to fix about
-- yourself, and a block that bundled both would collect the second consent while asking for the
-- first. If titles are wanted they belong behind a per-goal opt-in, not a block-level one.
--
-- ⚠️ AND NO PER-GOAL PROGRESS, which is a scoping decision. A goal's window comes from `goalWindow`
-- in src/chronicle/goal.ts — scope, anchor and repeat, six scopes' worth of rules — and the server
-- has no copy of it. chronicle_tally takes its windows FROM the caller for exactly that reason. A
-- second copy of those rules in SQL is a rule in two places that must agree forever, which is the
-- bug class this repository has the most scar tissue about. The counts above need no window logic
-- at all: `done_at` is an instant.
--
-- ⚠️ ACTIVITIES UNDER A MINUTE ARE DROPPED, both from the categories and the top five. The room
-- writes everything else in minutes, and a profile saying "Gym 0m" is a worse claim than one that
-- does not mention the gym.
--
-- ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────────────────
--
-- The gate, with the dimension under test unpinned. The first run of this proved nothing: it used
-- Josh as the non-friend viewer, and Josh and Evan are `accepted` friends, so the 'friends' tier
-- passing said only that friends can see a friends-tier block. Re-run with the friendship deleted
-- inside the transaction and `is_admin()` printed rather than assumed (false):
--
--   viewer is admin                     false
--   are_friends                         false
--   NON-friend sees a friends-tier block NULL      ← the one that matters
--   NON-friend sees a members-tier block data
--   non-owner sees a private block       NULL
--   owner sees his own private block     data
--   a username nobody has                NULL
--   a real member with no chronicle block NULL     ← identical to the line above, so a probe
--                                                     cannot learn who exists
--
-- Re-run in full against the two-argument version, which also pins the clamp:
--
--   non-friend, friends-tier, 30d        NULL
--   non-friend, friends-tier, no days    NULL
--   non-friend, members-tier, 30d        data
--   p_days 9999                          90      ← clamped
--   p_days -5                            1
--   p_days null                          7
--   unknown username                     NULL
--   member with no chronicle block       NULL
--   non-owner, private                   NULL
--
-- save_my_profile_blocks is a live function, so it was replaced against a behavioural baseline:
-- every one of the 34 existing blocks, across all 5 owners, replayed through the new function in a
-- rolled-back transaction, fingerprinted before and after.
--
--   before  bdf6ee1ea21dd730cea1ad605a51e78a  (34 rows)
--   after   bdf6ee1ea21dd730cea1ad605a51e78a  (34 rows)
--
-- Provably a no-op for everybody who has a profile today. And the new rules bite:
--
--   chronicle at members / friends / private      ACCEPTED
--   chronicle with the tier omitted               ACCEPTED (defaults to members)
--   chronicle at public                           refused: a chronicle block cannot be public
--   chronicle at public beside a legitimate
--     public bio in the same array                refused  ← not fooled by a well-formed neighbour
--   bio at public, art at public                  ACCEPTED (unchanged)
--   a made-up block type                          refused: invalid block
--
-- ── THE FUNCTIONS ───────────────────────────────────────────────────────────────────────────

create or replace function public.get_member_chronicle(p_username text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_cfg jsonb;
  v_vis public.visibility_tier;
  v_days int;
  v_from timestamptz;
  v_to timestamptz := clock_timestamp();
  v_time jsonb;
  v_top jsonb;
  v_reached int;
  v_open int;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;

  select p.user_id into v_target
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  -- ⚠️ the same null a member with no block gets, so this never answers "who exists"
  if v_target is null then return null; end if;

  select b.config, b.visibility into v_cfg, v_vis
  from public.profile_blocks b
  where b.user_id = v_target and b.block_type = 'chronicle'
  order by b.position
  limit 1;
  -- ⚠️ FOUND, not `v_cfg is null` — a block whose config is '{}' is a block
  if not found then return null; end if;

  if v_target <> v_viewer and not public.can_see(v_target, v_vis) then return null; end if;

  v_days := least(greatest(coalesce((v_cfg->>'days')::int, 7), 1), 90);
  v_from := v_to - make_interval(days => v_days);

  -- ⚠️ the overlap sum is chronicle_sum's, character for character. A session that began before
  -- the window and ends inside it belongs to it, counted only for the part that lands in range,
  -- and a running one is measured to now.
  select coalesce(jsonb_object_agg(t.cat, round(t.mins)), '{}'::jsonb) into v_time
  from (
    select a.cat,
           sum(greatest(0, extract(epoch from (
             least(coalesce(e.ended_at, clock_timestamp()), v_to)
             - greatest(e.started_at, v_from))))) / 60.0 as mins
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
     where e.owner = v_target
       and e.started_at < v_to
       and coalesce(e.ended_at, clock_timestamp()) > v_from
     group by a.cat
  ) t
  where t.mins >= 1;

  select coalesce(jsonb_agg(x order by x.mins desc, x.name), '[]'::jsonb) into v_top
  from (
    select a.name, a.cat, a.colour,
           round(sum(greatest(0, extract(epoch from (
             least(coalesce(e.ended_at, clock_timestamp()), v_to)
             - greatest(e.started_at, v_from))))) / 60.0) as mins
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = v_target
     where e.owner = v_target
       and e.started_at < v_to
       and coalesce(e.ended_at, clock_timestamp()) > v_from
     group by a.id, a.name, a.cat, a.colour
     having sum(greatest(0, extract(epoch from (
              least(coalesce(e.ended_at, clock_timestamp()), v_to)
              - greatest(e.started_at, v_from))))) / 60.0 >= 1
     order by mins desc, a.name
     limit 5
  ) x;

  select count(*) filter (where g.done_at is not null and g.done_at >= v_from),
         count(*) filter (where g.done_at is null)
    into v_reached, v_open
  from public.chronicle_goals g
  where g.owner = v_target;

  return jsonb_build_object(
    'days', v_days,
    'time', v_time,
    'top', v_top,
    'reached', v_reached,
    'open', v_open
  );
end $fn$;

-- ⚠️ `public, anon` — a revoke aimed at PUBLIC alone leaves anon holding execute in this project,
-- because anon was granted directly. See CLAUDE.md §3.
revoke all on function public.get_member_chronicle(text) from public, anon;
grant execute on function public.get_member_chronicle(text) to authenticated;

create or replace function public.save_my_profile_blocks(p_blocks jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_count int;
  v_total bigint;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'p_blocks must be an array'; end if;

  -- ⚠️ ASSIGNED, not `select count(*) into v_count`. The two are identical in plpgsql, but the
  -- SQL editor lints the body as top-level SQL, where `select … into name` is the archaic
  -- spelling of CREATE TABLE AS — so it reports "creates a table without RLS: v_count" every
  -- time this file is opened. It never created a table; a warning you have to dismiss to
  -- proceed is a warning you stop reading, and that habit is worth more than one line of style.
  v_count := (select count(*) from jsonb_array_elements(p_blocks));
  if v_count > 20 then raise exception 'too many blocks (max 20)'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where (e->>'block_type') not in (
            'bio','banner','stats','activity','guestbook','status','trophies',
            'song','visualizer','art','looks',
            -- text at any size, face and alignment, or no text at all and just a shape
            'free',
            -- Holds packed drawings, the same shape 'art' holds, checked by the same cap below
            -- and by readPet on the way out.
            'pet',
            -- ⚠️ THE ADDITION. Carries no data of its own — its config is which window to cover,
            -- and the figures are derived at read time by get_member_chronicle, which uses THIS
            -- block's visibility as the only gate. See docs/2026-10-14-chronicle-profile-block.sql
            'chronicle'
          )
       or (e->>'size') not in ('small','medium','large')
       or coalesce(e->>'visibility','members') not in ('public','friends','members','private')
       -- ⚠️ 64000, four times what it was. A pet and a drawing carry every stroke that made
       -- them, so this is the only block cap anybody ever reaches, and 16000 was a number with
       -- no reasoning attached to it anywhere in the repository.
       or length(e->>'config') > 64000
  ) then
    raise exception 'invalid block';
  end if;

  /**
   * ⚠️ A CHRONICLE BLOCK CANNOT BE PUBLIC, and this is the only place that can enforce it.
   *
   * `can_see(owner,'public')` is true unconditionally, anon included — but get_member_chronicle
   * refuses an unauthenticated caller outright. So 'public' on this block would READ as "the
   * whole internet" and BEHAVE as "members": a tier whose name overstates what it does, which is
   * the one thing a privacy control must never be. Refused at the door rather than discouraged in
   * the UI, because the UI is not what decides this.
   *
   * Checked against a well-formed neighbour: a public 'bio' in the same array does not carry a
   * public 'chronicle' through with it.
   */
  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where e->>'block_type' = 'chronicle'
      and coalesce(e->>'visibility','members') = 'public'
  ) then
    raise exception 'a chronicle block cannot be public';
  end if;

  -- ⚠️ AND A CEILING ON THE WHOLE PAGE, which is the thing actually worth bounding and was not
  -- bounded at all. A visitor downloads and draws every block on a profile, so what costs them
  -- is the total, not the largest one.
  v_total := (select coalesce(sum(length(e->>'config')), 0) from jsonb_array_elements(p_blocks) e);
  if v_total > 160000 then raise exception 'profile too large'; end if;

  delete from public.profile_blocks where user_id = v_me;

  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  select v_me,
         e->>'block_type',
         (row_number() over ())::int,
         e->>'size',
         coalesce(e->'config','{}'::jsonb),
         coalesce(e->>'visibility','members')::public.visibility_tier
  from jsonb_array_elements(p_blocks) e;
end;
$function$;

-- ── the standing check, after ───────────────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in
--   ('get_member_chronicle','save_my_profile_blocks');
-- → both false
