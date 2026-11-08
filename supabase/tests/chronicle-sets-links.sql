-- An exercise linked to an activity, and what that does to the numbers — asked of the real
-- functions as seeded members.
--
-- ⛔ NEEDS BOTH DRAFTS APPLIED FIRST, in order, and refuses to run otherwise:
--      docs/2026-11-08-chronicle-sets.DRAFT.sql        (step 1)
--      docs/2026-11-09-chronicle-sets-links.DRAFT.sql  (step 2a)
-- Neither is applied to production. This runs only in a throwaway database built from the
-- migrations and seed — the `db guards` CI job — and rolls back. NEVER against production.
--
-- WHAT IT ASKS, section by section:
--   0  both drafts are applied, and there are two members
--   A  the links table is deny-all by every privilege; anon has no door; the internal helpers are
--      not callable by a member either
--   B  the unit table: what normalises, and what is "cannot be compared"
--   C  a link: made only where units agree, refused in three different words otherwise, never by
--      name; another member's person is nobody's; unlinking works
--   D  write-through: a counted set adds to its sitting, an uncounted one does not; a change and a
--      drop take back exactly what was added; saving the same change twice changes nothing; the
--      sitting's own count cannot go below its counted sets, and can go above
--   E  goal totals: the grid's manual half of a linked exercise counts by LOCAL day, inclusive at
--      the start and exclusive at the end, every log row for a day included; an unlinked or
--      mismatched exercise counts nothing; a sitting's sets are never counted a second time; and
--      an ask with no local days counts exactly what it did before
--   F  a move to another unit takes counted sets back out; a move within a unit changes nothing; a
--      link made later does not reach back; a link whose units stop agreeing stops counting
--   G  the export carries links and `counted`, the import puts both back, and a file's link whose
--      units do not agree here is refused
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table subject as
  select (select p.user_id from public.profiles p where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me,
         (select p.user_id from public.profiles p where coalesce(p.suspended, false) = false
           order by p.username offset 1 limit 1) as other;
create temp table t as
  select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as t0,
         (now() at time zone 'utc')::date as today;
create temp table seen(k text primary key, v jsonb);
grant select on subject, t to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids, seen to authenticated, anon;

-- ── 0 ───────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.chronicle_sets') is null
     or to_regclass('public.chronicle_exercise_links') is null
     or to_regprocedure('public.chronicle_exercise_link(text, text, uuid)') is null then
    raise exception 'apply the sets draft and then the links draft before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no second member', ''
where (select other from subject) is null or (select other from subject) = (select me from subject);

insert into public.circuit_people (id, name, exercises, owner_user_id) values
  ('lk-mine', 'Links: mine',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0},
     {"id":"ex-plank","name":"Plank","unit":"sec","mult":1,"col":0,"row":1},
     {"id":"ex-what","name":"Gym","unit":"other","mult":1,"col":0,"row":2}]',
   (select me from subject)),
  ('lk-theirs', 'Links: theirs',
   '[{"id":"ex-quad","name":"Quad Curl","unit":"reps","mult":1,"col":0,"row":0}]',
   (select other from subject));

-- ── A ───────────────────────────────────────────────────────────────────────────────────────
insert into fails
select 'the links table grants ' || pv || ' to ' || r, ''
from (values ('anon'), ('authenticated')) rs(r),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) ps(pv)
where has_table_privilege(r, 'public.chronicle_exercise_links', pv);
insert into fails select 'row level security is off on the links table', ''
where not (select relrowsecurity from pg_class where oid = 'public.chronicle_exercise_links'::regclass);
insert into fails select 'anon can execute', f from (values
  ('public.chronicle_exercise_link(text, text, uuid)'), ('public.chronicle_my_exercises()'),
  ('public.chronicle_unit(text)'), ('public.chronicle_link_ok(text, text, uuid)'),
  ('public.chronicle_manual_amount(uuid, date, date)')) v(f)
where has_function_privilege('anon', f, 'execute');
insert into fails select 'a member can call an internal helper', f from (values
  ('public.chronicle_link_ok(text, text, uuid)'), ('public.chronicle_manual_amount(uuid, date, date)'),
  ('public.chronicle_sets_uncount_if_unit_changed(uuid, text)')) v(f)
