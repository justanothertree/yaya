-- OPEN-DECISIONS 21a and 21b, asked of the real functions as a seeded member.
--
-- ⛔ NEEDS BOTH DRAFTS APPLIED FIRST, and refuses to run otherwise:
--      docs/2026-11-10-chronicle-moments-decimals.DRAFT.sql
--      docs/2026-11-10-chronicle-entry-amount-negative.DRAFT.sql
-- It runs only where a throwaway database has been built from the migrations and seed (the
-- `db guards` CI job), and it rolls back. NEVER against production: it writes rows.
--
-- WHAT IT ASKS:
--   0  both drafts are applied, and there is a member to act as
--   A  neither function is open to anon and both are open to members: the replace kept the grants
--   B  21a: a day's workout line prints 3.5, 0.25, 12 and 12.345 as 3.5, 0.25, 12 and 12.35
--   C  21b: a negative amount on a sitting with no counted sets leaves it with no amount and is not
--      refused; with ten counted reps a negative and a blank are both refused, naming 10; and
--      twelve is kept
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table seen(k text primary key, v text);
create temp table subject as
  select (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me;
/* today's UTC midnight, and days counted from it, as the other chronicle tests do */
create temp table t as
  select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as t0,
         (now() at time zone 'utc')::date as today;
grant select on subject, t to authenticated, anon;
grant select, insert on fails, seen to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. BOTH DRAFTS MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT THE OLD TEXT ─────────────────
do $$
begin
  if position($q$trim_scale(round((en->>'val')::numeric, 2))::text$q$
              in pg_get_functiondef('public.chronicle_moments(timestamptz, timestamptz)'::regprocedure)) = 0
     or position('greatest(coalesce(p_amount, 0), 0)'
              in pg_get_functiondef('public.chronicle_entry_amount(uuid, numeric)'::regprocedure)) = 0 then
    raise exception 'apply both 2026-11-10 drafts before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;

-- ── A. the grants survived the replace ──────────────────────────────────────────────────────────
insert into fails select 'anon can execute', f from (values
  ('public.chronicle_moments(timestamptz, timestamptz)'),
  ('public.chronicle_entry_amount(uuid, numeric)')) v(f)
where has_function_privilege('anon', f, 'execute');
insert into fails select 'a member cannot execute', f from (values
  ('public.chronicle_moments(timestamptz, timestamptz)'),
  ('public.chronicle_entry_amount(uuid, numeric)')) v(f)
where not has_function_privilege('authenticated', f, 'execute');

-- ── fixtures, as the owner: my person with four exercises, and yesterday's log ────────────────
insert into public.circuit_people (id, name, exercises, owner_user_id, visibility) values
  ('ab-mine', '21ab: mine',
   '[{"id":"x-walk","name":"Walk","unit":"mi","mult":1,"col":0,"row":0},
     {"id":"x-plank","name":"Plank","unit":"min","mult":1,"col":0,"row":1},
     {"id":"x-squat","name":"Squat","unit":"reps","mult":1,"col":0,"row":2},
     {"id":"x-row","name":"Row","unit":"km","mult":1,"col":0,"row":3}]',
   (select me from subject), 'private');
insert into public.circuit_logs (id, person_id, date, entries) values
  ('ab-log', 'ab-mine', (select today from t) - 1,
   '[{"eid":"x-walk","val":3.5},{"eid":"x-plank","val":0.25},{"eid":"x-squat","val":12},{"eid":"x-row","val":12.345}]');

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);

-- ── B. 21a: the workout line keeps its decimals ─────────────────────────────────────────────────
set local role authenticated;
do $$
begin
  insert into seen values ('moments',
    public.chronicle_moments((select t0 from t) - interval '1 day', (select t0 from t))::text);
exception when others then insert into fails values ('reading the day raised', sqlerrm);
end $$;
reset role;
insert into fails select '21a: the workout line does not say ' || want,
       coalesce((select v from seen where k = 'moments'), 'nothing')
  from (values ('Walk 3.5 mi'), ('Plank 0.25 min'), ('Squat 12 reps'), ('Row 12.35 km')) w(want)
 where position(want in coalesce((select v from seen where k = 'moments'), '')) = 0;

-- ── C. 21b: a negative is no amount, and the floor names a number ───────────────────────────────
set local role authenticated;
do $$
declare a uuid; e uuid;
begin
  a := public.chronicle_activity_save(null, '21ab: squats', 'free', null, 'reps', null);
  insert into ids values ('act', a);
  e := public.chronicle_entry_add(a, (select t0 from t) - interval '14 hours',
                                     (select t0 from t) - interval '13 hours', null);
  insert into ids values ('e', e);
  perform public.chronicle_entry_amount(e, 5);
  begin
    perform public.chronicle_entry_amount(e, -4);
  exception when others then
    insert into fails values ('21b: a negative with no counted sets was refused', sqlerrm);
  end;
exception when others then insert into fails values ('21b: the sitting could not be made', sqlerrm);
end $$;
reset role;
insert into fails select '21b: a negative did not leave the sitting with no amount', amount::text
  from public.chronicle_entries
 where id = (select v from ids where k = 'e') and amount is not null;

set local role authenticated;
do $$
declare e uuid := (select v from ids where k = 'e'); got text;
begin
  perform public.chronicle_exercise_link('ab-mine', 'x-squat', (select v from ids where k = 'act'));
  perform public.chronicle_set_add('ab-mine', 'x-squat', 10, (select today from t) - 1, e);

  got := null;
  begin perform public.chronicle_entry_amount(e, -4); exception when others then got := sqlerrm; end;
  if got is distinct from 'this sitting''s sets count 10 — change those to go lower' then
    insert into fails values ('21b: a negative under ten counted reps', coalesce(got, 'it was accepted'));
  end if;

  got := null;
  begin perform public.chronicle_entry_amount(e, null); exception when others then got := sqlerrm; end;
  if got is distinct from 'this sitting''s sets count 10 — change those to go lower' then
    insert into fails values ('21b: a blank under ten counted reps', coalesce(got, 'it was accepted'));
  end if;

  perform public.chronicle_entry_amount(e, 12);
exception when others then insert into fails values ('21b: the sets half raised', sqlerrm);
end $$;
reset role;
insert into fails select '21b: twelve over ten counted reps was not kept', coalesce(amount::text, 'no amount')
  from public.chronicle_entries
 where id = (select v from ids where k = 'e') and amount is distinct from 12;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'21a/21b CHECKS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select '21a and 21b hold' as result, count(*) as failures from fails;

rollback;
