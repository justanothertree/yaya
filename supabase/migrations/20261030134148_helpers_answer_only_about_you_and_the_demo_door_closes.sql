-- ✅ APPLIED 30 Oct 2026 as `helpers_answer_only_about_you_and_the_demo_door_closes`.
--
-- Three holes, reported after 7146101 and all three real.
--
-- ⚠️ I CALLED `get_demo_profile` FABRICATED DATA IN THE LAST MIGRATION AND IT IS NOT. It serves a
-- REAL member's page to anonymous visitors — whichever row carries `is_demo` — and it skipped
-- `public_page`, skipped `may_publish_a_page`, and compared `b.visibility = 'public'` instead of
-- clamping. So the one door explicitly exempted from Phase 2 was a door onto somebody's actual
-- profile. That was an assertion made without reading the function, which is exactly the thing
-- §2 is about; the correction is that it now meets every condition `get_public_profile` meets.
--
-- `is_demo` is additionally pinned to the admin's row by a trigger, so it cannot start serving
-- somebody else's page. Nothing in the database wrote that column — it is set by hand — and the
-- trigger means a future hand cannot point it anywhere.
--
-- ⚠️ A BLIND REVOKE OF `is_suspended` AND `are_friends` WOULD HAVE TAKEN THE CIRCUIT OFFLINE FOR
-- EVERY MEMBER, and only measuring showed it. RLS policy expressions are evaluated with the
-- CALLER's privileges, so a function used inside a policy needs the caller to hold EXECUTE. Nine
-- restrictive policies call `is_suspended` and one calls `are_friends`. Tried in a rolled-back
-- transaction: after the revoke, a member reading `circuit_logs` got
-- `permission denied for function is_suspended`, and so did reading `circuit_movies` and
-- inserting a comment.
--
-- So these two are guarded instead of revoked: they answer when the CALLER is one of the people
-- being asked about, or to an admin, and return NULL otherwise. NULL rather than an exception
-- precisely because they sit inside policies — a policy that throws is a broken page rather than
-- a closed door — and NULL denies wherever it is used while carrying no information. Every call
-- site in the database was checked first: all fourteen pass `auth.uid()` or a variable assigned
-- from it.
--
-- `feed_may_show` is in no policy and is only called by `feed_recent` (SECURITY DEFINER), so it
-- gets the plain revoke that `visibility_ceiling` got.
--
-- ⚠️ THE WATCHLIST WAS NEVER FILTERED AT ALL, AND THE CODE COMMENT CLAIMED IT WAS.
-- `src/circuit/publicData.ts` says "movies/watchlist now come from the board too (ratings/votes
-- filtered to public people)" — the movies are; the watchlist select had no WHERE clause beyond
-- the table name. Every row of it went to every signed-out visitor: four nominations belonging to
-- private groups of 8 and 2 people, titled with members' first names. They are not public: a
-- watchlist row has no visibility of its own, it belongs to a group and a pool. It now earns the
-- public board by the same rule the movies use — a PUBLIC person took part. Today that is none
-- of them, so the signed-out board's watchlist is empty, which is the true answer.
--
-- Verified after: a member can still read circuit_logs, circuit_movies, circuit_people and pools;
-- `is_suspended(self)` answers and `is_suspended(someone else)` is NULL; the same for
-- `are_friends`; `feed_may_show` is refused while `feed_recent` still returns its 18 events;
-- `is_demo` cannot be given to a non-admin; the demo page still loads with its 7 blocks; and
-- `circuit_public` went 43,564 -> 43,181 bytes as the four watchlist rows left.

