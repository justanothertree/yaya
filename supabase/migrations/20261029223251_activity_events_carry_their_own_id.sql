-- ✅ APPLIED 29 Oct 2026 as `activity_events_carry_their_own_id`.
--
-- Groundwork for the unified feed: every event the site can show now says WHICH ROW it is.
--
-- ⚠️ THE FEED NEEDS A KEY BEFORE IT NEEDS ANYTHING ELSE, because the thing hanging off that key
-- is somebody's words. `circuit_log_reactions` and `circuit_log_comments` key on a bare `log_id`,
-- which was right while a day log was the only thing anybody could react to. A feed carrying four
-- kinds in one list cannot use a bare id: four tables mint their own and nothing stops two of them
-- colliding, so a rating that happens to share a uuid with a day log would wear that log's
-- comments — somebody's remark about a workout appearing under somebody else's film. Unlikely per
-- pair, certain eventually. `src/feed/event.ts` keys on `kind:id` for that reason and has a test
-- that fails when the kind is dropped; this is the half of the contract that lives here.
--
-- ⚠️ A RATING HAS NO ID OF ITS OWN. `circuit_ratings` is keyed `(movie_id, user_id)` — so the id
-- emitted for one is the pair, not the film. A bare `movie_id` is unique per FILM and the feed is
-- a list of PEOPLE: two people rating Dune would be one event wearing both their names, and the
-- second to arrive would be deduped away by `mergeEvents`. The composite is not tidiness, it is
-- the difference between a feed that loses rows and one that does not.
--
-- ⚠️ ADDITIVE, AND MEASURED AS SUCH. Both functions are live — `get_member_activity` draws every
-- profile page and `chronicle_friends_log` draws the Chronicle friends list. A new key in a
-- returned json object is invisible to a client that maps the fields it knows, but "invisible"
-- is a claim, so it was checked rather than asserted: the output of each was hashed for all 14
-- members in a simulated session before this ran, and after it the hash of the output WITH THE
-- NEW KEY STRIPPED is identical, member for member. Nothing else moved.
--
-- ⚠️ NOT ONE VISIBILITY RULE IS TOUCHED. Every `can_see`, every `movie_visible`, every group-
-- membership test and all four of the chronicle's gates are exactly as they were. This file adds
-- a column to a select list; it does not get a vote on who may read it.

create or replace function public.get_member_activity(p_username text, p_limit integer DEFAULT 20)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_viewer uuid := auth.uid(); v_target uuid; v_username text; v_first text;
  v_tier public.visibility_tier;
