-- Does a chronicle survive export -> import unchanged, field by field?
--
-- HOW TO RUN: paste into the SQL editor or hand to execute_sql. Needs a connection that can
-- write (it builds a fixture and creates temp tables); everything is inside a transaction that
-- rolls back. The fixture is built for a member who has NO chronicle rows, so nobody's real
-- data is exported, deleted or re-inserted.
--
-- ⚠️ THE FIXTURE SETS EVERY FIELD AWAY FROM ITS DEFAULT, and that is the method rather than
-- thoroughness for its own sake. A round trip is only worth the fields the fixture fills: a
-- column left at its default comes back looking correct whether it was carried or not, so the
-- test passes and says nothing. CLAUDE.md names this twice — 34 green tests over a fixture with
-- no ratings in it, and a sorted list that proved nothing because the fixture was already
-- sorted.
--
-- ⚠️ TWO GOALS, BECAUSE ONE CANNOT HOLD EVERY FIELD. `chronicle_goal_window` forbids `anchor`
-- and `repeat_every` on the same row, and `chronicle_goal_one_source` forbids `activity` and
-- `cat`. A single fixture goal would silently leave two fields at their defaults — which is the
-- exact failure this file is about.
--
-- ⚠️ AND THE TIER FIXTURE SITS AT `certain` ON PURPOSE. At `friends`, `shared = true` reproduces
-- the tier exactly, so dropping `visibility` changes nothing and part 2 cannot tell a carried
-- field from a derived one. `certain` is the only level the boolean cannot express. The first
-- run of this test used a `friends` goal and reported `visibility` as NOT CHECKED — the
-- perturbation is only ever as sharp as the fixture's values.

begin;

create temp table subject as
  select p.user_id as uid, p.username::text as u
    from public.profiles p
   where coalesce(p.suspended,false) = false
     and not exists (select 1 from public.chronicle_activities a where a.owner = p.user_id)
     and not exists (select 1 from public.chronicle_entries e where e.owner = p.user_id)
   order by p.username
   limit 1;

do $$
begin
  if not exists (select 1 from subject) then
    raise exception 'FIXTURE: every member already has chronicle rows; this test needs an empty one';
  end if;
end $$;

create temp table doc(d jsonb);
create temp table rep(r jsonb);
create temp table out(part text, field text, verdict text);
grant select, insert on doc to authenticated;
grant select, insert on rep to authenticated;
grant select on subject to authenticated;

-- ── the fixture ─────────────────────────────────────────────────────────────────────────────
insert into public.chronicle_activities
  (id, owner, name, cat, colour, archived_at, created_at, auto, metric, session_mins, visibility)
select '11111111-1111-4111-8111-111111111111', uid, 'Round Trip', 'life', '#abcdef',
       '2026-01-02T03:04:05Z'::timestamptz, '2025-12-31T00:00:00Z'::timestamptz,
       true, 'pages', 45, 'certain' from subject;

-- goal A: repeat_every + activity + amount, at `certain`
insert into public.chronicle_goals
  (id, owner, title, scope, repeat_every, target, unit, progress, done_at, note, sort,
   activity, counts, est_mins, priority, created_at, updated_at, visibility)
select '22222222-2222-4222-8222-222222222222', uid, 'Repeating Goal', 'week', 2, 12.5, 'pages',
       3.5, '2026-02-10T11:12:13Z'::timestamptz, 'a note that is not null', 7,
       '11111111-1111-4111-8111-111111111111', 'amount', 90, 2,
       '2025-11-30T00:00:00Z'::timestamptz, '2026-01-15T00:00:00Z'::timestamptz, 'certain'
from subject;

-- goal B: anchor + cat + minutes, at `friends` — covers the fields goal A cannot
insert into public.chronicle_goals
  (id, owner, title, scope, anchor, target, unit, progress, note, sort, cat, counts, priority, visibility)
select '66666666-6666-4666-8666-666666666666', uid, 'Anchored Goal', 'month',
       '2026-02-03'::date, 5, 'hours', 1.25, 'another note', 3, 'free', 'minutes', 1, 'friends'
from subject;

insert into public.chronicle_routines (id, owner, name, steps, created_at, updated_at)
select '33333333-3333-4333-8333-333333333333', uid, 'Round Trip Routine',
       '[{"activity":"x","mins":10}]'::jsonb,
       '2025-10-01T00:00:00Z'::timestamptz, '2025-10-02T00:00:00Z'::timestamptz from subject;

insert into public.chronicle_entries
  (id, owner, activity, started_at, ended_at, amount, quality, created_at)
select '55555555-5555-4555-8555-555555555555', uid, '11111111-1111-4111-8111-111111111111',
       '2026-02-01T09:00:00Z'::timestamptz, '2026-02-01T10:30:00Z'::timestamptz,
       33.5, 4, '2026-02-01T10:31:00Z'::timestamptz from subject;