create or replace function public.is_suspended(p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_user_id is null then false
    when p_user_id = auth.uid() or public.is_admin()
      then coalesce((select suspended from public.profiles where user_id = p_user_id), false)
    else null
  end;
$function$;

create or replace function public.are_friends(u1 uuid, u2 uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when u1 is null or u2 is null then false
    when auth.uid() in (u1, u2) or public.is_admin()
      then exists (select 1 from public.friendships f
                    where f.user_a = least(u1, u2) and f.user_b = greatest(u1, u2)
                      and f.status = 'accepted')
    else null
  end;
$function$;

comment on function public.is_suspended(uuid) is
  'Whether this account is suspended. ANSWERS ONLY ABOUT THE CALLER (or to an admin); any other question returns NULL, which carries no information and denies wherever it is used. NULL rather than an exception on purpose: this is evaluated inside 9 restrictive RLS policies, and a policy that throws is a broken page rather than a closed door.';
comment on function public.are_friends(uuid, uuid) is
  'Whether two accounts are friends. ANSWERS ONLY WHEN THE CALLER IS ONE OF THEM (or is an admin); any other pairing returns NULL. Every call site in this database passes auth.uid() or a variable set from it, checked before this guard was added.';

revoke execute on function public.feed_may_show(uuid) from authenticated;

create or replace function public.only_the_admin_demos()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.is_demo and not exists (select 1 from public.admin_users a where a.user_id = new.user_id) then
    raise exception 'is_demo is the site owner''s row only';
  end if;
  return new;
end $function$;

drop trigger if exists profiles_only_the_admin_demos on public.profiles;
create trigger profiles_only_the_admin_demos
  before insert or update of is_demo, user_id on public.profiles
  for each row execute function public.only_the_admin_demos();

create unique index if not exists profiles_one_demo_row on public.profiles (is_demo) where is_demo;

create or replace function public.get_demo_profile()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid;
  v_name text;
  v_first text;
  v_since text;
begin
  /* ⚠️ THE SAME CHECKS AS get_public_profile, WHICH THIS USED TO SKIP ENTIRELY. This serves a
     REAL member's page to anonymous visitors -- it is not fabricated data -- so it has to meet
     every condition the ordinary public door meets: the owner has published a page, the owner is
     still allowed to publish one, and each block is clamped to the owner's ceiling rather than
     served at the level it was once given. `is_demo` is additionally pinned to the admin's row
     by a trigger, so this cannot start serving somebody else's page. */
  select p.user_id, p.username::text, p.first_name, to_char(p.created_at, 'YYYY-MM-DD')
    into v_user, v_name, v_first, v_since
    from public.profiles p
   where p.is_demo
     and p.public_page
     and public.may_publish_a_page(p.user_id)
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
    /* the layout its owner chose. Deliberately NOT inside `look`: a visitor may switch a
       look off, and the arrangement of the page is not a skin offered to them. */
    'page', (select pl.page_style from public.profiles pl where pl.user_id = v_user),
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
         and least(b.visibility, public.visibility_ceiling(b.user_id)) = 'public'
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.circuit_public()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  /* ⚠️ `visibility = 'public'` became a clamp here too -- this is the signed-out Circuit board,
     so a person marked public by somebody who may no longer choose public would otherwise keep
     their name, their workouts and their ratings on the open web. */
  with pub as (
    select id, owner_user_id from circuit_people
     where least(visibility, public.visibility_ceiling(owner_user_id)) = 'public'
  )
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'color', p.color, 'goal', p.goal,
        'exercises', p.exercises, 'colLabels', p.col_labels) order by p.name)
      from circuit_people p where p.id in (select id from pub)), '[]'::jsonb),

    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'personId', l.person_id, 'date', l.date, 'entries', l.entries, 'img', l.img))
      from circuit_logs l where l.person_id in (select id from pub)), '[]'::jsonb),

    'movies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'kind', m.kind, 'date', m.date, 'rt', m.rt,
        'ratings',
          -- the legacy blob, filtered to public people …
          coalesce((
            select jsonb_object_agg(k, m.ratings->k)
            from jsonb_object_keys(m.ratings) k
            where k in (select id from pub)), '{}'::jsonb)
          ||
          -- … with today's rows laid over it, mapped from account back to person id
          coalesce((
            select jsonb_object_agg(p.id, jsonb_build_object('score', r.score))
            from circuit_ratings r
            join pub p on p.owner_user_id = r.user_id
            where r.movie_id = m.id), '{}'::jsonb)
      ))
      from circuit_movies m
      where exists (
              select 1 from jsonb_object_keys(m.ratings) k where k in (select id from pub))
         or exists (
              select 1 from circuit_ratings r
              join pub p on p.owner_user_id = r.user_id
              where r.movie_id = m.id)
    ), '[]'::jsonb),

    /* ⚠️ FILTERED, WHICH IT NEVER WAS. This sent EVERY watchlist row to every signed-out
       visitor -- nominations belonging to private groups, titled with members' names. A
       watchlist row has no visibility of its own; it belongs to a group and a pool. So it
       earns a place on the public board by the same rule the movies above use: a PUBLIC
       person took part in it. Anything else is other people's business. */
    'watchlist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'kind', w.kind, 'rt', w.rt))
      from circuit_watchlist w
      where exists (select 1 from public.pool_votes v
                     join pub p on p.owner_user_id = v.user_id
                    where v.item_id = w.id)
    ), '[]'::jsonb)
  );
$function$;
