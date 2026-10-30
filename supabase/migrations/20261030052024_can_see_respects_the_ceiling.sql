-- ✅ APPLIED 30 Oct 2026 as `can_see_respects_the_ceiling`.
--
-- Phase 2, first half: the ladder's ceiling is applied when a row is READ.
--
-- ⚠️ ON READ, NOT ONLY ON WRITE, AND THAT IS THE POINT. Ten rows on this site are stored as
-- `public` by people who, under the new rule, may not choose public. Clamping only when somebody
-- next presses Save would leave every one of them being served at the old level indefinitely,
-- and would make the rule depend on an action nobody has any reason to take.
--
-- ⚠️ `p_owner is null` KEEPS ITS OLD MEANING EXACTLY. There is no owner to have a ceiling, so no
-- clamp is applied and the `is_admin()` branch still decides it. The original function answered
-- `true` for a null owner at the `public` tier, and reordering the cases would have changed that
-- quietly — so the clamp was added around the tier rather than by rewriting the branches.
--
-- ⚠️ `certain` REACHES NOBODY YET. It is narrower than `friends`, has no circles wired to it, and
-- falls through to `false`. The owner still sees their own rows via the branch above, so an
-- unwired level is safe rather than destructive — the safe reading of "I do not know who this is
-- for" is "nobody".
--
-- ⚠️ MEASURED AS A NO-OP BETWEEN MEMBERS, AND PREDICTED TO BE ONE BEFORE IT RAN. Every member can
-- already see `members`-tier content, so clamping `public` down to `members` cannot change what
-- one member sees of another. The 14 × 14 matrix — profile blocks, activity and trophies for
-- every viewer against every owner, 196 cells — hashes identically before and after:
-- 35acf6cf835765ff7c914b00e7a3c935, 539 blocks / 8,175 events / 130 trophies.
--
-- ⚠️ AND A NO-OP EVERYWHERE WOULD HAVE BEEN A CLAMP THAT WAS NOT WIRED. The real narrowing lands
-- on signed-out visitors, and `can_see` turned out NOT to govern them — see the migration that
-- follows this one, which is where this phase actually bit.

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
    when (select tier from t) = 'friends' then
      public.is_admin()
      or (auth.uid() is not null and p_owner is not null
          and public.are_friends(auth.uid(), p_owner))
    /* 'certain' is narrower than 'friends' and has no circles wired to it yet, so it reaches
       nobody but the owner -- who is already answered by the branch above. Phase 5 gives it its
       own branch; until then the safe reading of an unwired level is "no". */
    when p_owner is null then public.is_admin()
    else false
  end;
$function$;
