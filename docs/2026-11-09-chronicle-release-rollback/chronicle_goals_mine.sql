CREATE OR REPLACE FUNCTION public.chronicle_goals_mine()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'title', g.title, 'scope', g.scope, 'anchor', g.anchor,
             'every', g.repeat_every, 'target', g.target, 'unit', g.unit,
             'progress', g.progress, 'done', g.done_at is not null,
             'note', g.note, 'sort', g.sort,
             'activity', g.activity, 'cat', g.cat, 'counts', g.counts,
             'est', g.est_mins, 'priority', g.priority,
             -- whether this one goes on the profile, which only matters on your own page
             'shared', g.shared, 'visibility', g.visibility,
             'at', extract(epoch from g.updated_at) * 1000
           ) order by g.priority desc, g.sort, g.created_at)
      from public.chronicle_goals g where g.owner = auth.uid()
  ), '[]'::jsonb);
end $function$
