-- 2026-09-11 — one profile anybody can look at, without opening the door to the rest
--
--
-- WHAT THIS IS FOR
--
-- "Show off my profile page as a demo/real link that listens to my viewer profile settings — not
-- to expose my friends and family's profiles/information."
--
-- Every profile rpc today is granted to `authenticated` and nothing else, so a signed-out visitor
-- cannot read a profile at all. That is the right default and it stays exactly as it is. This
-- adds ONE anonymous read, deliberately shaped so it cannot become a second one.
--
--
-- ⚠️ THE FUNCTION TAKES NO ARGUMENTS, AND THAT IS THE WHOLE SAFETY ARGUMENT.
--
-- The obvious version of this feature is get_public_profile(p_username text) granted to anon,
-- and it is the wrong shape: the moment a username is a parameter, an anonymous caller can walk
-- the whole members table by guessing names, and every profile's public tier is readable by
-- anyone who can type. Taking no parameter means there is nothing to point at. The server picks
-- the profile, the caller cannot.
--
-- ⚠️ AND ONLY A PROFILE THAT ASKED TO BE ONE. It serves the row flagged is_demo and nothing else,
-- so being the demo is a thing you switch on for yourself rather than a property of being
-- popular or first in the table. Nobody is opted in by default and nobody else can be reached
-- through this even if the flag is set on several rows — it returns one.
--
-- ⚠️ PUBLIC BLOCKS ONLY. The real page asks can_see(target, visibility), which answers for a
-- signed-in viewer with a relationship. A stranger has no relationship, so the honest equivalent
-- is the public tier and only the public tier. A block set to friends, members or private is not
-- in the payload at all — not hidden in the UI, not present.
--
-- ⚠️ A NAMED FIELD LIST, never select *. A column added to profiles later — a phone number, an
-- address, anything — must not appear in an anonymous payload because somebody forgot this
-- function existed. Adding a field here has to be a decision.

alter table public.profiles add column if not exists is_demo boolean not null default false;

/* ⚠️ At most one, enforced by the database rather than by remembering: two demo rows would make
   which one a visitor sees depend on the planner. */
create unique index if not exists ux_profiles_one_demo
  on public.profiles ((true)) where is_demo;

create or replace function public.get_demo_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid;
  v_name text;
  v_first text;
  v_since text;
begin
  select p.user_id, p.username::text, p.first_name, to_char(p.created_at, 'YYYY-MM-DD')
    into v_user, v_name, v_first, v_since
    from public.profiles p
   where p.is_demo
     and coalesce(p.suspended, false) = false
   limit 1;

  -- nobody has volunteered: the app shows its ordinary signed-out page
  if v_user is null then
    return null;
  end if;

  return jsonb_build_object(
    'username', v_name,
    'first_name', v_first,
    'member_since', v_since,
    'is_me', false,
    'friend_status', null,
    'shared_circuits', '[]'::jsonb,
    'movies_rated', (
      select count(*) from public.circuit_ratings r where r.user_id = v_user
    ),
    'snake_best', (
      select jsonb_build_object('score', l.score, 'game_mode', l.game_mode,
                                'achieved', to_char(l.created_at, 'YYYY-MM-DD'))
        from public.leaderboard l
        join public.player_registry reg on reg.id = l.player_id
       where reg.user_id = v_user
       order by l.score desc
       limit 1
    ),
    'activity_visibility', 'private',
    /* the columns are look_theme / look_palette / look_flair / look_backdrop — checked against
       get_member_profile rather than guessed, because a wrong name here is a function that
       creates cleanly and fails on the first visitor */
    'look', (
      select jsonb_build_object('theme', pl.look_theme, 'palette', pl.look_palette,
                                'flair', pl.look_flair, 'backdrop', pl.look_backdrop)
        from public.profiles pl where pl.user_id = v_user
    ),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'block_type', b.block_type, 'position', b.position,
               'size', b.size, 'config', b.config, 'visibility', b.visibility
             ) order by b.position)
        from public.profile_blocks b
       where b.user_id = v_user
         and b.visibility = 'public'
    ), '[]'::jsonb)
  );
end
$function$;

-- ⚠️ anon AND authenticated: a signed-in visitor following the same link should see the same
-- page, or the demo would be a different site from the one it is demonstrating.
revoke all on function public.get_demo_profile() from public;
grant execute on function public.get_demo_profile() to anon, authenticated;


-- ── TURNING IT ON ───────────────────────────────────────────────────────────────────────────
-- Nothing is public until this runs, and it is one row:
--
--   update public.profiles set is_demo = true where lower(username) = lower('evan');
--
-- To take it down again:
--
--   update public.profiles set is_demo = false;
--
--
-- ── HOW TO CHECK IT ─────────────────────────────────────────────────────────────────────────
-- What a stranger would receive, and nothing else:
--
--   select jsonb_pretty(public.get_demo_profile());
--
-- ⚠️ Read the `blocks` array in that output before sharing the link. Every block in it is one
-- you marked public, but "public" was a setting made when only members could see the page at
-- all — this is the first time it means the open internet, so it is worth looking at with that
-- in mind rather than trusting the label.
--
-- Nobody else is reachable — there is no argument to pass:
--
--   select count(*) from public.profiles where is_demo;   -- expect 0 or 1
