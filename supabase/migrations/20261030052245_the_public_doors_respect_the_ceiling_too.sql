-- ✅ APPLIED 30 Oct 2026 as `the_public_doors_respect_the_ceiling_too`.
--
-- Phase 2, second half — and the half that actually does anything.
--
-- ⚠️ TEACHING `can_see` THE CEILING DID NOT REACH THE OPEN WEB, AND THE CHECK THAT FOUND THAT
-- WAS A DELIBERATE ONE. After the first half, Josh's page was published in a rolled-back
-- transaction and his ceiling toggled between `members` and `public`: anon saw his **3 blocks in
-- all three states**. The clamp was not wired to the door it was written for. Nothing downstream
-- would have contradicted it — the matrix was identical, the anon hash was identical, and every
-- number said the phase was a clean no-op.
--
-- The cause is that the public doors never call `can_see`. They compare the stored tier
-- themselves: `b.visibility = 'public'`, `p.activity_visibility = 'public'`,
-- `where visibility = 'public'`. That is "count the write paths" asked of READS — a tier has more
-- than one reader, and the one that matters most here is the one serving people who are not
-- signed in.
--
-- Asked of the whole catalogue, ten functions compare a tier to a literal and **four are
-- anon-callable**: these three, plus `get_demo_profile`, which is fabricated data and has no
-- owner to have a ceiling.
--
-- ⚠️ `may_publish_a_page` IS ENFORCED HERE TOO, for the same reason and on the same side. A page
-- published before the rule existed should not keep being served. It is a no-op today — only
-- evan has `public_page`, and he is the admin — but it is the half of the rule that lives on the
-- read side, and it is why the re-run of the Josh test now refuses the page outright rather than
-- merely emptying it.
--
-- Measured, same perturbation as before:
--   Josh adult, ceiling members    page refused
--   Josh ceiling raised to public  page loads, 3 blocks
--   ceiling back to members        page refused
--
-- ⚠️ AND THE REAL SITE CHANGED BY EXACTLY ONE THING, as §3 of the plan predicted. The anonymous
-- profile surface is byte-identical (f11cd4ffb10b9829f32be7805a0b3ffe, 1 page loadable).
-- `circuit_public` went from **44,221 to 43,564 bytes**: jefelegendary's circuit person is stored
-- `public` and his ceiling is `members`, so he leaves the signed-out board. Evan's person stays,
-- with all 255 of its logs. Jefe's person has 0 logs, so the 657 bytes are the person record and
-- its ratings. Evan is telling him himself.

create or replace function public.get_public_profile(p_username text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user  uuid;
  v_name  text;
  v_first text;
  v_since text;
begin
  /* ⚠️ ONE LOOKUP, and every way of failing it leaves v_user null and returns the same thing.
     No separate "no such member" branch, because the difference between "not here" and "here
     but not public" is precisely what an anonymous caller must not be able to measure. */
  if p_username is null or length(p_username) > 64 then
    return null;
  end if;

  select p.user_id, p.username::text, p.first_name, to_char(p.created_at, 'YYYY-MM-DD')
    into v_user, v_name, v_first, v_since
    from public.profiles p
   where lower(p.username::text) = lower(p_username)
     and p.public_page
     and public.may_publish_a_page(p.user_id)
     and coalesce(p.suspended, false) = false
   limit 1;

  if v_user is null then
    return null;
  end if;

  return jsonb_build_object(
    'username', v_name,
    'first_name', v_first,
    'member_since', v_since,
    'is_me', false,
    /* a stranger has no relationship, and saying so is not the same as leaving it out */
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
    /* ⚠️ 'private', exactly as the demo reports it, and NOT the owner's real setting.
       Activity is a separate feed with its own gate (get_member_activity, which already returns
       a stranger the items without the circuit NAME — see 2026-08-21-member-activity-detail).
       Wiring it to an anonymous caller is a second decision and gets its own migration; until
       then this says the true thing about what THIS payload carries, which is no activity. */
    'activity_visibility', 'private',
    /* the layout its owner chose. Deliberately NOT inside `look`: a visitor may switch a
       look off, and the arrangement of the page is not a skin offered to them. */
    'page', (select pl.page_style from public.profiles pl where pl.user_id = v_user),
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
         /* ⚠️ CLAMPED, NOT COMPARED. `b.visibility = 'public'` served a row at the level its
            owner once chose, regardless of whether they may still choose it -- and this is the
            one door that opens onto the open web, so it is the door where that matters most.
            can_see() was taught the ceiling first and does not help here: this function never
            calls it. */
         and least(b.visibility, public.visibility_ceiling(b.user_id)) = 'public'
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.get_public_activity(p_username text, p_limit integer DEFAULT 20)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ok boolean;
begin
  if p_username is null or length(p_username) > 64 then return '[]'::jsonb; end if;

  select true into v_ok
    from public.profiles p
   where lower(p.username::text) = lower(p_username)
     and p.public_page
     and public.may_publish_a_page(p.user_id)
     /* clamped for the same reason as the blocks above */
     and least(p.activity_visibility, public.visibility_ceiling(p.user_id)) = 'public'
     and coalesce(p.suspended, false) = false
   limit 1;

  if v_ok is not true then return '[]'::jsonb; end if;

  return public.get_member_activity(p_username, least(greatest(coalesce(p_limit, 20), 1), 50));
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

    'watchlist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'kind', w.kind, 'rt', w.rt))
      from circuit_watchlist w
    ), '[]'::jsonb)
  );
$function$;
