-- ✅ APPLIED 30 Oct 2026 as `profile_trophies_attach_by_user_id`.
--
-- The same fix `snake_events_attach_by_user_id` made to the feed, in the place it was missed.
--
-- ⚠️ ONE FIX, TWO CALLERS, AND ONLY ONE WAS LOOKED AT. `get_member_activity` and
-- `get_member_trophies` each carried
--   `or lower(lb.player_name) in (lower(v_username), lower(v_first))`
-- and fixing the feed left the profile's own trophy block still attributing by handle. Asking the
-- database which functions match on a name — rather than fixing the one in front of me — would
-- have found it in one query. The query is three lines and is worth keeping:
--
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--     and pg_get_functiondef(p.oid) ~* 'lower\s*\(\s*\w*\.?player_name\s*\)\s*in';
--
-- ⚠️ IT HAS A FALSE POSITIVE AND THE FALSE POSITIVE IS THE FIXED FUNCTION. `pg_get_functiondef`
-- returns comments, and `get_member_activity` now quotes the old clause in a comment explaining
-- why it went. So the grep flags it for ever. A behavioural check settles what a text search
-- cannot: the planted-impostor test below is what actually proves which code is live.
--
-- ⚠️ MEASURED NO-OP, THEN MEASURED LOAD-BEARING. `get_member_trophies` hashed for all 14 members
-- before and after: **14/14 identical, 10 trophies both times**. Then the hole, staged in a
-- rolled-back transaction — Salty's first name is "Nik" and no registry entry claims it, so an
-- "Impostor Cup" was awarded to an unclaimed handle spelled that way: planted 1, the old clause
-- would have claimed it for Salty (1), this function shows 0, and his 2 real trophies are
-- untouched.
--
-- `lb.player_name` is still RETURNED as `handle`, because what a trophy was won under is worth
-- showing. It is just not how the trophy is attributed.

create or replace function public.get_member_trophies(p_username text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_viewer uuid := auth.uid(); v_target uuid; v_username text; v_first text;
  v_tier public.visibility_tier;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;
  select p.user_id, p.username::text, p.first_name, p.activity_visibility
    into v_target, v_username, v_first, v_tier
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null or not public.can_see(v_target, v_tier) then return '[]'::jsonb; end if;

  /* ⚠️ BY USER ID, NEVER BY NAME -- the same fix the feed got, in the place it was missed.
     This used to carry `or lower(lb.player_name) in (lower(v_username), lower(v_first))`, so a
     trophy appeared on a member's profile because the handle on the leaderboard row matched
     their username or first name. The leaderboard is open and `player_registry` holds 128 names
     of which only 19 belong to a member, so the handle is not evidence of who somebody is.
     `claim_my_reserved_snake_name` links a reserved handle to its owner, which is what the id
     is for. `lb.player_name` is still RETURNED as `handle`, because what a trophy was won under
     is worth showing -- it is just not how the trophy is attributed. */
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'trophy_name', tr.trophy_name,
             'at', tr.awarded_at,
             'handle', lb.player_name,
             'game_mode', lb.game_mode
           ) order by tr.awarded_at desc)
    from public.trophies tr
    join public.leaderboard lb on lb.id = tr.leaderboard_id
    join public.player_registry r on r.id = lb.player_id
    where r.user_id = v_target
  ), '[]'::jsonb);
end;
$function$;
