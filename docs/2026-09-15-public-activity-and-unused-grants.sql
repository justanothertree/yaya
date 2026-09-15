-- 2026-09-15 — the public activity feed, and five grants that cannot be used
--
-- Both halves come out of the member-to-member sweep, which was run against the live database
-- rather than reasoned about. Two sections, one run.
--
--
-- ═══ PART 1 — ACTIVITY FOR A PUBLISHED PAGE ═════════════════════════════════════════════════
--
-- ⚠️ THE HARD PART WAS ALREADY DONE, which is why this is small. Reading get_member_activity:
-- `detail` (the circuit's name) is built by joining circuit_group_members on the VIEWER, so a
-- viewer who shares no group gets null — and a viewer who is nobody shares no group. The log rows
-- themselves are gated on `can_see(owner, cp.visibility) or shares a group`, and can_see answers
-- true for exactly one tier when nobody is signed in: 'public'. So the function already produces
-- the right answer for an anonymous caller. The only thing stopping it was its own first line.
--
-- ⚠️ THAT LINE IS REDUNDANT, NOT LOAD-BEARING. `if v_viewer is null then raise` cannot be the
-- thing protecting this, because the function is not granted to anon — the GRANT is. Removing the
-- raise widens nothing by itself, and lets a definer wrapper that IS granted to anon delegate to
-- it instead of duplicating sixty lines of points arithmetic that would then have to be kept in
-- step forever.
--
-- ⚠️ AND IT TAKES BOTH SWITCHES, not one. activity_visibility = 'public' was a setting people
-- made when only members could load a profile at all — the same trap the block tier had, where
-- "Anyone" honestly meant "any member" until a page could be published. So anonymous activity
-- requires the page to be published AND the activity to be public. Neither alone is consent to
-- the open internet.

-- the raise goes; can_see is what decides, and it already decides correctly for nobody
create or replace function public.get_member_activity(p_username text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_viewer uuid := auth.uid(); v_target uuid; v_username text; v_first text;
  v_tier public.visibility_tier;
begin
  /* ⚠️ No `not authenticated` raise. This function is reachable by anon only through
     get_public_activity below, which checks public_page first; for every other caller the GRANT
     is the gate. can_see() returns true for 'public' and nothing else when auth.uid() is null,
     so a viewer who is nobody sees a public feed or an empty one. */
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
          select 'circuit_log' as kind, l.date::timestamptz as at,
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
          -- by ACCOUNT first, then by name
          select 'snake_score' as kind, sh.created_at as at, sh.game_mode as detail,
                 sh.score, null::jsonb as items
          from public.score_history sh
          left join public.player_registry r on r.id = sh.player_id
          where r.user_id = v_target
             or lower(sh.player_name) in (lower(v_username), lower(coalesce(v_first, v_username)))
        )
        union all
        (
          select 'snake_trophy' as kind, tr.awarded_at as at, tr.trophy_name as detail,
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

-- unchanged: members only, exactly as before
revoke all on function public.get_member_activity(text, integer) from public, anon;
grant execute on function public.get_member_activity(text, integer) to authenticated;


/**
 * The same feed, for somebody who is not signed in.
 *
 * ⚠️ TWO SWITCHES. public_page says the page may be read by strangers; activity_visibility says
 * the activity may be. Requiring both means neither can be turned into the other by accident.
 *
 * ⚠️ A name nobody has, a page that is not published, and activity that is not public all return
 * the same empty array through the same path — so this is not a way to ask who is on the site,
 * which is the property get_public_profile is built around too.
 */
create or replace function public.get_public_activity(p_username text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
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
     and p.activity_visibility = 'public'
     and coalesce(p.suspended, false) = false
   limit 1;

  if v_ok is not true then return '[]'::jsonb; end if;

  -- delegated, not duplicated: one copy of the points arithmetic, and can_see does the rest
  return public.get_member_activity(p_username, least(greatest(coalesce(p_limit, 20), 1), 50));
end
$function$;

revoke all on function public.get_public_activity(text, integer) from public;
grant execute on function public.get_public_activity(text, integer) to anon, authenticated;


-- ═══ PART 2 — GRANTS THAT CANNOT BE USED ════════════════════════════════════════════════════
--
-- ⚠️ THIS IS HYGIENE, NOT A HOLE, and it is worth being clear about that. These five tables have
-- RLS enabled and ZERO policies, which is deny-all: verified by asking as anon, which read zero
-- rows from every one of them. The grant achieves nothing.
--
-- It is here because of the standing rule in 2026-09-04-anon-surface-trim: "don't grant what
-- cannot be used". Four functions were revoked there that already refused anon on their own first
-- line, precisely so the list of what a stranger may touch stays short enough to read in one go.
-- Two of these tables are profile_blocks and profile_notes — the two holding page content and
-- other people's words — so they are exactly the rows somebody auditing this would want to see
-- absent from an anon grant list rather than present-but-harmless.

revoke select on public.profile_blocks      from anon;
revoke select on public.profile_notes       from anon;
revoke select on public.profile_rooms       from anon;
revoke select on public.profile_room_invites from anon;

-- ⚠️ invites is granted to AUTHENTICATED with no policies, and is left alone deliberately:
-- get_invite_by_token is how an invite is read, it is a definer, and a future policy on this
-- table would want the grant already in place. Recorded rather than changed.


-- ── HOW TO CHECK IT ─────────────────────────────────────────────────────────────────────────
-- Activity, as a stranger. Expect [] until BOTH switches are on for that person:
--
--   select public.get_public_activity('evan');
--
-- And that the members' path is untouched — expect 'permission denied' as anon:
--
--   set local role anon; select public.get_member_activity('evan', 5);
--
-- Nothing a member can see should have changed. The sweep's section 4 is the regression test.
