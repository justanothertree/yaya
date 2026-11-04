-- ✅ APPLIED 4 Nov 2026 as `admin_sees_who_has_no_age_band`.
--
-- A member whose `age_band` is null is excluded from BOTH feed tabs, because `feed_may_show` is
-- `owner = auth.uid() or age_band = 'adult' or feed_opt_in`. That is the right default and it
-- fails silently: the member sees their own posts in their own feed, so nothing on their screen
-- says they are invisible to everybody else, and nothing on the admin's screen said it either.
-- New signups start at null on purpose, so this is the state every new member arrives in.
--
-- This adds the one thing that was missing: a way for the admin to SEE it. No rule changes.
-- `visibility_ceiling`, `feed_may_show` and the guardian opt-in are untouched by this migration.
--
-- ⚠️ IT READS THE MEMBER SOURCE `feed_recent` WALKS, NOT A LIST OF ITS OWN. `feed_recent` loops
-- `from public.profiles p where coalesce(p.suspended, false) = false`, so this does too. A
-- notice built on `user_roles` instead would have missed @evan, whose profile has no role row;
-- one that ignored `suspended` would name somebody whose posts are hidden for a reason the admin
-- already chose and can see. Asking the same question as the feed is what keeps the two honest.
--
-- ⚠️ COUNT AND HANDLE, AND NOTHING ELSE. The answer is `{count, handles}` — no names, no email,
-- no ids, no age values. The admin needs to know WHO to ask about an age, which is a handle; the
-- rest would be personal data travelling for no reason. The id is deliberately absent even
-- though the panel would find a link easier with one.
--
-- ⚠️ AND THE REFUSALS ARE TWO, NOT ONE. `anon` is revoked, so the privilege check refuses it
-- before any code runs — `permission denied for function`. A signed-in non-admin passes that and
-- meets `is_admin()` in the body — `admin only`. Measured, both, with a seeded unknown-age
-- member so the admin's own answer was non-empty at the same time:
--   admin   {"count": 1, "handles": ["<the seeded member>"]}
--   member  refused: admin only
--   anon    refused: permission denied for function admin_members_without_age_band
-- Both are asserted from here on by block M of supabase/tests/visibility-guards.sql.
--
-- ⚠️ THE COLUMN GRANT LOOKS LIKE A HOLE AND IS NOT, which is worth writing down because the
-- first reading of it is alarming: `authenticated` really does hold SELECT on
-- `profiles.age_band` and `profiles.feed_opt_in`. What makes that inert is the row policy —
-- `profiles_select` is self-only, measured as a member: **1 row** of `profiles` visible, their
-- own, so there is no way to enumerate anybody else's age band off the table. Block M asserts
-- that too, because it is the half that makes "non-admins get nothing" a fact about the DATA
-- rather than about this one function.
--
-- Setting an age still goes through `admin_set_feed_consent`, which already existed and already
-- refuses non-admins. Nothing here writes.

create or replace function public.admin_members_without_age_band()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_handles jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;

  /* the same member source `feed_recent` walks, so the notice cannot name somebody the feed
     was never going to consider, nor miss somebody it was */
  select coalesce(jsonb_agg(p.username::text order by p.username), '[]'::jsonb)
    into v_handles
    from public.profiles p
   where p.age_band is null
     and coalesce(p.suspended, false) = false;

  return jsonb_build_object('count', jsonb_array_length(v_handles), 'handles', v_handles);
end $$;

revoke all on function public.admin_members_without_age_band() from public, anon;
grant execute on function public.admin_members_without_age_band() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_members_without_age_band()', 'execute') then
    raise exception 'anon can still execute admin_members_without_age_band';
  end if;
  if not has_function_privilege('authenticated',
       'public.admin_members_without_age_band()', 'execute') then
    raise exception 'authenticated cannot execute admin_members_without_age_band';
  end if;
end $$;
