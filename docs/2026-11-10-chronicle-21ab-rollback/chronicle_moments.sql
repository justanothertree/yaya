CREATE OR REPLACE FUNCTION public.chronicle_moments(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  v_to   := coalesce(p_to, clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '1 day'), v_to - interval '366 days');
  if v_from >= v_to then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(t order by t.at desc nulls first, t.title)
    from (
      select 'rating'::text                                    as kind,
             r.updated_at                                      as at,
             null::text                                        as "on",
             coalesce(nullif(btrim(m.title), ''), 'Something')  as title,
             r.score,
             m.kind                                            as about,
             null::text                                        as detail
        from public.circuit_ratings r
        left join public.circuit_movies m on m.id = r.movie_id
       where r.user_id = v_me
         and r.updated_at >= v_from
         and r.updated_at <  v_to

      union all

      select 'workout'::text,
             null::timestamptz,
             l.date::text,
             (select string_agg(x.said, ' · ')
                from (
                  select coalesce(nullif(btrim(ex.nm), ''), 'something')
                         || ' ' || trim(to_char((en->>'val')::numeric, 'FM999999990.##'))
                         || coalesce(' ' || nullif(nullif(lower(btrim(ex.un)), ''), 'other'), '') as said
                    from jsonb_array_elements(l.entries) en
                    left join lateral (
                      select e->>'name' as nm, e->>'unit' as un
                        from jsonb_array_elements(p.exercises) e
                       where e->>'id' = en->>'eid'
                       limit 1
                    ) ex on true
                   where jsonb_typeof(l.entries) = 'array'
                     and (en->>'val') ~ '^[0-9.]+$'
                     and (en->>'val')::numeric > 0
                   limit 4
                ) x),
             null::int,
             nullif(btrim(p.name), ''),
             /* how many it held in all, so a row cut at four can say it was cut */
             (select count(*)::text
                from jsonb_array_elements(l.entries) en
               where jsonb_typeof(l.entries) = 'array'
                 and (en->>'val') ~ '^[0-9.]+$'
                 and (en->>'val')::numeric > 0)
        from public.circuit_logs l
        join public.circuit_people p
          on p.id = l.person_id and p.owner_user_id = v_me
       where l.date >= (v_from - interval '1 day')::date
         and l.date <= (v_to + interval '1 day')::date
    ) t
    where t.kind = 'rating' or nullif(btrim(t.title), '') is not null
    limit 400
  ), '[]'::jsonb);
end $function$