where has_function_privilege('authenticated', f, 'execute');

-- ── B ───────────────────────────────────────────────────────────────────────────────────────
insert into fails select 'the unit table', got::text
from (select jsonb_agg(jsonb_build_array(w, public.chronicle_unit(w)) order by n) as got
        from (values (1, 'Reps'), (2, ' repetitions '), (3, 'seconds'), (4, 'MIN'), (5, 'hours'),
                     (6, 'Miles'), (7, 'kilometres'), (8, 'laps'), (9, 'other'), (10, ''), (11, null))
             v(n, w)) z
where got is distinct from '[["Reps","reps"],[" repetitions ","reps"],["seconds","sec"],["MIN","min"],
  ["hours","hr"],["Miles","mi"],["kilometres","km"],["laps",null],["other",null],["",null],[null,null]]'::jsonb;

-- ── C. links ────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into ids values ('their_act', public.chronicle_activity_save(null, 'Links: their gym', 'free', null, 'reps', null));
exception when others then insert into fails values ('the other member''s activity raised', sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got text;
begin
  insert into ids values
    ('gym',      public.chronicle_activity_save(null, 'Links: gym', 'free', null, 'Reps', null)),
    ('tread',    public.chronicle_activity_save(null, 'Links: treadmill', 'free', null, 'reps', null)),
    ('holds',    public.chronicle_activity_save(null, 'Links: holds', 'free', null, 'seconds', null)),
    ('laps',     public.chronicle_activity_save(null, 'Links: laps', 'free', null, 'laps', null)),
    ('drawing',  public.chronicle_activity_save(null, 'Links: drawing', 'locked', null, null, null)),
    ('shelved',  public.chronicle_activity_save(null, 'Links: shelved', 'free', null, 'reps', null));
  perform public.chronicle_activity_archive((select v from ids where k = 'shelved'), true);
exception when others then insert into fails values ('making activities raised', sqlerrm);
end $$;
reset role;

create temp table tries(what text, person text, ex text, act_k text, want text);
insert into tries values
  ('seconds against reps',           'lk-mine',   'ex-plank', 'gym',       'they count different things (sec and Reps)'),
  ('an exercise in "other"',          'lk-mine',   'ex-what',  'gym',       'those units cannot be compared (other and Reps)'),
  ('an activity counting laps',       'lk-mine',   'ex-quad',  'laps',      'those units cannot be compared (reps and laps)'),
  ('an activity counting nothing',    'lk-mine',   'ex-quad',  'drawing',   'that activity does not count anything'),
  ('an archived activity',            'lk-mine',   'ex-quad',  'shelved',   'that is not one of your activities'),
  ('another member''s activity',      'lk-mine',   'ex-quad',  'their_act', 'that is not one of your activities'),
  ('another member''s person',        'lk-theirs', 'ex-quad',  'gym',       'no such person of yours'),
  ('an exercise not on the list',     'lk-mine',   'ex-none',  'gym',       'no such exercise');
grant select on tries to authenticated, anon;

set local role authenticated;
do $$
declare r record; got text;
begin
  for r in select * from tries loop
    got := null;
    begin
      perform public.chronicle_exercise_link(r.person, r.ex, (select v from ids where k = r.act_k));
    exception when others then got := sqlerrm;
    end;
    if got is distinct from r.want then
      insert into fails values ('refusing a link: ' || r.what, coalesce(got, 'it was linked'));
    end if;
  end loop;
  -- the real ones: Quad Curl counts as Gym, Plank as holds — and unlinking and relinking works
  perform public.chronicle_exercise_link('lk-mine', 'ex-quad', (select v from ids where k = 'tread'));
  perform public.chronicle_exercise_link('lk-mine', 'ex-quad', null);
  perform public.chronicle_exercise_link('lk-mine', 'ex-quad', (select v from ids where k = 'gym'));
  perform public.chronicle_exercise_link('lk-mine', 'ex-plank', (select v from ids where k = 'holds'));
  insert into seen values ('mine', public.chronicle_my_exercises());
exception when others then insert into fails values ('linking raised', sqlerrm);
end $$;
reset role;

insert into fails select 'the links that landed', coalesce(string_agg(exercise_id || '>' || a.name, ', ' order by exercise_id), 'none')
from public.chronicle_exercise_links lk join public.chronicle_activities a on a.id = lk.activity
where lk.person_id = 'lk-mine'
having string_agg(exercise_id || '>' || a.name, ', ' order by exercise_id)
       is distinct from 'ex-plank>Links: holds, ex-quad>Links: gym';
-- ⚠️ the exercise called "Gym" is not linked to the activity called Gym: names are never read
insert into fails select 'what my exercises say', (select v::text from seen where k = 'mine')
where (select jsonb_agg(jsonb_build_array(x->>'exercise', x->>'canon', x->'ok') order by x->>'exercise')
         from seen, jsonb_array_elements(v) x where k = 'mine' and x->>'person' = 'lk-mine')
      is distinct from '[["ex-plank","sec",true],["ex-quad","reps",true],["ex-what",null,null]]'::jsonb;
insert into fails select 'my exercises include another member''s', (select v::text from seen where k = 'mine')
where exists (select 1 from seen, jsonb_array_elements(v) x where k = 'mine' and x->>'person' = 'lk-theirs');

-- ── D. write-through ────────────────────────────────────────────────────────────────────────
set local role authenticated;
do $$
declare e uuid;
begin
  e := public.chronicle_entry_add((select v from ids where k = 'gym'),
         (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours', null);
  insert into ids values ('s', e);
  insert into ids values
    ('quad', public.chronicle_set_add('lk-mine', 'ex-quad', 12, (select today from t) - 1, e)),
    -- Plank is linked, but to holds — in a Gym sitting it is recorded and not counted
    ('plank', public.chronicle_set_add('lk-mine', 'ex-plank', 30, (select today from t) - 1, e));
  perform public.chronicle_set_change((select v from ids where k = 'quad'), 15);
  perform public.chronicle_set_change((select v from ids where k = 'quad'), 15);  -- the same save again
  insert into ids values ('quad2', public.chronicle_set_add('lk-mine', 'ex-quad', 5, (select today from t) - 1, e));
exception when others then insert into fails values ('writing sets raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a counted set did not reach its sitting, or an uncounted one did', amount::text
from public.chronicle_entries where id = (select v from ids where k = 's') and amount is distinct from 20;
insert into fails select 'which sets are counted', string_agg(exercise_id || ':' || counted, ', ' order by exercise_id, value)
from public.chronicle_sets where entry = (select v from ids where k = 's')
having string_agg(exercise_id || ':' || counted, ', ' order by exercise_id, value)
       is distinct from 'ex-plank:false, ex-quad:true, ex-quad:true';

set local role authenticated;
do $$
declare got text;
begin
  perform public.chronicle_set_drop((select v from ids where k = 'quad2'));         -- 20 → 15
  begin perform public.chronicle_entry_amount((select v from ids where k = 's'), 10);
  exception when others then got := sqlerrm; end;
  if got is distinct from 'this sitting''s sets count 15 — change those to go lower' then
    insert into fails values ('a count below the sitting''s sets', coalesce(got, 'it was accepted'));
  end if;
  perform public.chronicle_entry_amount((select v from ids where k = 's'), 40);     -- 25 by hand, 15 by sets
  perform public.chronicle_set_drop((select v from ids where k = 'plank'));        -- uncounted: nothing moves
exception when others then insert into fails values ('correcting raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a drop, a refused count and a count above the sets', amount::text
from public.chronicle_entries where id = (select v from ids where k = 's') and amount is distinct from 40;

-- ── E. goal totals: the grid's manual half, by local day ───────────────────────────────────
/* two logs for one day, which nothing prevents; a total row the grid imported; another member's
   person; a day outside the window at each end */
insert into public.circuit_logs (id, person_id, date, entries) values
  ('lk-l1', 'lk-mine', (select today from t) - 8, '[{"eid":"ex-quad","val":100}]'),
  ('lk-l2', 'lk-mine', (select today from t) - 7, '[{"eid":"ex-quad","val":20},{"eid":"ex-plank","val":60}]'),
  ('lk-l3', 'lk-mine', (select today from t) - 3, '[{"eid":"ex-quad","val":7},{"eid":"__total__","val":500}]'),
  ('lk-l4', 'lk-mine', (select today from t) - 3, '[{"eid":"ex-quad","val":3}]'),
  ('lk-l5', 'lk-mine', (select today from t),     '[{"eid":"ex-quad","val":1000}]'),
  ('lk-l6', 'lk-theirs', (select today from t) - 3, '[{"eid":"ex-quad","val":900}]');

set local role authenticated;
do $$
declare g uuid; with_days jsonb; without jsonb;
begin
  g := public.chronicle_goal_save(null, 'Links: reps a week', 'week', null, 1, 500, 'reps',
                                  null, null, (select v from ids where k = 'gym'), null, 'amount', null, 0);
  insert into ids values ('goal', g);
  with_days := jsonb_build_array(jsonb_build_object('key', 'w', 'id', g,
                 'from', (select t0 from t) - interval '7 days', 'to', (select t0 from t),
                 'from_day', (select today from t) - 7, 'to_day', (select today from t)));
  without := jsonb_build_array(jsonb_build_object('key', 'w', 'id', g,
                 'from', (select t0 from t) - interval '7 days', 'to', (select t0 from t)));
  insert into seen values ('with', public.chronicle_tally(with_days)), ('without', public.chronicle_tally(without));
exception when others then insert into fails values ('asking the tally raised', sqlerrm);
end $$;
reset role;
/* expected: the sitting's 40 (its 15 counted sets are IN that 40, and nowhere else), plus Quad
   Curl's manual half on days −7 (20) and −3 (7 + 3). Not −8 (before), not today (the window ends
   at today, exclusive), not Plank (linked to holds, not Gym), not the total row, not theirs. */
insert into fails select 'a goal counting the grid by local day', (select v::text from seen where k = 'with')
where ((select v from seen where k = 'with')->>'w')::numeric is distinct from 70;
insert into fails select 'an ask with no local days changed what it counts', (select v::text from seen where k = 'without')
where ((select v from seen where k = 'without')->>'w')::numeric is distinct from 40;

-- ── F. moves, late links, and links that stop agreeing ─────────────────────────────────────
set local role authenticated;
do $$
begin
  -- within a unit: reps to reps — nothing moves
  perform public.chronicle_entry_edit_day((select v from ids where k = 's'),
    (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours',
    (select v from ids where k = 'tread'), (select today from t) - 1);
exception when others then insert into fails values ('moving within a unit raised', sqlerrm);
end $$;
reset role;
/* read as the table's owner — the member cannot read the table, which is the point of it */
insert into seen select 'within', to_jsonb(x) from (select amount from public.chronicle_entries
  where id = (select v from ids where k = 's')) x;

set local role authenticated;
do $$
declare e uuid;
begin
  -- to seconds: the counted 15 come back out, and the 25 counted by hand stay
  perform public.chronicle_entry_edit_day((select v from ids where k = 's'),
    (select t0 from t) - interval '14 hours', (select t0 from t) - interval '13 hours',
    (select v from ids where k = 'holds'), (select today from t) - 1);
  -- a sitting with an unlinked exercise, linked afterwards: the link does not reach back
  e := public.chronicle_entry_add((select v from ids where k = 'tread'),
         (select t0 from t) - interval '12 hours', (select t0 from t) - interval '11 hours', null);
  insert into ids values ('late', e);
  insert into ids values ('late_set', public.chronicle_set_add('lk-mine', 'ex-quad', 9, (select today from t) - 1, e));
  perform public.chronicle_exercise_link('lk-mine', 'ex-quad', (select v from ids where k = 'tread'));
exception when others then insert into fails values ('moving raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a move within a unit changed the count', (select v::text from seen where k = 'within')
where ((select v from seen where k = 'within')->>'amount')::numeric is distinct from 40;
insert into fails select 'a move to another unit', amount::text || ' / ' || (select string_agg(counted::text, ',') from public.chronicle_sets where entry = (select v from ids where k = 's'))
from public.chronicle_entries where id = (select v from ids where k = 's')
  and (amount is distinct from 25 or exists (select 1 from public.chronicle_sets where entry = (select v from ids where k = 's') and counted));
insert into fails select 'a link made later reached back', coalesce(amount::text, 'null')
from public.chronicle_entries where id = (select v from ids where k = 'late') and amount is not null;

/* the activity's metric changes after linking: the link stops agreeing, so it counts nothing */
update public.chronicle_activities set metric = 'pages' where id = (select v from ids where k = 'tread');
set local role authenticated;
do $$
begin
  insert into ids values ('stale_set', public.chronicle_set_add('lk-mine', 'ex-quad', 4, (select today from t) - 1, (select v from ids where k = 'late')));
exception when others then insert into fails values ('a set after the units stopped agreeing raised', sqlerrm);
end $$;
reset role;
insert into fails select 'a link whose units stopped agreeing still counted', counted::text
from public.chronicle_sets where id = (select v from ids where k = 'stale_set') and counted;
update public.chronicle_activities set metric = 'reps' where id = (select v from ids where k = 'tread');

-- ── G. the export and the import ───────────────────────────────────────────────────────────
create temp table docs(k text primary key, body jsonb);
grant select, insert on docs to authenticated, anon;
set local role authenticated;
do $$ begin insert into docs values ('orig', public.chronicle_export()); end $$;
reset role;
insert into fails select 'the export does not carry the links', coalesce((select (body->'exercise_links')::text from docs where k = 'orig'), 'none')
where coalesce(jsonb_array_length((select body->'exercise_links' from docs where k = 'orig')), 0) <> 2;
insert into fails select 'the export''s sets do not say whether they were counted', ''
where exists (select 1 from docs, jsonb_array_elements(body->'sets') s where k = 'orig' and not (s ? 'counted'));

do $$
declare doc jsonb; res jsonb; back jsonb;
begin
  delete from public.chronicle_exercise_links where owner = (select me from subject);
  delete from public.chronicle_sets where owner = (select me from subject);
  doc := jsonb_build_object('kind', 'chronicle', 'version', 1,
           'exercise_links', (select body->'exercise_links' from docs where k = 'orig'),
           'sets', (select body->'sets' from docs where k = 'orig'));
  perform set_config('role', 'authenticated', true);
  res := public.chronicle_import(doc);
  back := public.chronicle_export();
  perform set_config('role', 'postgres', true);
  if back->'exercise_links' is distinct from (select body->'exercise_links' from docs where k = 'orig')
     or back->'sets' is distinct from (select body->'sets' from docs where k = 'orig') then
    insert into fails values ('the round trip changed the links or the sets', res::text);
  end if;
  if (res->>'links')::int is distinct from 2 then
    insert into fails values ('the import did not count the links', res::text);
  end if;
  -- a tampered file: Plank linked to Gym, which the units refuse here
  delete from public.chronicle_exercise_links where owner = (select me from subject);
  doc := jsonb_build_object('kind', 'chronicle', 'version', 1, 'exercise_links', jsonb_build_array(
           jsonb_build_object('person', 'lk-mine', 'exercise', 'ex-plank', 'activity', (select v from ids where k = 'gym')),
           jsonb_build_object('person', 'lk-theirs', 'exercise', 'ex-quad', 'activity', (select v from ids where k = 'gym'))));
  perform set_config('role', 'authenticated', true);
  res := public.chronicle_import(doc);
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.chronicle_exercise_links where owner = (select me from subject)) or (res->>'links')::int <> 0 then
    insert into fails values ('a file linked what the units or the owner refuse', res::text);
  end if;
exception when others then insert into fails values ('the round trip raised', sqlerrm);
end $$;
reset role;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  /* coalesce, or a check with no detail vanishes from the list while still being counted */
  select count(*), string_agg('  - ' || check_name || ': ' || coalesce(detail, ''), E'\n') into n, msg from fails;
  if n > 0 then raise exception E'CHRONICLE SET LINKS FAILED -- % check(s):\n%', n, msg; end if;
end $$;

select 'an exercise counts toward an activity only where the units agree, and once' as result, count(*) as failures from fails;

rollback;
