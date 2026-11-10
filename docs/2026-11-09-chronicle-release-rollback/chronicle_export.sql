CREATE OR REPLACE FUNCTION public.chronicle_export()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;

  /**
   * ⚠️ ONE DOCUMENT, NOT FIVE RESULT SETS, and the reason is truncation rather than tidiness.
   * A client-side export would call five RPCs that each return a SET, and a set comes back through
   * PostgREST, which can cap rows. A cap it applies silently turns "here is everything you ever
   * recorded" into "here is some of it" — the same shape as a local ceiling under the server's,
   * where the person is told the thing succeeded. One row cannot be truncated by a row limit.
   *
   * ⚠️ EVERY LIST IS ORDERED, so two exports of unchanged data are byte-identical. Nothing here
   * needs that today; somebody diffing last month's file against this month's does, and an
   * unordered jsonb_agg would make every line look changed.
   *
   * ⚠️ `owner` IS NOT IN THE FILE. It is the same uuid on every row and it is the caller's own id,
   * so writing it out would put an account identifier in a file people are encouraged to pass
   * between machines, in exchange for nothing a restore could not work out.
   *
   * ⚠️ AND IT IS NOT BOUNDED, deliberately. An export that quietly stopped at N rows would be the
   * exact failure it exists to prevent. The ceiling is what one person has written about their own
   * days; the authenticator role's 8s statement_timeout is the backstop, and at three years of
   * three sittings a day this is a few hundred milliseconds.
   */
  return jsonb_build_object(
    'kind', 'chronicle',
    -- a future reader must be able to refuse a file that is not one of these, and to know what
    -- shape it is looking at. Bump this when a field changes meaning, never when one is added.
    'version', 1,
    'at', to_jsonb(now()),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'cat', a.cat, 'colour', a.colour,
               'archived_at', a.archived_at, 'created_at', a.created_at,
               'auto', a.auto, 'metric', a.metric, 'session_mins', a.session_mins, 'shared', a.shared,
               -- the ladder level. `shared` stays beside it because an older reader expects it,
               -- and the two cannot disagree: see chronicle_sharing_becomes_a_tier.
               'visibility', a.visibility,
               'certain', coalesce((
                  select jsonb_agg(pr.username::text order by lower(pr.username::text))
                    from public.visibility_certain vc
                    join public.profiles pr on pr.user_id = vc.friend
                   where vc.item_kind = 'chronicle_activity'
                     and vc.item_id = a.id::text and vc.owner = me
               ), '[]'::jsonb))
             order by a.created_at, a.id)
        from public.chronicle_activities a where a.owner = me), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'activity', e.activity,
               'started_at', e.started_at, 'ended_at', e.ended_at,
               'notes', coalesce((
                  select jsonb_agg(jsonb_build_object('at', nt.at, 'body', nt.body)
                                   order by nt.at, nt.id)
                    from public.chronicle_notes nt where nt.entry = e.id
               ), '[]'::jsonb), 'picture', e.picture, 'amount', e.amount, 'quality', e.quality,
               'created_at', e.created_at)
             order by e.started_at, e.id)
        from public.chronicle_entries e where e.owner = me), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'title', g.title, 'scope', g.scope, 'anchor', g.anchor,
               'repeat_every', g.repeat_every, 'target', g.target, 'unit', g.unit,
               'progress', g.progress, 'done_at', g.done_at, 'note', g.note, 'sort', g.sort,
               'activity', g.activity, 'cat', g.cat, 'counts', g.counts,
               'est_mins', g.est_mins, 'priority', g.priority,
               -- ⚠️ `shared` WAS NEVER IN HERE AT ALL, which means a goal somebody put on their
               -- profile has been coming back from a restore unshared since exports existed.
               -- Fail-closed, so nothing leaked -- but it is a setting silently lost, and the
               -- round-trip test this was found by is the one the ladder's plan asked for.
               'shared', g.shared, 'visibility', g.visibility,
               'certain', coalesce((
                  select jsonb_agg(pr.username::text order by lower(pr.username::text))
                    from public.visibility_certain vc
                    join public.profiles pr on pr.user_id = vc.friend
                   where vc.item_kind = 'chronicle_goal'
                     and vc.item_id = g.id::text and vc.owner = me
               ), '[]'::jsonb),
               'created_at', g.created_at, 'updated_at', g.updated_at)
             order by g.sort, g.created_at, g.id)
        from public.chronicle_goals g where g.owner = me), '[]'::jsonb),
    'routines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.name, 'steps', r.steps,
               'created_at', r.created_at, 'updated_at', r.updated_at)
             order by r.created_at, r.id)
        from public.chronicle_routines r where r.owner = me), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'activity', p.activity,
               'starts_at', p.starts_at, 'ends_at', p.ends_at, 'note', p.note,
               'created_at', p.created_at)
             order by p.starts_at, p.id)
        from public.chronicle_plans p where p.owner = me), '[]'::jsonb)
  );
end $function$