insert into public.chronicle_plans (id, owner, activity, starts_at, ends_at, note, created_at)
select '44444444-4444-4444-8444-444444444444', uid, '11111111-1111-4111-8111-111111111111',
       '2026-03-01T08:00:00Z'::timestamptz, '2026-03-01T09:00:00Z'::timestamptz,
       'a plan note', '2026-02-20T00:00:00Z'::timestamptz from subject;

create temp table before_rows as select
  (select jsonb_agg(to_jsonb(a)-'owner' order by a.id) from public.chronicle_activities a where a.owner=(select uid from subject)) as acts,
  (select jsonb_agg(to_jsonb(g)-'owner' order by g.id) from public.chronicle_goals g where g.owner=(select uid from subject)) as goals,
  (select jsonb_agg(to_jsonb(p)-'owner' order by p.id) from public.chronicle_plans p where p.owner=(select uid from subject)) as plans,
  (select jsonb_agg(to_jsonb(r)-'owner' order by r.id) from public.chronicle_routines r where r.owner=(select uid from subject)) as routines;

select set_config('request.jwt.claims',
  json_build_object('sub', (select uid::text from subject), 'role','authenticated')::text, true);
set local role authenticated;
insert into doc select public.chronicle_export();
reset role;

-- a wipe this complete is only safe because the subject had nothing before the fixture
delete from public.chronicle_plans    where owner=(select uid from subject);
delete from public.chronicle_entries  where owner=(select uid from subject);
delete from public.chronicle_goals    where owner=(select uid from subject);
delete from public.chronicle_routines where owner=(select uid from subject);
delete from public.chronicle_activities where owner=(select uid from subject);

set local role authenticated;
insert into rep select public.chronicle_import((select d from doc));
reset role;

create temp table after_rows as select
  (select jsonb_agg(to_jsonb(a)-'owner' order by a.id) from public.chronicle_activities a where a.owner=(select uid from subject)) as acts,
  (select jsonb_agg(to_jsonb(g)-'owner' order by g.id) from public.chronicle_goals g where g.owner=(select uid from subject)) as goals,
  (select jsonb_agg(to_jsonb(p)-'owner' order by p.id) from public.chronicle_plans p where p.owner=(select uid from subject)) as plans,
  (select jsonb_agg(to_jsonb(r)-'owner' order by r.id) from public.chronicle_routines r where r.owner=(select uid from subject)) as routines;

insert into out
select 'part 1', t.f,
       case when t.ok then 'identical' else 'MISMATCH' end
from (values
  ('activities', (select acts from before_rows) is not distinct from (select acts from after_rows)),
  ('goals',      (select goals from before_rows) is not distinct from (select goals from after_rows)),
  ('plans',      (select plans from before_rows) is not distinct from (select plans from after_rows)),
  ('routines',   (select routines from before_rows) is not distinct from (select routines from after_rows))
) as t(f, ok);

-- ── part 2: drop each field in turn and watch it go red ─────────────────────────────────────
-- A field that cannot be made to fail is a field this test does not actually check.
--
-- ⚠️ `shared` IS EXPECTED TO REPORT "not checked", AND THAT IS CORRECT RATHER THAN A GAP. It is
-- a derived column: the trigger computes it from `visibility`, so dropping it from the file
-- loses nothing the tier does not restore. It is listed anyway so the expectation is visible —
-- if it ever starts reporting `carried`, the two have come apart.
do $$
declare v_doc jsonb; perturbed jsonb; same boolean; f text; which text; r record;
begin
  select d into v_doc from doc;
  for r in
    select unnest(array['name','cat','colour','archived_at','created_at','auto','metric',
                        'session_mins','shared','visibility']) as fld, 'activity' as k
    union all
    select unnest(array['title','scope','anchor','repeat_every','target','unit','progress',
                        'done_at','note','sort','counts','est_mins','priority','shared',
                        'visibility']), 'goal'
  loop
    f := r.fld; which := r.k;
    delete from public.chronicle_goals where owner=(select uid from subject);
    delete from public.chronicle_activities where owner=(select uid from subject);
    if which='activity' then
      perturbed := jsonb_set(v_doc,'{activities}',
        (select jsonb_agg(e - f) from jsonb_array_elements(v_doc->'activities') e));
    else
      perturbed := jsonb_set(v_doc,'{goals}',
        (select jsonb_agg(e - f) from jsonb_array_elements(v_doc->'goals') e));
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub',(select uid::text from subject),'role','authenticated')::text, true);
    perform public.chronicle_import(perturbed);
    if which='activity' then
      select (select jsonb_agg(to_jsonb(a)-'owner' order by a.id) from public.chronicle_activities a
               where a.owner=(select uid from subject)) is not distinct from (select acts from before_rows)
        into same;
    else
      select (select jsonb_agg(to_jsonb(g)-'owner' order by g.id) from public.chronicle_goals g
               where g.owner=(select uid from subject)) is not distinct from (select goals from before_rows)
        into same;
    end if;
    insert into out values ('part 2 · ' || which, f,
      case when same then 'NOT CHECKED - dropping it changed nothing' else 'carried' end);
  end loop;
end $$;

select part, field, verdict from out order by part, field;

rollback;
