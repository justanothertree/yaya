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

-- ⚠️ AND THE SUBJECT MUST HAVE AN ACCEPTED FRIEND, which is a new requirement and the
-- reason is the `certain` list. The list stores usernames and the import only keeps a name that
-- is still an accepted friend -- so a subject with no friends would restore an EMPTY list from a
-- file that had one in it, and the field below would report "not checked" while looking thorough.
-- A fixture that cannot hold the value being tested is the trap §2 names: the one dimension under
-- test, pinned flat.
create temp table subject as
  select p.user_id as uid, p.username::text as u,
         (select f2.user_id from public.profiles f2
           where coalesce(f2.suspended,false) = false
             and exists (select 1 from public.friendships f
                          where f.status = 'accepted'
                            and f.user_a = least(p.user_id, f2.user_id)
                            and f.user_b = greatest(p.user_id, f2.user_id))
           order by f2.username limit 1) as friend,
         (select f2.username::text from public.profiles f2
           where coalesce(f2.suspended,false) = false
             and exists (select 1 from public.friendships f
                          where f.status = 'accepted'
                            and f.user_a = least(p.user_id, f2.user_id)
                            and f.user_b = greatest(p.user_id, f2.user_id))
           order by f2.username limit 1) as friend_u
    from public.profiles p
   where coalesce(p.suspended,false) = false
     and not exists (select 1 from public.chronicle_activities a where a.owner = p.user_id)
     and not exists (select 1 from public.chronicle_entries e where e.owner = p.user_id)
     and exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and (f.user_a = p.user_id or f.user_b = p.user_id))
   order by p.username
   limit 1;

do $$
begin
  if not exists (select 1 from subject) then
    raise exception 'FIXTURE: this test needs a member with no chronicle rows and one accepted friend';
  end if;
  if (select friend from subject) is null then
    raise exception 'FIXTURE: the subject has no accepted friend, so the certain list cannot be tested';
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

-- ⚠️ AND THE TWO `certain` ITEMS GET A LIST, because an empty one is the DEFAULT and a
-- round trip is only worth the fields whose fixture value differs from it. Written directly
-- rather than through `visibility_certain_set`, which would need a session; the rule it keeps
-- (accepted friends only) is satisfied by the subject selection above.
insert into public.visibility_certain (owner, item_kind, item_id, friend)
select uid, 'chronicle_activity', '11111111-1111-4111-8111-111111111111', friend from subject
union all
select uid, 'chronicle_goal', '22222222-2222-4222-8222-222222222222', friend from subject;

create temp table before_rows as select
  (select jsonb_agg(to_jsonb(a)-'owner' order by a.id) from public.chronicle_activities a where a.owner=(select uid from subject)) as acts,
  (select jsonb_agg(to_jsonb(g)-'owner' order by g.id) from public.chronicle_goals g where g.owner=(select uid from subject)) as goals,
  (select jsonb_agg(to_jsonb(p)-'owner' order by p.id) from public.chronicle_plans p where p.owner=(select uid from subject)) as plans,
  (select jsonb_agg(to_jsonb(r)-'owner' order by r.id) from public.chronicle_routines r where r.owner=(select uid from subject)) as routines,
  /* the Certain lists, as item -> username, because the list lives in its own table and the
     four columns above cannot see it */
  (select jsonb_agg(vc.item_kind || ':' || vc.item_id || ':' || p.username::text
                    order by vc.item_kind, vc.item_id, p.username)
     from public.visibility_certain vc join public.profiles p on p.user_id = vc.friend
    where vc.owner=(select uid from subject)) as lists;

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
  (select jsonb_agg(to_jsonb(r)-'owner' order by r.id) from public.chronicle_routines r where r.owner=(select uid from subject)) as routines,
  /* the Certain lists, as item -> username, because the list lives in its own table and the
     four columns above cannot see it */
  (select jsonb_agg(vc.item_kind || ':' || vc.item_id || ':' || p.username::text
                    order by vc.item_kind, vc.item_id, p.username)
     from public.visibility_certain vc join public.profiles p on p.user_id = vc.friend
    where vc.owner=(select uid from subject)) as lists;

insert into out
select 'part 1', t.f,
       case when t.ok then 'identical' else 'MISMATCH' end
from (values
  ('activities', (select acts from before_rows) is not distinct from (select acts from after_rows)),
  ('goals',      (select goals from before_rows) is not distinct from (select goals from after_rows)),
  ('plans',      (select plans from before_rows) is not distinct from (select plans from after_rows)),
  ('routines',   (select routines from before_rows) is not distinct from (select routines from after_rows)),
  ('certain lists', (select lists from before_rows) is not distinct from (select lists from after_rows))
) as t(f, ok);

-- ── part 2: drop each field in turn and watch it go red ─────────────────────────────────────
-- A field that cannot be made to fail is a field this test does not actually check.
--
-- ⚠️ AND `certain` IS THE FIELD THAT FORCED THE COMPARISON TO WIDEN. It is the one
-- exported value that does not live on the activity's or goal's ROW -- the list is rows in
-- `visibility_certain` -- so a comparison of the two tables could not see it, and adding the
-- field to the arrays below would have reported "not checked" about a value the import really
-- does restore. Both snapshots carry the lists now and part 2 compares rows AND lists together.
-- Measured 3 Nov 2026: `certain` reports `carried` for both kinds, 28 of 30 fields carried, and
-- the two exceptions are the `shared` pair below.
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
                        'session_mins','shared','visibility','certain']) as fld, 'activity' as k
    union all
    select unnest(array['title','scope','anchor','repeat_every','target','unit','progress',
                        'done_at','note','sort','counts','est_mins','priority','shared',
                        'visibility','certain']), 'goal'
  loop
    f := r.fld; which := r.k;
    delete from public.chronicle_goals where owner=(select uid from subject);
    delete from public.chronicle_activities where owner=(select uid from subject);
    /* the lists go with their items -- the AFTER DELETE triggers see to that -- but say so
       rather than rely on it, because a list left behind would make every later round of this
       loop compare against a leftover */
    delete from public.visibility_certain where owner=(select uid from subject);
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
    /* ⚠️ ROWS AND LISTS COMPARED TOGETHER, because `certain` is the one exported field
       that does not live on the row. It used to compare only the activities or only the goals,
       which is why adding the field to the arrays above would have reported "not checked" about
       a value the import does restore. Comparing both kinds at once costs nothing -- the loop
       only ever perturbs one of them -- and catches a perturbation that reaches across. */
    select jsonb_build_array(
             (select jsonb_agg(to_jsonb(a)-'owner' order by a.id) from public.chronicle_activities a
               where a.owner=(select uid from subject)),
             (select jsonb_agg(to_jsonb(g)-'owner' order by g.id) from public.chronicle_goals g
               where g.owner=(select uid from subject)),
             (select jsonb_agg(vc.item_kind || ':' || vc.item_id || ':' || pr.username::text
                               order by vc.item_kind, vc.item_id, pr.username)
                from public.visibility_certain vc
                join public.profiles pr on pr.user_id = vc.friend
               where vc.owner=(select uid from subject))
           )
           is not distinct from
           jsonb_build_array((select acts from before_rows), (select goals from before_rows),
                             (select lists from before_rows))
      into same;
    insert into out values ('part 2 · ' || which, f,
      case when same then 'NOT CHECKED - dropping it changed nothing' else 'carried' end);
  end loop;
end $$;

select part, field, verdict from out order by part, field;

rollback;
