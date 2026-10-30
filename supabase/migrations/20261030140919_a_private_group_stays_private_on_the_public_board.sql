-- ✅ APPLIED 30 Oct 2026 as `a_private_group_stays_private_on_the_public_board`.
--
-- ⚠️ ONE MEMBER OPTING IN WAS PUBLISHING SEVEN OTHER PEOPLE'S CATALOGUE. The previous migration
-- filtered the signed-out board's films and watchlist by "a PUBLIC person rated or voted on it",
-- which sounds careful and is the wrong unit. A film row belongs to a GROUP, not to whoever
-- happened to touch it. The Crew is eight people; exactly one of them is public; all 163 of its
-- films were reaching the open web because of him.
--
-- So the rule moves up a level: the whole group must be public, meaning it has people and EVERY
-- one of them is public. `circuit_group_is_public` is that question, once.
--
-- ⚠️ IT IS A RULE THAT CAN BECOME TRUE, which is why it is not simply "no films on the board".
-- There is no group-level visibility column to set, so the only honest way for a group to be
-- shown is for everybody in it to have chosen to be. Proved in a rolled-back transaction:
--
--   as it is now                   0 films,   0 watchlist,  1 person
--   The Crew made entirely public  163 films, 2 watchlist,  8 people
--   one member back to private     0 films,   0 watchlist,  7 people
--
-- One private member keeps the whole group's board off the open web, which is the point.
--
-- ⚠️ THE FIRST ATTEMPT AT THAT PROOF REPORTED 0 IN BOTH STATES AND THE FUNCTION WAS FINE. The
-- Crew contains "Nat", a person with NO ACCOUNT — `owner_user_id` is null — and
-- `visibility_ceiling(null)` is `private`, so the group could never be all-public however many
-- rows I set to public. The fixture was incomplete, not the rule. Worth knowing in its own
-- right: an ownerless circuit person can no longer be public, because there is no owner to hold
-- a ceiling. No live row is affected (both public people have accounts), but it is a real
-- consequence of the Phase 2 clamp and this is where somebody will meet it.
--
-- Live effect: the signed-out board goes from 43,181 to 32,465 bytes — 1 person, 255 logs, and
-- no films or watchlist at all. The bundled `publicSeed` is NOT a fallback here: the client reads
-- `slice.movies ?? publicSeed.movies`, and an empty array is not nullish, so a visitor now sees
-- an empty film board. That is the true answer to "what may a stranger see", and making it a
-- fuller one is a product decision — give a group somewhere to say it is public — rather than
-- something to quietly restore.

create or replace function public.circuit_group_is_public(p_group uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_group is not null
     and exists (select 1 from public.circuit_person_groups cpg where cpg.group_id = p_group)
     and not exists (
       select 1
         from public.circuit_person_groups cpg
         join public.circuit_people cp on cp.id = cpg.person_id
        where cpg.group_id = p_group
          and least(cp.visibility, public.visibility_ceiling(cp.owner_user_id)) is distinct from 'public');
$function$;

comment on function public.circuit_group_is_public(uuid) is
  'Whether a whole circuit group may be shown to signed-out visitors: it has people, and EVERY one of them is public. A group is the unit of privacy for its films and its watchlist -- those belong to the group, not to whichever member happened to rate or vote on them. Deliberately a rule that can become true rather than a flat refusal: make every person in a group public and its board follows.';

revoke all on function public.circuit_group_is_public(uuid) from public, anon, authenticated;

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
  ),
  /* ⚠️ THE GROUP IS THE UNIT OF PRIVACY, NOT THE PERSON WHO TOUCHED THE ROW. Films and watchlist
     rows used to reach this board whenever a PUBLIC person rated or voted on them -- so one
     member opting in published the whole catalogue of every private group they belong to. The
     Crew is eight people and one of them is public; its 163 films are the other seven's too. */
  pubgroups as (
    select g.id from circuit_groups g where public.circuit_group_is_public(g.id)
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
      where m.group_id in (select id from pubgroups)
    ), '[]'::jsonb),

    'watchlist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'kind', w.kind, 'rt', w.rt))
      from circuit_watchlist w
      where w.group_id in (select id from pubgroups)
    ), '[]'::jsonb)
  );
$function$;
