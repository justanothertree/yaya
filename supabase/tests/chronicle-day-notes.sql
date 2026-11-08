-- A note with no sitting — asked of the real functions as a member, and of a friend's readers.
--
-- ⛔ A THROWAWAY DATABASE ONLY, and one docs/2026-11-08-chronicle-day-notes.DRAFT.sql has been
-- applied to first. The draft is not a migration, so CI's database does not have it and this file
-- is NOT run by the `db guards` job; a scratch branch applies the draft and then runs this. It
-- writes inside a transaction that always rolls back, and is never pointed at production.
--
-- WHAT IT IS EVIDENCE OF: the real Postgres functions under a seeded member's role and JWT claim,
-- which this file sets itself. NOT Supabase Auth, NOT PostgREST, NOT a browser.
--
-- Evan's three rules for these (OPEN-DECISIONS §14b), and how each is asked:
--   private by default       another member reads none of it and can change none of it
--   in the export            every field round-tripped, then dropped one at a time; a second
--                            put-back writes nothing twice
--   never automatically      (1) a census: every function that names chronicle_notes is on a list
--   on anybody's timeline        of your-own-only readers and writers, so a new reader cannot
--                                start carrying notes without this file being changed on purpose
--                            (2) a FRIEND asks every reader of other people's days — and the test
--                                insists those readers DID return this member's shared sitting,
--                                so "the words are not there" is not the answer of an empty room
-- On failure it raises, naming every check that failed. A green run prints one row.

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
create temp table words(k text primary key, w text);
insert into words values
  ('day',     'DAY-NOTE-' || md5(random()::text)),
  ('sitting', 'SITTING-NOTE-' || md5(random()::text));
create temp table days as select (now() at time zone 'utc')::date as today;
grant select on subject, words, days to authenticated, anon;
grant select, insert on fails to authenticated, anon;
grant select, insert, update on ids to authenticated, anon;

-- ── 0. the draft, and two members who are FRIENDS, or the timeline half asks nobody ──────────
do $$
begin
  if to_regprocedure('public.chronicle_day_note_add(date, text)') is null then
    raise exception 'apply docs/2026-11-08-chronicle-day-notes.DRAFT.sql before this file';
  end if;
end $$;
insert into fails select 'FIXTURE: no member to act as', 'seed the database first'
where (select me from subject) is null;
insert into fails select 'FIXTURE: the two members are not friends',
       'a friend''s readers are the whole point of section C'
/* ⚠️ THE TABLE, NOT are_friends: that helper answers only about the CALLER, and here the caller
   is nobody — so it said "not friends" about a pair the seed makes friends on purpose */
where not exists (select 1 from public.friendships f
                   where f.status = 'accepted'
                     and f.user_a = least((select me from subject), (select other from subject))
                     and f.user_b = greatest((select me from subject), (select other from subject)));

-- ── A. no door for anon, a door for a member, and a table that is still deny-all ───────────
insert into fails select 'anon can execute', f
from (values ('public.chronicle_day_note_add(date, text)'),
             ('public.chronicle_day_notes_between(date, date)')) fs(f)
where has_function_privilege('anon', f, 'execute');
insert into fails select 'a member cannot execute', f
from (values ('public.chronicle_day_note_add(date, text)'),
             ('public.chronicle_day_notes_between(date, date)')) fs(f)
where not has_function_privilege('authenticated', f, 'execute');
insert into fails
select 'chronicle_notes grants ' || pv || ' to ' || r, 'it should be reached only by functions'
from (values ('anon'), ('authenticated')) rs(r),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) ps(pv)
where has_table_privilege(r, 'public.chronicle_notes', pv);

-- ── B. as the member: a note for today, read back, changed, refused ────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
begin
  insert into ids values ('note', public.chronicle_day_note_add((select today from days),
                                                                (select w from words where k = 'day')));
exception when others then insert into fails values ('writing a day note raised', sqlerrm);
end $$;

do $$
declare got jsonb;
begin
  got := public.chronicle_day_notes_between((select today from days), (select today from days) + 1);
  if jsonb_array_length(got) <> 1
     or got->0->>'body' <> (select w from words where k = 'day')
     or got->0->>'on' <> to_char((select today from days), 'YYYY-MM-DD') then
    insert into fails values ('reading today''s note back', got::text);
  end if;
exception when others then insert into fails values ('reading day notes raised', sqlerrm);
end $$;

create temp table tries(what text, day_shift int, body text, want text);
grant select on tries to authenticated, anon;
insert into tries values
  ('an empty note',              0, '   ',               'nothing to write down'),
  ('a note longer than 4000',    0, repeat('x', 4001),   'that is longer than a note — 4000 characters'),
  ('a day that has not come',    3, 'too soon',          'that day has not come yet'),
  ('a day with no date',         null, 'no day',         'that day has not come yet');

