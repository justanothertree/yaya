-- ✅ APPLIED 31 Oct 2026 as `setters_clamp_to_the_ceiling`.
--
-- Phase 5 of docs/2026-10-30-one-visibility-ladder-plan.md: the setters stop writing a raw tier.
--
-- ⚠️ FOUR SETTERS WROTE WHATEVER TIER THEY WERE HANDED, AND `clamp_visibility` EXISTED THE WHOLE
-- TIME. Phase 1 built the ceiling and Phase 2 taught the read doors to respect it; nothing ever
-- taught the WRITE side, so a member whose ceiling is `members` could store `public` and the
-- stored value simply disagreed with the effective one. Enumerated rather than guessed at -- the
-- fourth was found by asking which functions write a visibility column, not by reading the three
-- obvious names:
--
--   set_my_activity_visibility   -> profiles.activity_visibility
--   set_my_snake_visibility      -> player_registry.visibility
--   set_person_visibility        -> circuit_people.visibility
--   save_my_profile_blocks       -> profile_blocks.visibility      (the one nobody would have named)
--
-- `player_registry_default_reveal` also writes a tier and is left alone on purpose: it only ever
-- sets `friends`, which is at or below every ceiling the ladder can produce.
--
-- ⚠️ IT WAS NOT A LEAK, AND THE REASON MATTERS MORE THAN THE REASSURANCE. The read doors clamp,
-- and that clamp was measured to be load-bearing rather than read off the source: with a page's
-- tier stored at `public`, dropping its owner's ceiling from public to members took an anonymous
-- `get_public_activity` from 50 rows to 0. So nothing was being over-shared today.
--
-- What was wrong is LATENT. A tier stored above the ceiling is a widening with a trigger on it:
-- the day an owner's ceiling rises -- a member marked admin, or "only Evan can publish" opening to
-- adults as the plan intends -- `least(stored, ceiling)` starts returning the wider value, and
-- nobody chose that on the day it happens. The requirement for this whole ladder was that nobody's
-- visibility widens, so a stored tier that is only held back by a ceiling is exactly the thing to
-- remove. Five rows were already in that state: 1 in profiles, 1 in circuit_people, 3 in
-- profile_blocks (all three of them on one member's page).
--
-- ⚠️ `set_person_visibility` CLAMPS AGAINST THE ROW'S OWNER, NOT THE CALLER, and getting this
-- backwards would have been worse than leaving it unclamped. An admin may set a tier on somebody
-- else's circuit, and the admin's own ceiling is `public` -- so `clamp_visibility(auth.uid(), ...)`
-- would have authorised a moderation action to publish a member's person past that member's own
-- ceiling, in the name of adding a safety check. Measured both ways: the admin setting `public` on
-- Ramtin's person stores `members` (Ramtin's ceiling), while the admin setting `public` on their
-- own person stores `public`.
--
-- ⚠️ AND `save_my_profile_blocks` CLAMPS RATHER THAN REFUSING, which is the difference between a
-- safety check and a locked room. `profile_blocks.visibility` defaults to `members` while a new
-- signup's `age_band` is `unknown`, whose ceiling is `friends` -- so a tidy-looking RAISE on a tier
-- above the ceiling would have made the editor's own default unsaveable, and the first thing a new
-- member ever did on the site would have failed. Clamping is also what the read doors already do,
-- so this only makes the stored tier agree with the effective one.
--
-- Verified in rolled-back transactions against the live database:
--   austin (ceiling members) asks `public`   -> stores `members`   (activity, and snake)
--   austin asks `friends` / `members`        -> stores `friends` / `members`  (null control)
--   admin -> Ramtin's person, asks `public`  -> stores `members`
--   admin -> own person, asks `public`       -> stores `public`    (null control)
--   a block asking `public`                  -> stores `members`
--   Josh's 20 blocks saved back unchanged    -> 17 identical, 3 clamped public->members,
--                                               every block_type, size and config identical
--   all four refusals still fire             -> 21 blocks, bad block_type, public chronicle,
--                                               oversized page, each with its own message
--   member-to-member matrix                  -> 196 cells / 539 / 7,118 / 130, md5 unchanged at
--                                               8e163d91a6925025e270416c6d387718 (reads untouched)
--   grants after `create or replace`         -> anon cannot execute any of the four; members can
--
-- ⚠️ THE FIVE EXISTING OVER-CEILING ROWS ARE DELIBERATELY NOT BACKFILLED HERE. They are real
-- choices by real members, and rewriting another member's settings is the owner's call under
-- CLAUDE.md §4, not something a migration should do quietly. They also correct themselves: Josh's
-- three blocks came back as `members` the moment his page was saved again. The backfill is a
-- one-line update when Evan says so.

