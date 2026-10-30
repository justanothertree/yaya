-- ✅ APPLIED 30 Oct 2026 as `snake_events_attach_by_user_id`.
--
-- A snake score belongs to whoever posted it, not to whoever's name is on it.
--
-- ⚠️ THE OLD CLAUSE WAS `or lower(sh.player_name) in (lower(v_username), lower(v_first))`, which
-- means a score landed on a member's profile — and now in their feed — because the NAME typed
-- into a game matched theirs. The snake leaderboard is open: `player_registry` holds 128 names
-- and only 19 of them belong to a member, so names are minted by people who are not members at
-- all. `claim_my_reserved_snake_name` already links a reserved name to its owner, which is
-- exactly what the id is for; the name clause was a second, weaker answer to a question already
-- answered properly.
--
-- ⚠️ MEASURED BEFORE REMOVING IT, because a fallback usually carries something. Of 142 score
-- rows, 7 matched a member by name and the id agreed on all 7; of the trophies, 2 matched by
-- name and the id agreed on both. Nothing was reachable by name alone. Proof it changed nothing:
-- `get_member_activity` hashed for all 14 members in a simulated session before and after —
-- **14/14 identical, 813 events both times**.
--
-- ⚠️ AND THE HOLE WAS LIVE RATHER THAN THEORETICAL. Salty's first name is "Nik" and no registry
-- entry claims it, so anybody could have registered that name and posted under it. Staged in a
-- rolled-back transaction: a 999,999 score under an unclaimed "Nik" — the old predicate claimed
-- it for Salty (1), the function after this change does not (0), and his 7 real events are
-- untouched.
--
-- ⚠️ THE FIRST ATTEMPT AT THAT PROOF PROVED NOTHING AND LOOKED LIKE IT HAD. It planted an
-- impostor called "Mills", whose registry row already exists and is claimed — so
-- `where pr.user_id is null` matched nothing, no row was inserted, and the test reported a clean
-- 0 against an empty fixture. The second version asserts the fixture staged (`planted = 1`)
-- before believing anything downstream of it.

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
          /* ⚠️ THE ID IS THE PAIR, because the table's key is the pair. A bare movie_id is one
             event per FILM, and this is a list of PEOPLE. */
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
          /* ⚠️ BY USER ID, NEVER BY NAME. This used to read
               `or lower(sh.player_name) in (lower(v_username), lower(v_first))`
             so a snake score attached to a member because the NAME on it matched theirs. The
             leaderboard is open — `player_registry` holds 128 names of which only 19 belong to a
             member — so anybody could have posted a score under somebody else's first name and
             had it appear on their profile, and now in their feed, as theirs.
             `claim_my_reserved_snake_name` already links a reserved name to its owner, which is
             what the id is FOR. Measured before removing it: of the 142 score rows, 7 matched a
             member by name and the id agreed on all 7; the same for both trophy rows. So it
             carried nothing and risked everything. */
          select 'snake_score' as kind, sh.id::text as id, sh.created_at as at, sh.game_mode as detail,
                 sh.score, null::jsonb as items
          from public.score_history sh
          join public.player_registry r on r.id = sh.player_id
          where r.user_id = v_target
        )
        union all
        (
          select 'snake_trophy' as kind, tr.id::text as id, tr.awarded_at as at, tr.trophy_name as detail,
                 lb.score, null::jsonb as items
          from public.trophies tr
          join public.leaderboard lb on lb.id = tr.leaderboard_id
          join public.player_registry r on r.id = lb.player_id
          where r.user_id = v_target
        )
      ) events
      order by at desc limit p_limit
    ) top
  ), '[]'::jsonb);
end;
$function$;