do $$
declare t record; got text;
begin
  for t in select * from tries loop
    got := null;
    begin
      perform public.chronicle_day_note_add((select today from days) + t.day_shift, t.body);
    exception when others then got := sqlerrm;
    end;
    if got is distinct from t.want then
      insert into fails values ('refusing ' || t.what, coalesce(got, 'it was accepted'));
    end if;
  end loop;
  -- fifty to a day: forty-nine more fit, the fifty-first does not
  got := null;
  begin
    for i in 1..49 loop
      perform public.chronicle_day_note_add((select today from days) - 5, 'filler ' || i);
    end loop;
    perform public.chronicle_day_note_add((select today from days) - 5, 'the fiftieth');
    perform public.chronicle_day_note_add((select today from days) - 5, 'the fifty-first');
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'that is 50 notes on one day' then
    insert into fails values ('refusing a fifty-first note on one day', coalesce(got, 'it was accepted'));
  end if;
  -- the reader's two refusals, in chronicle_entries_between's words
  got := null;
  begin perform public.chronicle_day_notes_between((select today from days), (select today from days));
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that range ends before it starts' then
    insert into fails values ('refusing an empty range', coalesce(got, 'it was accepted'));
  end if;
  got := null;
  begin perform public.chronicle_day_notes_between((select today from days) - 401, (select today from days));
  exception when others then got := sqlerrm; end;
  if got is distinct from 'that is too long a range' then
    insert into fails values ('refusing a range past 400 days', coalesce(got, 'it was accepted'));
  end if;
end $$;
reset role;

-- another member: reads none of it, changes none of it
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare got jsonb; err text;
begin
  got := public.chronicle_day_notes_between((select today from days) - 10, (select today from days) + 1);
  if got::text like '%' || (select w from words where k = 'day') || '%' then
    insert into fails values ('another member read my day note', 'through chronicle_day_notes_between');
  end if;
  begin
    perform public.chronicle_note_edit((select v from ids where k = 'note'), 'not yours');
  exception when others then err := sqlerrm;
  end;
  if err is distinct from 'no such note' then
    insert into fails values ('another member editing my day note', coalesce(err, 'it was accepted'));
  end if;
  perform public.chronicle_note_drop((select v from ids where k = 'note'));
exception when others then insert into fails values ('the other member''s attempts raised', sqlerrm);
end $$;
reset role;
insert into fails select 'another member''s edit or drop reached my day note', coalesce(body, 'gone')
from (select (select body from public.chronicle_notes where id = (select v from ids where k = 'note')) as body) x
where body is distinct from (select w from words where k = 'day');

-- the table's own rule: a sitting OR a day, never both and never neither
do $$
declare got text;
begin
  begin
    insert into public.chronicle_notes (owner, entry, on_day, body)
    values ((select me from subject), null, null, 'nowhere');
  exception when check_violation then got := 'refused';
  end;
  if got is distinct from 'refused' then
    insert into fails values ('a note with neither a sitting nor a day was stored', 'chronicle_note_placed');
  end if;
end $$;

-- ── C. never on anybody's timeline ─────────────────────────────────────────────────────────
-- (1) the census: who may even name the table
insert into fails
select 'a function that is not on the list names chronicle_notes', p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~* 'chronicle_notes'
  and p.proname not in (
    -- your own, by auth.uid(), and nothing else
    'chronicle_note_add', 'chronicle_note_edit', 'chronicle_note_drop',
    'chronicle_day_note_add', 'chronicle_day_notes_between',
    'chronicle_entries_between', 'chronicle_entry_add', 'chronicle_stop',
    'chronicle_export', 'chronicle_import');

-- (2) a friend asks, about a member who IS sharing a sitting today — with a note on it as well
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
do $$
declare a uuid; e uuid;
begin
  a := public.chronicle_activity_save(null, 'Day-notes shared work', 'free', null, null, null, null);
  /* ⚠️ THE TIER IS SET BY ITS OWN SETTER. chronicle_activity_save reads p_shared on an update only,
     so passing true on the insert left the activity private — and the friend's log empty, which
     the fixture check below caught before it could pass for privacy */
  perform public.chronicle_activity_set_visibility(a, 'friends');
  perform public.chronicle_share_timeline(true);
  e := public.chronicle_start(a);
  perform pg_sleep(1.1);
  perform public.chronicle_note_add(e, (select w from words where k = 'sitting'));
  perform public.chronicle_stop(null);
exception when others then insert into fails values ('sharing a sitting raised', sqlerrm);
end $$;
reset role;
insert into public.profile_blocks (user_id, block_type, position, config, visibility)
values ((select me from subject), 'chronicle', 0, '{"goals": true, "live": true}', 'members');

