-- The Chronicle daily flow, asked of the real functions as a signed-in member.
--
-- ⛔ A THROWAWAY DATABASE ONLY. This file WRITES — two activities, a goal, sittings, notes and
-- amounts for a seeded member — inside a transaction that always rolls back. That makes it safe in
-- principle anywhere, and it is still not to be pointed at production: the standing instruction for
-- this repository is that account-writing tests and fixtures do not run there, rolled back or not.
-- The place it is meant for is the `db guards` CI job, which builds a database from these
-- migrations and supabase/seed.sql with `supabase start` + `supabase db reset` and has no
-- production credential of any kind.
--
-- WHY IT EXISTS: everything the Chronicle drafts (#33 onwards) do on screen was verified against
-- the preview double, which is a copy of the server written by hand. A double agreeing with a room
-- is one source, not two. This asks the FUNCTIONS, as a member, the questions the room's flow
-- depends on:
--
--   start, switch, and a mis-press that leaves no trace          chronicle_start
--   a note on the sitting it was written about, open or closed   chronicle_note_add
--   a count that saves as a number, and saves the same twice     chronicle_entry_amount
--   what the room reads back after a refresh                     chronicle_entries_between
--   a goal counting that number exactly once                     chronicle_tally
--   stop, keeping the count and the notes                        chronicle_stop
--   and another member, refused at every one of those doors
--
-- WHAT IT DOES ON FAILURE: raises, naming every check that failed. A green run prints one row.
--
-- ⚠️ THE SLEEPS ARE THE POINT, NOT PADDING. `chronicle_start` deletes an open sitting younger than
-- one second ("a mis-press leaves no trace") and closes an older one. Inside one transaction
-- `clock_timestamp()` still advances in real time, so `pg_sleep(1.1)` is what makes a switch a
-- switch rather than a mis-press — and leaving it out is how the mis-press check is made to happen.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v uuid);
create temp table subject as
  select (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false
           order by p.username limit 1) as me,
         (select p.user_id from public.profiles p
           where coalesce(p.suspended, false) = false
           order by p.username offset 1 limit 1) as other;
grant select on subject to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. THE FIXTURES MUST EXIST, OR EVERY CHECK BELOW PASSES BY TESTING NOTHING ──────────────
insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;
insert into fails select 'FIXTURE: no second member', 'the refusals below would ask nobody'
where (select other from subject) is null or (select other from subject) = (select me from subject);
insert into fails select 'FIXTURE: the member already has a running sitting',
       'the "exactly one open" checks would be about somebody else''s timer'
where exists (select 1 from public.chronicle_entries e
               where e.owner = (select me from subject) and e.ended_at is null);

-- ── A. anon reaches none of the doors the flow uses ────────────────────────────────────────
insert into fails
select 'anon can execute', f
from (values ('public.chronicle_start(uuid)'),
             ('public.chronicle_stop(text)'),
             ('public.chronicle_note_add(uuid, text)'),
             ('public.chronicle_entry_amount(uuid, numeric)'),
             ('public.chronicle_entries_between(timestamptz, timestamptz)'),
             ('public.chronicle_tally(jsonb)')) fs(f)
where has_function_privilege('anon', f, 'execute');

-- ── B. as the member: start, switch, a mis-press ───────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare a uuid; b uuid; e1 uuid; e2 uuid; e3 uuid;
begin
  a := public.chronicle_activity_save(null, 'Flow check A', 'free', null, 'reps', null, null);
  b := public.chronicle_activity_save(null, 'Flow check B', 'life', null, null, null, null);
  insert into ids values ('act_a', a), ('act_b', b);

  e1 := public.chronicle_start(a);
  e2 := public.chronicle_start(b);   -- PERTURBED: no sleep, so this switch is a mis-press   -- e1 is over a second old: closed, not deleted
  e3 := public.chronicle_start(a);   -- e2 is not: a mis-press, deleted, no trace
  insert into ids values ('e1', e1), ('e2', e2), ('e3', e3);
exception when others then
  insert into fails values ('the start/switch sequence raised', sqlerrm);
end $$;

reset role;

insert into fails select 'switching did not close the first sitting', 'e1 has no end'
where not exists (select 1 from public.chronicle_entries
                   where id = (select v from ids where k = 'e1') and ended_at is not null);
insert into fails select 'a mis-press left a trace', 'e2 still exists'
where exists (select 1 from public.chronicle_entries where id = (select v from ids where k = 'e2'));
insert into fails select 'the latest start is not the one running', 'e3 is not open'
where not exists (select 1 from public.chronicle_entries
                   where id = (select v from ids where k = 'e3') and ended_at is null);
insert into fails select 'more than one sitting open', count(*)::text
from public.chronicle_entries where owner = (select me from subject) and ended_at is null
having count(*) <> 1;
-- the record stays continuous: the switch closes one and opens the next in the same breath
insert into fails select 'a gap or an overlap at the switch', (e3.started_at - e1.ended_at)::text
from public.chronicle_entries e1, public.chronicle_entries e3
where e1.id = (select v from ids where k = 'e1') and e3.id = (select v from ids where k = 'e3')
  and (e3.started_at < e1.ended_at or e3.started_at - e1.ended_at > interval '1 second');

