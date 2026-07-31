-- ============================================================================
-- Visibility tiers — STEP 3 of 5: point the live predicates at can_see.
-- Design + decisions: docs/visibility-tiers-design.md
--
-- APPLIED 2026-07-31. This is the step where behaviour actually changes.
-- Scope: circuit people + the Snake name reveal. Chat is deliberately NOT
-- included -- chat_room_member() is also touched by the pinned lounge opt-in
-- (docs/2026-07-30-lounge-optin.sql), so flipping it there keeps the two from
-- fighting over the same function.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 3a. BUGFIX to step 1's can_see: the ownerless branch sat ABOVE the tier
-- checks, so an ownerless row at 'members' or 'friends' collapsed to
-- admin-only. That is right for an unclaimed circuit board but wrong for
-- anything ownerless by nature -- a lounge chat room has no owner and must
-- still be members-visible. Tier checks now run first; the ownerless fallback
-- governs 'private' only.
-- ----------------------------------------------------------------------------
create or replace function public.can_see(p_owner uuid, p_tier public.visibility_tier)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when p_tier = 'public' then true
    when auth.uid() is not null and p_owner = auth.uid() then true
    when p_tier = 'members' then exists (
      select 1 from public.profiles
      where user_id = auth.uid() and coalesce(suspended, false) = false)
    when p_tier = 'friends' then
      public.is_admin()
      or (auth.uid() is not null and p_owner is not null
          and public.are_friends(auth.uid(), p_owner))
    when p_owner is null then public.is_admin()
    else false
  end;
$function$;


-- ----------------------------------------------------------------------------
-- 3b. Circuit people. The two mechanisms stay separate, as approved:
--       tier    -> can_see(owner, visibility)         "who in general"
--       sharing -> shared into a group you belong to  "who explicitly"
-- can_see already covers owner-is-me and the admin override, so the standalone
-- is_admin() and owner checks are folded in rather than dropped.
-- ----------------------------------------------------------------------------
create or replace function public.circuit_can_see_person(p_person text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
      select 1 from circuit_people cp
      where cp.id = p_person
        and public.can_see(cp.owner_user_id, cp.visibility))
    or exists (
      select 1 from circuit_person_groups pg
      join circuit_group_members gm on gm.group_id = pg.group_id
      where pg.person_id = p_person and gm.user_id = auth.uid());
$function$;

-- circuit_can_see_log delegates to the above and needs no change.


-- ----------------------------------------------------------------------------
-- 3c. Snake name reveal reads the handle's tier instead of hardcoding
-- friendship. Backfilled to 'friends', so members see exactly what they saw.
-- ----------------------------------------------------------------------------
create or replace function public.snake_friend_names()
returns table(player_name text, member_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.player_name::text,
         public.snake_display_name(r.user_id)
  from public.player_registry r
  where auth.uid() is not null
    and r.user_id is not null
    and public.can_see(r.user_id, r.visibility);
$function$;


-- ============================================================================
-- VERIFIED 2026-07-31 via simulated-JWT sessions (results inline)
-- ============================================================================
--
--  viewer            circuit_people visible
--  ----------------  ----------------------------------------------------
--  anon              permission denied on the table entirely; the public
--                    board only ever flows through circuit_public()
--  Evan (admin)      7 of 8 -- Josh, Evan, Cam, Shawn, Mills, Tin, Nat
--                    Colin's board is NO LONGER visible (see note below)
--  Josh (crew)       7 -- The Crew, plus Evan. Not Colin.
--  Mills (crew)      7 -- same
--  Mills, Snake      1 handle revealed (his own; he has no friendships)
--  anon,  Snake      permission denied on snake_friend_names
--
-- ⚠️ THE ONE REAL BEHAVIOUR CHANGE — Colin's board.
-- Evan is NOT a member of "No Bully" (Colin is its only member), yet Evan's own
-- board IS shared into it. That asymmetry predates this work: it is leftover
-- from the repair that linked person 2 into Colin's circuit. Until now Evan saw
-- Colin's board purely through the blanket admin override; with the override
-- stopping at 'private' he no longer does.
--
-- Three ways to resolve, Evan's call:
--   (a) accept it -- this is the approved design working as intended
--   (b) join the circuit properly:
--         insert into circuit_group_members (group_id, user_id, role)
--         values ('f66f8ef8-949e-4f4d-8cda-0d0766280dba',
--                 'e7f2eec5-f4cb-4b1b-bf94-09e4ec1751f7', 'member');
--       (this also fixes the asymmetry, since Colin can already see Evan)
--   (c) ask Colin to set his board to 'friends' -- Evan is admin, so the
--       override applies above 'private'
--
-- STILL READING is_public, to be flipped in step 5 when the column is dropped:
--   circuit_public()  -- the signed-out board. Verified unchanged: 1 person,
--                        71 movies, same as before this step.
--
-- ROLLBACK: restore circuit_can_see_person's is_admin() OR owner OR group form
-- and snake_friend_names' are_friends() form; both are in git history.
