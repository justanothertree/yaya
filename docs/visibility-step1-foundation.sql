-- ============================================================================
-- Visibility tiers — STEP 1 of 5: the foundation.
-- Design + decisions: docs/visibility-tiers-design.md
--
-- Purely additive. Creates the type, the one shared predicate, and three
-- columns. NOTHING reads the columns yet and no policy changes, so applying
-- this cannot alter what anyone currently sees.
--
-- Next: step 2 backfills existing rows so today's exposure carries over.
-- ============================================================================

create type public.visibility_tier as enum ('private', 'friends', 'members', 'public');

comment on type public.visibility_tier is
  'Who may see a row. Ordered least to most open. Circuit group sharing is a '
  'SEPARATE mechanism layered on top of this -- see docs/visibility-tiers-design.md.';


-- ----------------------------------------------------------------------------
-- The single predicate every policy will call.
--
-- Branch order matters; each line encodes an approved decision:
--   1. 'public' is public no matter who owns it (keeps the signed-out board working)
--   2. you always see your own rows
--   3. an OWNERLESS row has no member's privacy to protect, so the admin
--      caretakes it -- this is what keeps unclaimed circuit boards reachable
--   4. admin override applies at friends/members/public but STOPS at 'private'
--   5. 'members' = any signed-in, unsuspended account
--   6. 'friends' = literal accepted friendship, not friends-of-crewmates
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
    when p_owner is null then public.is_admin()
    when public.is_admin() and p_tier <> 'private' then true
    when p_tier = 'members' then exists (
      select 1 from public.profiles
      where user_id = auth.uid() and coalesce(suspended, false) = false)
    when p_tier = 'friends' then
      auth.uid() is not null and public.are_friends(auth.uid(), p_owner)
    else false
  end;
$function$;

comment on function public.can_see(uuid, public.visibility_tier) is
  'The one place the visibility rule lives. Admin override deliberately stops at '
  '''private'' for rows owned by another member, so private means private in the app. '
  'Evan retains full access via the dashboard regardless -- he owns the tables and '
  'the service role bypasses RLS, so this is about the website, not capability.';

-- anon needs EXECUTE so 'public'-tier rows still resolve inside policies.
-- Revoke first: a GRANT does not imply a REVOKE, and PUBLIC gets EXECUTE by default.
revoke all on function public.can_see(uuid, public.visibility_tier) from public;
grant execute on function public.can_see(uuid, public.visibility_tier) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- The three columns. Everything lands on 'private'; step 2 corrects existing
-- rows to whatever they are already exposed as today.
-- ----------------------------------------------------------------------------
alter table public.circuit_people
  add column if not exists visibility public.visibility_tier not null default 'private';

comment on column public.circuit_people.visibility is
  'Replaces is_public. is_public is left in place until the client stops reading it (step 5).';

alter table public.chat_rooms
  add column if not exists visibility public.visibility_tier not null default 'private';

comment on column public.chat_rooms.visibility is
  'Replaces the hardcoded per-kind logic inside chat_room_member().';

alter table public.player_registry
  add column if not exists visibility public.visibility_tier not null default 'private';

comment on column public.player_registry.visibility is
  'Who may learn which account owns a Snake handle. The tier lives on the HANDLE, not '
  'the score: score_history/leaderboard/trophies have no user_id at all.';


-- ============================================================================
-- VERIFY
-- ============================================================================

-- 1. Predicate behaves as designed for anon (no session): only 'public' passes.
select p_tier,
       public.can_see('00000000-0000-0000-0000-000000000001'::uuid, p_tier) as anon_sees
from unnest(enum_range(null::public.visibility_tier)) as p_tier;
-- expected: private=f, friends=f, members=f, public=t

-- 2. Columns exist and every row starts private.
select 'circuit_people' as t, visibility, count(*) from public.circuit_people group by 2
union all select 'chat_rooms', visibility, count(*) from public.chat_rooms group by 2
union all select 'player_registry', visibility, count(*) from public.player_registry group by 2
order by 1, 2;

-- 3. Nothing enforces it yet. NOTE: match the word boundary -- a plain '%can_see%'
--    also hits the legacy circuit_can_see_person / circuit_can_see_log helpers and
--    reports 6 false positives.
select count(*) as policies_using_new_predicate
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(^|[^_a-z])can_see\(';
-- expected: 0

-- ROLLBACK:
--   alter table public.circuit_people   drop column visibility;
--   alter table public.chat_rooms       drop column visibility;
--   alter table public.player_registry  drop column visibility;
--   drop function public.can_see(uuid, public.visibility_tier);
--   drop type public.visibility_tier;