-- ── C. notes, a count, and what a refresh reads back ───────────────────────────────────────
set local role authenticated;

do $$
declare e1 uuid := (select v from ids where k = 'e1');
        e3 uuid := (select v from ids where k = 'e3');
        a uuid := (select v from ids where k = 'act_a');
        day_from timestamptz := date_trunc('day', now());
        back jsonb; one jsonb; t jsonb; g uuid;
begin
  perform public.chronicle_note_add(e1, 'written about the closed one');
  perform public.chronicle_note_add(e3, 'written while it runs');

  -- an ABSOLUTE write: the same number twice is the same number, never double
  perform public.chronicle_entry_amount(e3, 9);
  perform public.chronicle_entry_amount(e3, 9);

  -- what the room reads after a refresh
  back := public.chronicle_entries_between(now() - interval '1 day', now() + interval '1 day');
  select x into one from jsonb_array_elements(back) x where (x->>'id')::uuid = e3;
  if one is null then
    insert into fails values ('the running sitting is not read back', 'e3 missing');
  else
    if (one->>'amount')::numeric is distinct from 9 then
      insert into fails values ('the count did not save as 9', coalesce(one->>'amount', 'null'));
    end if;
    if one->>'end' is not null then
      insert into fails values ('the running sitting reads back as ended', one->>'end');
    end if;
    if jsonb_array_length(one->'notes') <> 1 then
      insert into fails values ('the running sitting''s note', jsonb_array_length(one->'notes')::text);
    end if;
  end if;
  select x into one from jsonb_array_elements(back) x where (x->>'id')::uuid = e1;
  if one is null or jsonb_array_length(one->'notes') <> 1
     or one->'notes'->0->>'body' <> 'written about the closed one' then
    insert into fails values ('the note did not stay on the sitting it was written about',
                              coalesce(one::text, 'e1 missing'));
  end if;

  -- a goal counting A's reps, today: 9, once — not 18 after the second write
  g := public.chronicle_goal_save(null, 'Flow check goal', 'day', null, 1, 5, 'reps', null, 0,
                                  a, null, 'amount', null, 0);
  insert into ids values ('goal', g);
  t := public.chronicle_tally(jsonb_build_array(jsonb_build_object(
         'key', 'today', 'id', g, 'from', day_from, 'to', day_from + interval '1 day')));
  if (t->>'today')::numeric is distinct from 9 then
    insert into fails values ('the goal did not count the reps exactly once', coalesce(t->>'today', 'null'));
  end if;

  -- stop, after a second so it closes rather than vanishes
  perform pg_sleep(1.1);
  perform public.chronicle_stop(null);
exception when others then
  insert into fails values ('the notes/count/tally sequence raised', sqlerrm);
end $$;

reset role;

insert into fails select 'stop did not close the sitting', 'e3 still open'
where exists (select 1 from public.chronicle_entries
               where id = (select v from ids where k = 'e3') and ended_at is null);
insert into fails select 'stop lost the count', coalesce(amount::text, 'null')
from public.chronicle_entries where id = (select v from ids where k = 'e3')
  and amount is distinct from 9;
insert into fails select 'stop lost the note', count(*)::text
from public.chronicle_notes where entry = (select v from ids where k = 'e3')
having count(*) <> 1;

-- ── D. another member, refused at every door ───────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare e1 uuid := (select v from ids where k = 'e1');
        e3 uuid := (select v from ids where k = 'e3');
        a uuid := (select v from ids where k = 'act_a');
        back jsonb;
begin
  begin
    perform public.chronicle_note_add(e1, 'not yours');
    insert into fails values ('another member wrote a note on somebody''s sitting', 'it was accepted');
  exception when others then null; end;
  begin
    perform public.chronicle_entry_amount(e3, 1);
    insert into fails values ('another member changed somebody''s count', 'it was accepted');
  exception when others then null; end;
  begin
    perform public.chronicle_start(a);
    insert into fails values ('another member started somebody''s activity', 'it was accepted');
  exception when others then null; end;
  back := public.chronicle_entries_between(now() - interval '1 day', now() + interval '1 day');
  if exists (select 1 from jsonb_array_elements(back) x
              where (x->>'id')::uuid in (e1, e3)) then
    insert into fails values ('another member can read somebody''s sittings', 'they came back');
  end if;
end $$;

reset role;

insert into fails select 'a refused write still landed', 'count is ' || coalesce(amount::text, 'null')
from public.chronicle_entries where id = (select v from ids where k = 'e3') and amount is distinct from 9;
insert into fails select 'a refused note still landed', count(*)::text
from public.chronicle_notes where entry = (select v from ids where k = 'e1') having count(*) <> 1;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'CHRONICLE FLOW FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'the chronicle daily flow holds' as result, count(*) as failures from fails;

rollback;
