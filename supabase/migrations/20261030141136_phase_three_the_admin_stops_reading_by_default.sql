-- ✅ APPLIED 30 Oct 2026 as `phase_three_the_admin_stops_reading_by_default`.
--
-- Phase 3 of docs/2026-10-30-one-visibility-ladder-plan.md. "Only me means no one else, owner
-- included" stops being a sentence and starts being true.
--
-- ⚠️ THE AUDIT FOUND A THIRD BYPASS AND IT WAS THE BIG ONE. The two named in the plan —
-- `can_see`'s friends branch and `movie_visible` — turned out to grant the admin **nothing at
-- all** today: he is friends with 12 of the 13 other members, the one exception has no
-- friends-tier rows, and all 163 films reach him through group membership anyway.
-- `circuit_is_member` is the one that was actually doing work: it began `public.is_admin() or`,
-- which made him a member of every circuit group, and it feeds 2 functions and **12 POLICIES**
-- (circuit_groups, circuit_group_members, circuit_movies ×4, circuit_person_groups ×2,
-- circuit_watchlist ×4, plus movie_visible and pool_item_visible). `grep is_admin` finds the
-- function; it does not find the twelve policies leaning on it.
--
-- ⚠️ MANAGEMENT KEEPS ITS BYPASSES, DELIBERATELY. `rename_circuit`, `delete_circuit` and
-- `circuit_can_edit_person` are still admin-capable, as are the finance and feature-flag
-- writers. What goes is READING other people's things as a side effect of who you are. The
-- distinction is the whole point of the phase: running the site is not the same as being
-- everybody's friend.
--
-- ⚠️ `is_suspended` AND `are_friends` KEEP THEIR ADMIN ANSWER, by decision: one bit each, and
-- moderation needs them. A moderation READ path is held until a real report needs one, rather
-- than built speculatively.
--
-- Measured as the admin, before -> after:
--   circuit_groups            3 -> 2     (the one group he is not in)
--   circuit_group_members    10 -> 9
--   circuit_movies          163 -> 163
--   circuit_watchlist         4 -> 4
--   circuit_people           10 -> 10
--   circuit_logs            710 -> 710
--   circuit_ratings         479 -> 479
--   Josh's profile blocks    20 -> 20
--
-- And for members, nothing at all: the 196-cell viewer × owner matrix is byte-identical to the
-- Phase 2 baseline (35acf6cf…, 539 blocks / 8,175 events / 130 trophies).
--
-- ⚠️ A CHANGE THAT MOVES TWO NUMBERS COULD ALSO BE A CHANGE THAT IS NOT WIRED, so it was made to
-- speak: with the admin's friendship with Josh deleted in a rolled-back transaction, Josh's
-- blocks fall from 20 to 19. Under the old bypass they would have stayed at 20. That one row is
-- the whole difference between being the owner and being a friend.

create or replace function public.can_see(p_owner uuid, p_tier public.visibility_tier)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  /* The tier this row is actually served at: what the owner asked for, cut to what the owner is
     allowed to choose. A row stored as 'public' before the ceiling existed must not keep being
     served as public while the rule waits for somebody to re-save it -- which is why the clamp
     lives on the READ side and not only on the write side.

     p_owner null keeps its old meaning untouched: there is no owner to have a ceiling, and the
     'is this an admin' branch below still decides it. */
  with t as (
    select case when p_owner is null then p_tier
                else least(p_tier, public.visibility_ceiling(p_owner))
           end as tier
  )
  select case
    when (select tier from t) = 'public' then true
    when auth.uid() is not null and p_owner = auth.uid() then true
    when (select tier from t) = 'members' then exists (
      select 1 from public.profiles
      where user_id = auth.uid() and coalesce(suspended, false) = false)
    /* ⚠️ NO `is_admin()` HERE ANY MORE (Phase 3). Being the site owner used to be a standing
       permission to read every friends-tier row on the site, which is the opposite of "Only me
       means no one else, owner included". Moderation gets a named path when a real report needs
       one; until then reading somebody's private things is not a side effect of who you are. */
    when (select tier from t) = 'friends' then
      auth.uid() is not null and p_owner is not null
      and public.are_friends(auth.uid(), p_owner)
    /* 'certain' is narrower than 'friends' and has no circles wired to it yet, so it reaches
       nobody but the owner -- who is already answered by the branch above. Phase 5 gives it its
       own branch; until then the safe reading of an unwired level is "no". */
    when p_owner is null then public.is_admin()
    else false
  end;
$function$;

create or replace function public.movie_visible(p_movie text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.circuit_movies m
    where m.id = p_movie
      and (
        public.circuit_is_member(m.group_id)
        or exists (
          select 1 from public.circuit_ratings r
          where r.movie_id = m.id
            and (r.user_id = auth.uid() or public.are_friends(auth.uid(), r.user_id)))
        /* ⚠️ the `or public.is_admin()` that used to sit here is gone -- Phase 3. */
      )
  );
$function$;

create or replace function public.circuit_is_member(p_group uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  /* ⚠️ THE WIDEST OF THE THREE BYPASSES, AND THE ONE NOBODY NAMED. This used to begin
     `public.is_admin() or`, which made the site owner a member of every circuit group -- and it
     feeds 2 functions and 12 POLICIES (circuit_groups, circuit_group_members, circuit_movies
     select/insert/update/delete, circuit_person_groups, circuit_watchlist select/insert/update/
     delete, plus movie_visible and pool_item_visible). Grepping for `is_admin` finds this
     function; it does not find the twelve policies that lean on it.

     Group MANAGEMENT keeps its own bypasses, deliberately: rename_circuit, delete_circuit and
     circuit_can_edit_person are still admin-capable. What goes is reading and editing the
     contents of a group you are not in. */
  select exists (
    select 1 from circuit_group_members gm
    where gm.group_id = p_group and gm.user_id = auth.uid());
$function$;