create or replace function public.set_my_activity_visibility(p_tier public.visibility_tier)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.profiles
     set activity_visibility = public.clamp_visibility(auth.uid(), p_tier)
   where user_id = auth.uid();
end $function$;

create or replace function public.set_my_snake_visibility(p_tier public.visibility_tier)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.player_registry
     set visibility = public.clamp_visibility(auth.uid(), p_tier)
   where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end
$function$;

create or replace function public.set_person_visibility(p_person_id text, p_tier public.visibility_tier)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* Clamped against the ROW'S OWNER, never against auth.uid(). An admin may set a tier on
     somebody else's circuit, and the admin's own ceiling is `public` - so clamping to the caller
     would let a moderation action publish a member's person past that member's ceiling. The
     owner's ceiling is the one that describes the person being published. */
  update public.circuit_people
     set visibility = public.clamp_visibility(owner_user_id, p_tier)
   where id = p_person_id and (owner_user_id = auth.uid() or public.is_admin());
  if not found then raise exception 'not your circuit'; end if;
end
$function$;

create or replace function public.save_my_profile_blocks(p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_count int;
  v_total bigint;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'p_blocks must be an array'; end if;

  -- ASSIGNED, not `select count(*) into v_count`: the SQL editor lints the body as top-level SQL,
  -- where `select . into name` is the archaic spelling of CREATE TABLE AS, and reports
  -- "creates a table without RLS: v_count" every time this file is opened.
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
            -- THE ADDITION. Carries no data of its own - its config is which window to cover, and
            -- the figures are derived at read time by get_member_chronicle, which uses THIS
            -- block's visibility as the only gate.
            -- See docs/2026-10-14-chronicle-profile-block.sql
            'chronicle'
          )
       or (e->>'size') not in ('small','medium','large')
       or coalesce(e->>'visibility','members') not in ('public','friends','members','private')
       -- 64000, four times what it was. A pet and a drawing carry every stroke that made them, so
       -- this is the only block cap anybody ever reaches.
       or length(e->>'config') > 64000
  ) then
    raise exception 'invalid block';
  end if;

  -- A CHRONICLE BLOCK CANNOT BE PUBLIC, and this is the only place that can enforce it.
  -- can_see(owner,'public') is true unconditionally, anon included - but get_member_chronicle
  -- refuses an unauthenticated caller outright. So 'public' here would READ as "the whole
  -- internet" and BEHAVE as "members": a tier whose name overstates what it does, which is the one
  -- thing a privacy control must never be.
  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where e->>'block_type' = 'chronicle'
      and coalesce(e->>'visibility','members') = 'public'
  ) then
    raise exception 'a chronicle block cannot be public';
  end if;

  -- AND A CEILING ON THE WHOLE PAGE: a visitor downloads and draws every block on a profile, so
  -- what costs them is the total, not the largest one.
  v_total := (select coalesce(sum(length(e->>'config')), 0) from jsonb_array_elements(p_blocks) e);
  if v_total > 160000 then raise exception 'profile too large'; end if;

  delete from public.profile_blocks where user_id = v_me;

  /* CLAMPED, NOT REFUSED, and the difference is whether a new member can save their own page.
     `profile_blocks.visibility` defaults to 'members' and a new signup's age_band is 'unknown',
     whose ceiling is 'friends' - so raising on a tier above the ceiling would make the editor's
     own default value unsaveable, and the first thing a new member did on the site would fail.
     Clamping silently is also what every read door already does, so this makes the stored tier
     agree with the effective one rather than changing what anybody can see. */
  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  select v_me,
         e->>'block_type',
         (row_number() over ())::int,
         e->>'size',
         coalesce(e->'config','{}'::jsonb),
         public.clamp_visibility(v_me, coalesce(e->>'visibility','members')::public.visibility_tier)
  from jsonb_array_elements(p_blocks) e;
end;
$function$;