create temp table seen(reader text, says text);
grant select, insert on seen to authenticated, anon;
select set_config('request.jwt.claims',
  json_build_object('sub', (select other::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
/* ⚠️ ONE HANDLER PER READER: a reader that raises must not take the others' answers with it */
do $$
declare uname text := (select username::text from public.profiles where user_id = (select me from subject));
begin
  begin
    insert into seen values ('chronicle_friends_log',
      public.chronicle_friends_log(now() - interval '2 days', now() + interval '1 day')::text);
  exception when others then insert into seen values ('chronicle_friends_log', 'RAISED ' || sqlerrm);
  end;
  begin
    insert into seen values ('get_member_chronicle', public.get_member_chronicle(uname, 90)::text);
  exception when others then insert into seen values ('get_member_chronicle', 'RAISED ' || sqlerrm);
  end;
  begin
    insert into seen values ('get_member_activity', public.get_member_activity(uname, 50)::text);
  exception when others then insert into seen values ('get_member_activity', 'RAISED ' || sqlerrm);
  end;
  begin
    insert into seen values ('feed_recent', public.feed_recent()::text);
  exception when others then insert into seen values ('feed_recent', 'RAISED ' || sqlerrm);
  end;
end $$;
reset role;

-- ⚠️ THE ROOM MUST NOT BE EMPTY: the friend's log has to have carried the shared sitting, or the
-- absence of the words below says nothing
insert into fails select 'FIXTURE: the friend''s log did not carry the shared sitting', coalesce(says, 'null')
from seen where reader = 'chronicle_friends_log' and coalesce(says, '') not like '%Day-notes shared work%';
insert into fails select 'FIXTURE: the profile card came back empty', coalesce(says, 'null')
from seen where reader = 'get_member_chronicle' and (says is null or says like 'RAISED%');
/* what the other two said, printed — a refusal is not a leak, but it should be seen */
select reader, left(coalesce(says, 'null'), 120) as says from seen order by reader;
insert into fails select 'a friend''s ' || reader || ' carried a ' || k || ' note', left(says, 200)
from seen, words where says like '%' || w || '%';

-- ── D. the export carries every field, and the import puts each back once ──────────────────
/* every field away from its default: written three days ago about the day before that */
update public.chronicle_notes set at = now() - interval '3 days', on_day = (select today from days) - 4
 where id = (select v from ids where k = 'note');

create temp table docs(k text primary key, d jsonb);
create temp table drops(field text);
insert into drops values (null), ('on_day'), ('at'), ('body');
grant select, insert on docs, drops to authenticated, anon;

select set_config('request.jwt.claims',
  json_build_object('sub', (select me::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin insert into docs values ('orig', public.chronicle_export()); end $$;
reset role;

create temp view mine as
  select x from docs, jsonb_array_elements(d->'day_notes') x
   where k = 'orig' and x->>'body' = (select w from words where k = 'day');
grant select on mine to authenticated, anon;
insert into fails select 'the export does not carry the day note', coalesce((select d->'day_notes' from docs)::text, 'no list')
where (select count(*) from mine) <> 1;
insert into fails select 'the export''s day note is missing a field', f
from (values ('on_day'), ('at'), ('body')) fs(f) where not ((select x from mine) ? f);
insert into fails select 'the export carries a note id', 'an id is this account''s and a file is not'
where (select x from mine) ? 'id';

do $$
declare t record; doc jsonb; back jsonb; res jsonb; again jsonb;
begin
  for t in select * from drops loop
    delete from public.chronicle_notes
     where owner = (select me from subject) and entry is null
       and body = (select w from words where k = 'day');
    doc := jsonb_build_object('kind', 'chronicle', 'version', 1,
                              'day_notes', jsonb_build_array(
                                case when t.field is null then (select x from mine)
                                     else (select x from mine) - t.field end));
    perform set_config('role', 'authenticated', true);
    res := public.chronicle_import(doc);
    back := (select x from jsonb_array_elements(public.chronicle_export()->'day_notes') x
              where x->>'body' = (select w from words where k = 'day'));
    if t.field is null then again := public.chronicle_import(doc); end if;
    perform set_config('role', 'postgres', true);
    if t.field is null then
      if back is distinct from (select x from mine) then
        insert into fails values ('the round trip changed the day note', coalesce(back::text, 'gone'));
      end if;
      if (res->>'notes')::int is distinct from 1 then
        insert into fails values ('the import did not count the note it put back', res::text);
      end if;
      if (again->>'notes')::int is distinct from 0
         or (select count(*) from public.chronicle_notes
              where owner = (select me from subject) and body = (select w from words where k = 'day')) <> 1 then
        insert into fails values ('putting the same file back twice wrote the note twice', again::text);
      end if;
    elsif back is not distinct from (select x from mine) then
      insert into fails values ('the import does not really carry ' || t.field,
                                'dropping it from the file changed nothing');
    end if;
  end loop;
exception when others then insert into fails values ('the round trip raised', sqlerrm);
end $$;
reset role;

-- a file cannot put a note on a day that has not come
do $$
declare res jsonb;
begin
  perform set_config('role', 'authenticated', true);
  res := public.chronicle_import(jsonb_build_object('kind', 'chronicle', 'version', 1,
           'day_notes', jsonb_build_array(jsonb_build_object(
             'on_day', (select today from days) + 5, 'at', now(), 'body', 'from the future'))));
  perform set_config('role', 'postgres', true);
  if (res->>'notes')::int is distinct from 0
     or exists (select 1 from public.chronicle_notes where body = 'from the future') then
    insert into fails values ('a file put a note on a day that has not come', res::text);
  end if;
exception when others then insert into fails values ('the future import raised', sqlerrm);
end $$;
reset role;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'CHRONICLE DAY NOTES FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'a note with no sitting stays yours' as result, count(*) as failures from fails;

rollback;
