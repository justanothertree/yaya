-- A photograph can hang on a rating or on a day's workout, not only on a chronicle sitting.
--
-- Applied 27 Oct 2026 as migration `pictures_on_ratings_and_workouts`. The function bodies below
-- were read back out of the live database with pg_get_functiondef after applying, rather than
-- copied from what was sent — see this directory's README on why that distinction matters.
--
-- Reasoning, the escalation this would have had, and the measurements that closed it:
--   docs/2026-10-26-pictures-on-ratings-and-workouts.sql

alter table public.circuit_ratings
  add column if not exists picture uuid references public.member_pictures(id) on delete set null;
alter table public.circuit_logs
  add column if not exists picture uuid references public.member_pictures(id) on delete set null;

-- ⚠️ `m.owner` MUST MATCH THE HOST ROW'S OWNER, AND THAT IS NOT BELT-AND-BRACES. Unlike
-- chronicle_entries, which is deny-all and reachable only through its RPCs, circuit_ratings grants
-- `authenticated` a direct UPDATE under `user_id = auth.uid()` — and a foreign key check runs
-- internally, outside RLS. So a member can PATCH their own rating row and set `picture` to ANY uuid
-- on the site, including a stranger's, and the FK accepts it. Measured: that write really does
-- succeed. Were this rule only "attached to a rating I can see", asking for a signed URL would
-- then hand over somebody else's photograph — read-anything, through a row you may legitimately
-- write. Requiring the picture's owner to be the rater closes it without touching a grant.
--
-- The 200 cap here is a backstop, not the real limit: the `seen` op in
-- supabase/functions/pictures/index.ts dedupes and caps at 60 and chunks above that, so a page
-- never reaches this. This bound exists for any other caller.
CREATE OR REPLACE FUNCTION public.pictures_i_can_see(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return '[]'::jsonb; end if;
  /* a page asking for more than this is asking the wrong question */
  if array_length(p_ids, 1) > 200 then raise exception 'too many pictures at once'; end if;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v
    from (
      select distinct m.id, m.key, m.thumb_key, m.mime, m.bytes, m.thumb_bytes,
             m.w, m.h, m.alt, m.created_at
        from public.member_pictures m
       where m.id = any(p_ids)
         and m.ready
         and (
           m.owner = auth.uid()
           or exists (
             select 1 from public.circuit_ratings r
              where r.picture = m.id
                and r.user_id = m.owner
                and public.movie_visible(r.movie_id))
           or exists (
             select 1 from public.circuit_logs l
               join public.circuit_people cp on cp.id = l.person_id
              where l.picture = m.id
                and cp.owner_user_id = m.owner
                and public.circuit_can_see_log(l.id))
         )
    ) x;
  return v;
end $function$;

-- Both halves have to be yours, in chronicle_entry_picture's own words: the rating check stops a
-- photograph being hung on somebody else's, the picture check stops somebody else's photograph
-- being hung on yours.
CREATE OR REPLACE FUNCTION public.circuit_rating_picture(p_movie text, p_picture uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.circuit_ratings r
                  where r.movie_id = p_movie and r.user_id = auth.uid()) then
    raise exception 'no such rating';
  end if;
  if p_picture is not null and not exists (
       select 1 from public.member_pictures m
        where m.id = p_picture and m.owner = auth.uid() and m.ready) then
    raise exception 'no such picture';
  end if;
  update public.circuit_ratings set picture = p_picture
   where movie_id = p_movie and user_id = auth.uid();
end $function$;

-- and on a day's workout, where "yours" is the account behind the person the log belongs to
CREATE OR REPLACE FUNCTION public.circuit_log_picture(p_log text, p_picture uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.circuit_logs l
                   join public.circuit_people cp on cp.id = l.person_id
                  where l.id = p_log and cp.owner_user_id = auth.uid()) then
    raise exception 'no such workout';
  end if;
  if p_picture is not null and not exists (
       select 1 from public.member_pictures m
        where m.id = p_picture and m.owner = auth.uid() and m.ready) then
    raise exception 'no such picture';
  end if;
  update public.circuit_logs set picture = p_picture where id = p_log;
end $function$;

-- §3: revoke from public AND anon, because anon holds execute directly in this project, so a
-- revoke aimed at PUBLIC alone leaves it untouched.
revoke all on function public.pictures_i_can_see(uuid[]) from public, anon;
revoke all on function public.circuit_rating_picture(text, uuid) from public, anon;
revoke all on function public.circuit_log_picture(text, uuid) from public, anon;
grant execute on function public.pictures_i_can_see(uuid[]) to authenticated;
grant execute on function public.circuit_rating_picture(text, uuid) to authenticated;
grant execute on function public.circuit_log_picture(text, uuid) to authenticated;

do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pictures_i_can_see','circuit_rating_picture','circuit_log_picture')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'anon can still execute: %', v_bad; end if;
end $$;
