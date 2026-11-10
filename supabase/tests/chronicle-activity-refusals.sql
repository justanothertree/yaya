-- Readable refusals for an activity's name and unit, asked of the real function as a seeded member.
--
-- ⛔ NEEDS docs/2026-11-10-chronicle-activity-refusals.DRAFT.sql APPLIED FIRST, and refuses to run
-- otherwise. It runs only where a throwaway database has been built from the migrations and seed
-- (the `db guards` CI job), and it rolls back. NEVER against production: it writes rows.
--
-- WHAT IT ASKS:
--   0  the draft is applied, and there is a member to act as
--   A  anon cannot execute the function and members can: the replace kept the grants
--   B  an empty, blank, missing or 61-character name, and a 17-character unit, are refused in
--      words, where the table used to refuse them with a constraint's name
--   C  a 60-character name and a 16-character unit still save; an edit that sends no unit keeps
--      the one it had; a refused edit changes nothing
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
  if position($q$raise exception 'an activity needs a name'$q$
              in pg_get_functiondef('public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)'::regprocedure)) = 0 then
    raise exception 'apply docs/2026-11-10-chronicle-activity-refusals.DRAFT.sql before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;

-- ── A ───────────────────────────────────────────────────────────────────────────────────────────
insert into fails select 'anon can execute', ''
where has_function_privilege('anon', 'public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)', 'execute');
insert into fails select 'a member cannot execute', ''
where not has_function_privilege('authenticated', 'public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)', 'execute');

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── B. each refusal, in words ───────────────────────────────────────────────────────────────────
do $$
declare got text; c record;
begin
  for c in select * from (values
      ('an empty name',          '',               null::text, 'an activity needs a name'),
      ('a blank name',           '   ',            null,       'an activity needs a name'),
      ('no name',                null,             null,       'an activity needs a name'),
      ('a 61-character name',    repeat('x', 61),  null,       'that is longer than a name — 60 characters'),
      ('a 17-character unit',    'Refusals: unit', repeat('m', 17), 'that is longer than a unit — 16 characters')
    ) as v(label, name, unit, want)
  loop
    got := null;
    begin
      perform public.chronicle_activity_save(null, c.name, 'free', null, c.unit, null);
    exception when others then got := sqlerrm;
    end;
    if got is distinct from c.want then
      insert into fails values ('B: ' || c.label, coalesce(got, 'it was accepted'));
    end if;
  end loop;
end $$;

-- ── C. what still saves, and what an edit leaves alone ──────────────────────────────────────────
do $$
declare a uuid; got text;
begin
  a := public.chronicle_activity_save(null, repeat('x', 60), 'free', null, repeat('m', 16), null);
  insert into ids values ('a', a);
  perform public.chronicle_activity_save(a, 'Refusals: renamed', 'free', null, null, null);
  begin
    perform public.chronicle_activity_save(a, repeat('y', 61), 'free', null, null, null);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'that is longer than a name — 60 characters' then
    insert into fails values ('C: a 61-character rename', coalesce(got, 'it was accepted'));
  end if;
exception when others then insert into fails values ('C: a good save was refused', sqlerrm);
end $$;
reset role;
insert into fails select 'C: the edit did not keep the name or the unit', name || ' / ' || coalesce(metric, 'no unit')
  from public.chronicle_activities
 where id = (select v from ids where k = 'a')
   and (name is distinct from 'Refusals: renamed' or metric is distinct from repeat('m', 16));
insert into fails select 'C: the 60-character activity is missing', ''
where not exists (select 1 from public.chronicle_activities where id = (select v from ids where k = 'a'));

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'ACTIVITY REFUSALS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'activity refusals hold' as result, count(*) as failures from fails;

rollback;
