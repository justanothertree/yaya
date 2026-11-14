-- Readable refusals for a routine's name, and a step's minutes held at 600, asked of the real
-- function as a seeded member.
--
-- ⛔ NEEDS docs/2026-11-10-chronicle-routine-refusals.DRAFT.sql APPLIED FIRST, and refuses to run
-- otherwise. It runs only where a throwaway database has been built from the migrations and seed
-- (the `db guards` CI job), and it rolls back. NEVER against production: it writes rows.
--
-- WHAT IT ASKS:
--   0  the draft is applied, and there is a member to act as
--   A  anon cannot execute the function and members can: the replace kept the grants
--   B  an empty, missing or 61-character name is refused in words, where the table used to refuse
--      it with a constraint's name
--   C  a step of 99999999999 minutes saves and is held at 600, where it used to overflow an
--      integer; 30 stays 30; a 60-character name still saves
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table subject as
  select (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me;
grant select on subject to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. THE DRAFT MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT THE OLD TEXT ─────────────────
do $$
begin
  if position($q$raise exception 'a routine needs a name'$q$
              in pg_get_functiondef('public.chronicle_routine_save(uuid, text, jsonb)'::regprocedure)) = 0 then
    raise exception 'apply docs/2026-11-10-chronicle-routine-refusals.DRAFT.sql before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;

-- ── A ───────────────────────────────────────────────────────────────────────────────────────────
insert into fails select 'anon can execute', ''
where has_function_privilege('anon', 'public.chronicle_routine_save(uuid, text, jsonb)', 'execute');
insert into fails select 'a member cannot execute', ''
where not has_function_privilege('authenticated', 'public.chronicle_routine_save(uuid, text, jsonb)', 'execute');

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── B. each refusal, in words ───────────────────────────────────────────────────────────────────
do $$
declare got text; c record;
begin
  for c in select * from (values
      ('an empty name',        '',               'a routine needs a name'),
      ('no name',              null,             'a routine needs a name'),
      ('a 61-character name',  repeat('r', 61),  'that is longer than a name — 60 characters')
    ) as v(label, name, want)
  loop
    got := null;
    begin
      perform public.chronicle_routine_save(null, c.name, '[]'::jsonb);
    exception when others then got := sqlerrm;
    end;
    if got is distinct from c.want then
      insert into fails values ('B: ' || c.label, coalesce(got, 'it was accepted'));
    end if;
  end loop;
end $$;

-- ── C. the minutes, held rather than overflowed ─────────────────────────────────────────────────
do $$
declare a uuid;
begin
  a := public.chronicle_activity_save(null, 'Refusals: stretch', 'free', null, null, null);
  insert into ids values ('r', public.chronicle_routine_save(null, repeat('r', 60),
    jsonb_build_array(jsonb_build_object('activity', a, 'mins', '99999999999'),
                      jsonb_build_object('activity', a, 'mins', '30'))));
exception when others then insert into fails values ('C: the routine was refused', sqlerrm);
end $$;
reset role;
insert into fails select 'C: the steps are not 600 then 30', steps::text
  from public.chronicle_routines
 where id = (select v from ids where k = 'r')
   and ((steps->0->>'mins')::int is distinct from 600 or (steps->1->>'mins')::int is distinct from 30);
insert into fails select 'C: the routine at the limits is missing', ''
where not exists (select 1 from public.chronicle_routines where id = (select v from ids where k = 'r'));

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'ROUTINE REFUSALS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'routine refusals hold' as result, count(*) as failures from fails;

rollback;