begin
  /* ⚠️ No `not authenticated` raise, deliberately. This is reachable by anon only through
     get_public_activity, which checks public_page first; for every other caller the GRANT is the
     gate. can_see() returns true for 'public' and nothing else when auth.uid() is null, so a
     viewer who is nobody sees a public feed or an empty one. */
  select p.user_id, p.username::text, p.first_name, p.activity_visibility
    into v_target, v_username, v_first, v_tier
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  if v_target is null or not public.can_see(v_target, v_tier) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row_to_json(top)::jsonb)
    from (
      select * from (
        (
          select 'circuit_log' as kind, l.id::text as id, l.date::timestamptz as at,
                 (select string_agg(distinct cg.name, ', ')
                    from public.circuit_person_groups cpg
                    join public.circuit_groups cg on cg.id = cpg.group_id
                    join public.circuit_group_members m on m.group_id = cg.id and m.user_id = v_viewer
                   where cpg.person_id = cp.id) as detail,
                 round(coalesce(agg.pts, 0))::int as score, agg.items
          from public.circuit_logs l
          join public.circuit_people cp on cp.id = l.person_id
          left join lateral (
            select jsonb_agg(jsonb_build_object(
                     'name', coalesce(ex.def->>'name', case when t.entry->>'eid' = '__total__'
                              then 'Imported total' else 'Other' end),
                     'unit', ex.def->>'unit', 'val', (t.entry->>'val')::numeric,
                     'points', round(case when t.entry->>'eid' = '__total__'
                       then (t.entry->>'val')::numeric
                       else (t.entry->>'val')::numeric * coalesce((ex.def->>'mult')::numeric,0) end)
                   ) order by t.ord) as items,
                   sum(case when t.entry->>'eid' = '__total__' then (t.entry->>'val')::numeric
                       else (t.entry->>'val')::numeric * coalesce((ex.def->>'mult')::numeric,0) end) as pts
            from jsonb_array_elements(coalesce(l.entries,'[]'::jsonb)) with ordinality as t(entry, ord)
            left join lateral (select x as def from jsonb_array_elements(coalesce(cp.exercises,'[]'::jsonb)) x
                               where x->>'id' = t.entry->>'eid' limit 1) ex on true
          ) agg on true
          where cp.owner_user_id = v_target
            and (public.can_see(cp.owner_user_id, cp.visibility)
                 or exists (select 1 from public.circuit_person_groups cpg
                            join public.circuit_group_members m on m.group_id = cpg.group_id
                            where cpg.person_id = cp.id and m.user_id = v_viewer))
        )
        union all
        (
          /* ⚠️ `movie_visible` IS THE ROW'S OWN GATE and is the same one circuit_ratings_select
             uses — so a review reaches the feed only where it was already reachable. Rated but
             unwritten counts: a score IS the review for most of them. */
          /* ⚠️ THE ID IS THE PAIR, because the table's key is the pair. See the header: a bare
             movie_id is one event per FILM, and this is a list of PEOPLE. */
          select 'rating' as kind, r.movie_id::text || ':' || r.user_id::text as id, r.updated_at as at,
                 coalesce(nullif(btrim(mv.title), ''), 'Something') as detail,
                 r.score, null::jsonb as items
          from public.circuit_ratings r
          join public.circuit_movies mv on mv.id = r.movie_id
          where r.user_id = v_target
            and r.score is not null
            and public.movie_visible(r.movie_id)
        )
        union all
        (
          select 'snake_score' as kind, sh.id::text as id, sh.created_at as at, sh.game_mode as detail,
                 sh.score, null::jsonb as items
          from public.score_history sh
          left join public.player_registry r on r.id = sh.player_id
          where r.user_id = v_target
             or lower(sh.player_name) in (lower(v_username), lower(coalesce(v_first, v_username)))
        )
        union all
        (
          select 'snake_trophy' as kind, tr.id::text as id, tr.awarded_at as at, tr.trophy_name as detail,
                 lb.score, null::jsonb as items
          from public.trophies tr
          join public.leaderboard lb on lb.id = tr.leaderboard_id
          left join public.player_registry r on r.id = lb.player_id
          where r.user_id = v_target
             or lower(lb.player_name) in (lower(v_username), lower(coalesce(v_first, v_username)))
        )
      ) events
      order by at desc limit p_limit
    ) top
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.chronicle_friends_log(p_from timestamp with time zone, p_to timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- the window is a convenience, never a boundary -- clamped so a caller cannot ask for the
  -- whole history of everybody they know in one round trip
  v_to   := least(coalesce(p_to, clock_timestamp()), clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '7 days'), v_to - interval '31 days');
  if v_from >= v_to then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(t order by t.started_at desc, t.who, t.activity)
    from (
      select e.id::text                                     as id,
             p.username::text                               as who,
             coalesce(p.first_name, p.username::text)        as name,
             a.name                                          as activity,
             a.cat, a.colour,
             e.started_at, e.ended_at, e.amount, a.metric
        from public.chronicle_entries e
        join public.chronicle_activities a
          on a.id = e.activity and a.owner = e.owner
        join public.profiles p
          on p.user_id = e.owner and coalesce(p.suspended, false) = false
       where e.owner <> v_me
         and e.ended_at is not null
         and e.started_at < v_to
         and e.ended_at   > v_from
         and a.shared
         and public.are_friends(v_me, e.owner)
         and exists (
               select 1 from public.profile_blocks b
                where b.user_id = e.owner
                  and b.block_type = 'chronicle'
                  and coalesce((b.config->>'timeline')::boolean, false)
                  and public.can_see(e.owner, b.visibility))
       order by e.started_at desc
       limit 400
    ) t
  ), '[]'::jsonb);
end $function$;
