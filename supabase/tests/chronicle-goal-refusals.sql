-- Readable refusals for a goal's title, target, unit and note, asked of the real function as a
-- seeded member.
--
-- ⛔ NEEDS docs/2026-11-10-chronicle-goal-refusals.DRAFT.sql APPLIED FIRST, and refuses to run
-- otherwise. It runs only where a throwaway database has been built from the migrations and seed
-- (the `db guards` CI job), and it rolls back. NEVER against production: it writes rows.
--
-- WHAT IT ASKS:
--   0  the draft is applied, and there is a member to act as
--   A  anon cannot execute the function and members can: the replace kept the grants
--   B  an empty, missing or 121-character title, a target of 0, -1 or two billion, a 17-character
--      unit and a 2001-character note are refused in words, where the table used to refuse them
--      with a constraint's name
--   C  the limits themselves still save (120, a billion, 16, 2000); an edit that sends no note keeps
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
  if position($q$raise exception 'a goal needs a title'$q$
              in pg_get_functiondef('public.chronicle_goal_save(uuid, text, text, date, integer, numeric, text, text, integer, uuid, text, text, integer, integer)'::regprocedure)) = 0 then
    raise exception 'apply docs/2026-11-10-chronicle-goal-refusals.DRAFT.sql before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;

-- ── A ───────────────────────────────────────────────────────────────────────────────────────────
insert into fails select 'anon can execute', ''
where has_function_privilege('anon', 'public.chronicle_goal_save(uuid, text, text, date, integer, numeric, text, text, integer, uuid, text, text, integer, integer)', 'execute');
insert into fails select 'a member cannot execute', ''
where not has_function_privilege('authenticated', 'public.chronicle_goal_save(uuid, text, text, date, integer, numeric, text, text, integer, uuid, text, text, integer, integer)', 'execute');

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── B. each refusal, in words ───────────────────────────────────────────────────────────────────
do $$
declare got text; c record;
begin
  for c in select * from (values
      ('an empty title',           '',                null::numeric, null::text,      null::text,        'a goal needs a title'),
      ('no title',                 null,              null,          null,            null,              'a goal needs a title'),
      ('a 121-character title',    repeat('t', 121),  null,          null,            null,              'that is longer than a title — 120 characters'),
      ('a target of 0',            'Refusals: zero',  0,             'minutes',       null,              'a target is more than 0 and at most a billion'),
      ('a target of -1',           'Refusals: minus', -1,            'minutes',       null,              'a target is more than 0 and at most a billion'),
      ('a target of two billion',  'Refusals: big',   2e9,           'minutes',       null,              'a target is more than 0 and at most a billion'),
      ('a 17-character unit',      'Refusals: unit',  10,            repeat('u', 17), null,              'that is longer than a unit — 16 characters'),
      ('a 2001-character note',    'Refusals: note',  null,          null,            repeat('n', 2001), 'that is longer than a note — 2000 characters')
    ) as v(label, title, target, unit, note, want)
  loop
    got := null;
    begin
      perform public.chronicle_goal_save(null, c.title, 'week', null, 1, c.target, c.unit, c.note,
                                         null, null, null, 'minutes', null, 0);
    exception when others then got := sqlerrm;
    end;
    if got is distinct from c.want then
      insert into fails values ('B: ' || c.label, coalesce(got, 'it was accepted'));
    end if;
  end loop;
end $$;

-- ── C. what still saves, and what an edit leaves alone ──────────────────────────────────────────
do $$
declare g uuid; got text;
begin
  g := public.chronicle_goal_save(null, repeat('t', 120), 'week', null, 1, 1e9, repeat('u', 16),
                                  repeat('n', 2000), null, null, null, 'minutes', null, 0);
  insert into ids values ('g', g);
  perform public.chronicle_goal_save(g, 'Refusals: again', 'week', null, 1, 1e9, repeat('u', 16),
                                     null, null, null, null, 'minutes', null, 0);
  begin
    perform public.chronicle_goal_save(g, 'Refusals: again', 'week', null, 1, 1e9, repeat('u', 16),
                                       repeat('n', 2001), null, null, null, 'minutes', null, 0);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'that is longer than a note — 2000 characters' then
    insert into fails values ('C: a 2001-character note on an edit', coalesce(got, 'it was accepted'));
  end if;
exception when others then insert into fails values ('C: a good save was refused', sqlerrm);
end $$;
reset role;
insert into fails select 'C: the edit did not keep the note, or took the title', title || ' / ' || coalesce(char_length(note)::text, 'no note')
  from public.chronicle_goals
 where id = (select v from ids where k = 'g')
   and (title is distinct from 'Refusals: again' or note is distinct from repeat('n', 2000));
insert into fails select 'C: the goal at the limits is missing', ''
where not exists (select 1 from public.chronicle_goals where id = (select v from ids where k = 'g'));

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'GOAL REFUSALS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'goal refusals hold' as result, count(*) as failures from fails;

rollback;
