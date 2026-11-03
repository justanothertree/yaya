-- ✅ APPLIED 3 Nov 2026 as `circle_names_are_distinct_and_plain`.
--
-- Three things about circles, two of them about the name.
--
-- ⚠️ "Family" AND "family" WERE TWO CIRCLES. `UNIQUE (owner, name)` is
-- case-sensitive, and nobody means that by "I already have one called that". Now unique on
-- `(owner, lower(name))`. And a name is a label, not a document: control characters and line
-- breaks break every surface that renders it in a row. Refused at the table AND in the function,
-- because a constraint violation reaches the client as database noise while the function's
-- version is a sentence.
--
-- ⚠️ AND AN EX-FRIEND IS NOW COUNTED RATHER THAN NAMED, which reverses a decision
-- made three days ago. `my_visibility_circles` listed them with `friend: false`, reasoning that
-- an owner who cannot see a row cannot tidy it away. That is right about the tidying and wrong
-- about the naming: the row grants nothing, and rendering somebody's CURRENT username and first
-- name keeps a window open onto a person who is no longer a friend -- one that widens every time
-- they change either. The count says there is something to tidy,
-- `visibility_circle_drop_ex_friends` tidies it, and nobody's live profile is read out to settle
-- a row that means nothing.
--
-- Verified in a rolled-back transaction:
--   create "Family"                        ok
--   create "family"                        refused, "you already have a circle called that"
--   a name with a line break / a tab       refused, each with its own sentence
--   a different name                       ok            (control: not refusing everything)
--   a live friend in the circle            members=1  ex_friends=0
--   after the friendship ends              members=0  ex_friends=1, and the username appears
--                                          nowhere in the payload
--   tidy up                                dropped=1  ex_friends=0

/* ── the name ───────────────────────────────────────────────────────────────────────────────
   `UNIQUE (owner, name)` let one account hold "Family" and "family", which are the same circle
   to everybody except the database. Case-insensitive uniqueness is what a person means by "I
   already have one called that".

   And a name is a label, not a document: control characters and line breaks in it break every
   surface that renders it in a row and are never what somebody meant to type. Refused at the
   table so the rule survives a writer that is not the RPC. */
alter table public.visibility_circles drop constraint if exists visibility_circles_owner_name;
create unique index if not exists ux_visibility_circles_owner_lower_name
  on public.visibility_circles (owner, lower(name));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visibility_circles_name_plain') then
    alter table public.visibility_circles
      add constraint visibility_circles_name_plain check (name !~ '[[:cntrl:]]');
  end if;
end $$;

create or replace function public.visibility_circle_save(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me   uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if v_name = '' then raise exception 'a circle needs a name'; end if;
  if length(v_name) > 40 then raise exception 'that name is too long (40 characters)'; end if;
  /* Said here as well as on the table, because a constraint violation reaches the client as
     database noise and this reaches it as a sentence. */
  if v_name ~ '[[:cntrl:]]' then raise exception 'a circle name cannot contain line breaks'; end if;

  if p_id is null then
    if (select count(*) from public.visibility_circles where owner = v_me) >= 20 then
      raise exception 'that is as many circles as one account can have (20)';
    end if;
    insert into public.visibility_circles (owner, name) values (v_me, v_name) returning id into v_id;
    return v_id;
  end if;

  /* The same message for "not yours" and "not there", so this cannot be used to find out which. */
  update public.visibility_circles set name = v_name
   where id = p_id and owner = v_me
   returning id into v_id;
  if v_id is null then raise exception 'no such circle'; end if;
  return v_id;
exception
  when unique_violation then raise exception 'you already have a circle called that';
end $function$;

create or replace function public.my_visibility_circles()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  /* ⚠️ A MEMBER WHOSE FRIENDSHIP ENDED IS COUNTED, NOT NAMED. The first version listed them with
     `friend: false`, on the reasoning that an owner who cannot see a row cannot tidy it away.
     That reasoning is right about the tidying and wrong about the naming: the row grants nothing,
     and rendering somebody's CURRENT username and first name keeps a small window open onto a
     person who is no longer a friend, which gets wider every time they change either. So the
     count says there is something to tidy, `visibility_circle_drop_ex_friends` does the tidying,
     and nobody's live profile is read out to settle a row that means nothing. */
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'created_at', c.created_at,
        'members', coalesce(m.members, '[]'::jsonb),
        'ex_friends', coalesce(m.ex, 0)
      ) order by lower(c.name)
    ),
    '[]'::jsonb)
  from public.visibility_circles c
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'username', p.username::text,
               'name', coalesce(p.first_name, p.username::text)
             ) order by lower(coalesce(p.first_name, p.username::text))
           ) filter (where coalesce(public.are_friends(c.owner, vm.member), false)) as members,
           count(*) filter (where not coalesce(public.are_friends(c.owner, vm.member), false)) as ex
      from public.visibility_circle_members vm
      join public.profiles p on p.user_id = vm.member
     where vm.circle_id = c.id
  ) m on true
  where c.owner = auth.uid();
$function$;

create or replace function public.visibility_circle_drop_ex_friends(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_me uuid := auth.uid(); n integer;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.visibility_circles where id = p_id and owner = v_me) then
    raise exception 'no such circle';
  end if;
  delete from public.visibility_circle_members vm
   where vm.circle_id = p_id
     and not coalesce(public.are_friends(v_me, vm.member), false);
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.visibility_circle_save(uuid, text) from public, anon;
revoke all on function public.my_visibility_circles() from public, anon;
revoke all on function public.visibility_circle_drop_ex_friends(uuid) from public, anon;
grant execute on function public.visibility_circle_save(uuid, text) to authenticated;
grant execute on function public.my_visibility_circles() to authenticated;
grant execute on function public.visibility_circle_drop_ex_friends(uuid) to authenticated;
