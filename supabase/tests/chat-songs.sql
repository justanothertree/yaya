-- Songs in chat (docs/2026-11-22-chat-songs.DRAFT.sql until it is applied), asked as every kind of
-- caller: who may call what, the caps, the hour's sweep, who may hear a song, that only the service
-- can mark one ready, that the Lounge stays pseudonymous, that your own list reaches songs whose
-- room you have lost, and that a song whose message goes stops counting. Each case is a real call
-- under a real role with real claims.
--
-- HOW TO RUN: db-guards.yml loads the draft in one transaction and then this file, on the
-- throwaway stack it builds (the 4 Nov dump plus supabase/seed.sql, with production's default
-- grants put back first). Everything here is in one transaction that rolls back; it leaves nothing
-- behind. It raises, listing every failed check, if anything is wrong, and says how many it asked
-- otherwise.
--
-- ⚠️ A MEMBER HOLDS NO GRANT ON chat_song_files (deny-all), so every member step asks through the
-- RPCs, exactly as a browser would. Only the steps acting as postgres touch tables directly: to
-- see what a member's call actually did, or to set a scene no member can, such as a deleted room.
--
-- ⚠️ A REFUSAL COUNTS ONLY FOR ITS OWN REASON. A claim of 5 MB and a byte that is refused because
-- the account is full, or because the room is wrong, is a fixture hiding the cap it was meant to
-- ask about. So each refusal names the words it expects.
--
-- ⚠️ IT REFUSES TO PASS BY ASKING NOTHING: block 0 checks the functions and the seed's members are
-- there before anything is asked of them, and the verdict fails any section that recorded nothing.

begin;

create temp table checks(asked_at timestamptz not null default clock_timestamp(), label text, passed boolean, detail text);
grant select, insert on checks to anon, authenticated;

/* one check, recorded; a null condition is a failure, never a pass */
create function pg_temp.ok(p_ok boolean, p_label text, p_detail text default null) returns void
language plpgsql as $$
begin
  insert into pg_temp.checks (label, passed, detail) values (p_label, coalesce(p_ok, false), p_detail);
end $$;

/* what a statement answered when refused, as 'SQLSTATE: message', or null when it went through */
create function pg_temp.refusal(p_q text) returns text
language plpgsql as $$
begin
  execute p_q;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

/* a refusal, recorded as passing only when it carries the expected words */
create function pg_temp.refused(p_q text, p_want text, p_label text) returns void
language plpgsql as $$
declare v_got text := pg_temp.refusal(p_q);
begin
  perform pg_temp.ok(v_got is not null and position(p_want in v_got) > 0, p_label,
                     coalesce(v_got, 'it went through'));
end $$;

/* who is asking. `role` is set for the transaction, as lab-nudge-guards.sql does; the session user
   is postgres, so it may always come back */
create function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

/* the edge function's service client: no member, no sub. Run as postgres, which owns every
   function; whether service_role itself holds execute is asked in section 1 */
create function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'postgres', true);
end $$;

create function pg_temp.act_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

grant execute on function pg_temp.ok(boolean, text, text), pg_temp.refusal(text),
  pg_temp.refused(text, text, text), pg_temp.act_as(uuid), pg_temp.act_as_service(),
  pg_temp.act_as_anon() to anon, authenticated;

do $$
declare
  o uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner: sends songs
  f uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: in the DM with o, not in o's circuit
  s uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger: in no room with o
  grp uuid := '00000000-0000-4000-b000-000000000001'; -- Seed Circuit, whose only member is o
  dm uuid; other uuid; lounge uuid; circuit uuid; dm2 uuid;
  song uuid; k text; msg uuid; unsent uuid; live uuid; cs uuid; ls uuid; y uuid; x uuid;
  fs uuid; gs uuid; ms uuid; mm uuid;
  filled uuid[] := '{}';
  got uuid[];
  r1 record; c record; ours record; sent record;
  n int; nf int; t text; t2 text; j jsonb; shape text; held bigint;
  answers text[];
begin
  /* ================================================================ 0. the fixtures are real */
  foreach t in array array[
    'public.chat_song_claim(uuid,text,integer,numeric,text)', 'public.chat_songs_mine()',
    'public.chat_song_ready(uuid,uuid)', 'public.send_chat_song(uuid)', 'public.chat_songs_in(uuid)',
    'public.chat_song_get(uuid)', 'public.chat_song_remove(uuid)', 'public.chat_song_abandoned()',
    'public.chat_song_gone(uuid,uuid)', 'public.chat_song_files_message_gone()'] loop
    if to_regprocedure(t) is null then
      raise exception 'FIXTURE: % does not exist; is the draft loaded?', t;
    end if;
  end loop;
  if to_regclass('public.chat_song_files') is null then
    raise exception 'FIXTURE: chat_song_files does not exist; is the draft loaded?';
  end if;
  if (select count(*) from public.profiles where user_id in (o, f, s)) <> 3 then
    raise exception 'FIXTURE: the seed''s owner, friend and stranger are not all there';
  end if;
  /* `friendships` read directly: `are_friends` answers nothing without a session */
  if not exists (select 1 from public.friendships fr where fr.status = 'accepted'
                  and ((fr.user_a = o and fr.user_b = f) or (fr.user_a = f and fr.user_b = o))) then
    raise exception 'FIXTURE: seedowner and seedfriend are not friends, so section 4 proves nothing about friendship';
  end if;
  if not exists (select 1 from public.circuit_group_members where group_id = grp and user_id = o)
     or exists (select 1 from public.circuit_group_members where group_id = grp and user_id in (f, s)) then
    raise exception 'FIXTURE: the seed circuit should hold the owner and nobody else of the three';
  end if;
  if exists (select 1 from public.chat_song_files where owner in (o, f, s)) then
    raise exception 'FIXTURE: the cast already has songs, so no count below starts from zero';
  end if;

  /* The seed has no Lounge and no DMs. A DM between o and f, one between f and s, the Lounge with
     o and f opted in and s not, and the circuit's own room (made by its trigger, or here). */
  insert into public.chat_rooms (kind) values ('dm') returning id into dm;
  insert into public.chat_room_members (room_id, user_id) values (dm, o), (dm, f);
  insert into public.chat_rooms (kind) values ('dm') returning id into other;
  insert into public.chat_room_members (room_id, user_id) values (other, f), (other, s);
  select id into lounge from public.chat_rooms where kind = 'lounge' order by created_at limit 1;
  if lounge is null then
    insert into public.chat_rooms (kind) values ('lounge') returning id into lounge;
  end if;
  select id into circuit from public.chat_rooms where kind = 'circuit' and group_id = grp;
  if circuit is null then
    insert into public.chat_rooms (kind, group_id) values ('circuit', grp) returning id into circuit;
  end if;
  update public.profiles set lounge_opt_in = (user_id <> s), suspended = false
   where user_id in (o, f, s);

  /* ================================================================ 1. who holds what, and the shapes */
  begin
    shape := pg_get_function_result('public.send_chat_message(uuid,text)'::regprocedure);
    for c in select * from (values
      ('public.chat_song_claim(uuid,text,integer,numeric,text)', true, 'TABLE(id uuid, key text)',
       'p_room uuid, p_mime text, p_bytes integer, p_seconds numeric, p_name text'),
      /* no owner among its columns: it answers only about the caller, and says so by shape */
      ('public.chat_songs_mine()', true,
       'TABLE(file_id uuid, name text, seconds numeric, bytes integer, sent boolean, room_kind text)', ''),
      ('public.chat_song_ready(uuid,uuid)', false, 'void', 'p_id uuid, p_owner uuid'),
      /* the same answer as send_chat_message, so the thread takes either the same way */
      ('public.send_chat_song(uuid)', true, shape, 'p_id uuid'),
      ('public.chat_songs_in(uuid)', true,
       'TABLE(message_id uuid, file_id uuid, name text, seconds numeric, mime text, mine boolean, removed boolean)',
       'p_room uuid'),
      ('public.chat_song_get(uuid)', true, 'TABLE(key text, mime text)', 'p_id uuid'),
      ('public.chat_song_remove(uuid)', true, 'text', 'p_id uuid'),
      ('public.chat_song_abandoned()', true, 'TABLE(id uuid, key text)', ''),
      ('public.chat_song_gone(uuid,uuid)', false, 'void', 'p_id uuid, p_owner uuid')
    ) v(fn, member, result, args) loop
      perform pg_temp.ok(not has_function_privilege('anon', c.fn, 'execute'), '1: anon cannot execute ' || c.fn);
      perform pg_temp.ok(has_function_privilege('authenticated', c.fn, 'execute') = c.member,
        '1: authenticated ' || case when c.member then 'can' else 'cannot' end || ' execute ' || c.fn);
      if not c.member then
        perform pg_temp.ok(has_function_privilege('service_role', c.fn, 'execute'),
          '1: the service can execute ' || c.fn);
      end if;
      perform pg_temp.ok(not exists (
          select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = c.fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
        '1: PUBLIC does not hold execute on ' || c.fn);
      select p.proname,
             p.prosecdef and exists (select 1 from unnest(p.proconfig) g where g like 'search_path=%') as pinned,
             pg_get_function_result(p.oid) as result,
             pg_get_function_identity_arguments(p.oid) as args
        into r1
        from pg_proc p where p.oid = c.fn::regprocedure;
      perform pg_temp.ok(r1.pinned, '1: security definer with a pinned search_path: ' || c.fn);
      perform pg_temp.ok(r1.result = c.result, '1: answers the contract''s shape: ' || c.fn, r1.result);
      perform pg_temp.ok(r1.args = c.args, '1: takes the contract''s arguments: ' || c.fn, r1.args);
      /* a second signature would leave PostgREST unable to choose, and every call would fail */
      select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = r1.proname;
      perform pg_temp.ok(n = 1, '1: one signature only: ' || r1.proname, n::text);
    end loop;

    /* the first draft's way to finish an upload, which went with the signed PUT it relied on;
       nothing may still answer to its name */
    perform pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                                    where ns.nspname = 'public' and p.proname = 'chat_song_pending'),
      '1: chat_song_pending is gone');

    /* the trigger that turns a message going into a removal: there, before the row is written, and
       its function callable by nobody, since a trigger's function is never called by name */
    select count(*) into n from pg_trigger tg
     where tg.tgrelid = 'public.chat_song_files'::regclass and not tg.tgisinternal
       and tg.tgname = 'chat_song_files_message_gone'
       and tg.tgfoid = 'public.chat_song_files_message_gone()'::regprocedure
       /* pg_trigger.tgtype's bits: 1 a row trigger, 2 before, 16 on update */
       and tg.tgtype & 1 = 1 and tg.tgtype & 2 = 2 and tg.tgtype & 16 = 16 and tg.tgenabled = 'O';
    perform pg_temp.ok(n = 1, '1: chat_song_files carries the message-gone trigger, before each update', n::text);
    foreach t in array array['anon', 'authenticated'] loop
      perform pg_temp.ok(not has_function_privilege(t, 'public.chat_song_files_message_gone()', 'execute'),
        '1: ' || t || ' cannot execute the trigger''s function');
    end loop;
    perform pg_temp.ok(not exists (
        select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = 'public.chat_song_files_message_gone()'::regprocedure
           and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
      '1: PUBLIC does not hold execute on the trigger''s function');

    /* ⚠️ PER PRIVILEGE, TRUNCATE INCLUDED: RLS has no TRUNCATE policy, so it is a grant or nothing */
    foreach t in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      perform pg_temp.ok(not has_table_privilege('anon', 'public.chat_song_files', t),
        '1: anon has no ' || t || ' on chat_song_files');
      perform pg_temp.ok(not has_table_privilege('authenticated', 'public.chat_song_files', t),
        '1: authenticated has no ' || t || ' on chat_song_files');
    end loop;
    perform pg_temp.ok((select rc.relrowsecurity from pg_class rc where rc.oid = 'public.chat_song_files'::regclass)
                       and not exists (select 1 from pg_policy p where p.polrelid = 'public.chat_song_files'::regclass),
      '1: chat_song_files has RLS on and no policy');
    select string_agg(a.attname, ',' order by a.attnum) into t from pg_attribute a
     where a.attrelid = 'public.chat_song_files'::regclass and a.attnum > 0 and not a.attisdropped;
    perform pg_temp.ok(t = 'id,owner,key,mime,bytes,seconds,name,room_id,message_id,ready,sent_at,deleted_at,object_gone_at,created_at',
      '1: chat_song_files has the contract''s columns', t);
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '1: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 2. the caps, as s in their own DM */
  begin
    perform pg_temp.act_as(s);
    for c in select * from (values
      ('a room s is not in', dm, 'audio/ogg', 1000, 10::numeric, 'x', 'not in this room'),
      ('a room that does not exist', gen_random_uuid(), 'audio/ogg', 1000, 10, 'x', 'not in this room'),
      ('no room', null, 'audio/ogg', 1000, 10, 'x', 'not in this room'),
      ('image/png', other, 'image/png', 1000, 10, 'x', 'not a kind of recording this keeps'),
      ('audio/mpeg', other, 'audio/mpeg', 1000, 10, 'x', 'not a kind of recording this keeps'),
      ('a mime in capitals', other, 'AUDIO/OGG', 1000, 10, 'x', 'not a kind of recording this keeps'),
      ('a mime with parameters', other, 'audio/webm;codecs=opus', 1000, 10, 'x', 'not a kind of recording this keeps'),
      ('no mime', other, null, 1000, 10, 'x', 'not a kind of recording this keeps'),
      ('5 MB and a byte', other, 'audio/ogg', 5242881, 10, 'x', 'over 5 MB'),
      ('no bytes', other, 'audio/ogg', 0, 10, 'x', 'came to nothing'),
      ('fewer than no bytes', other, 'audio/ogg', -1, 10, 'x', 'came to nothing'),
      ('a null size', other, 'audio/ogg', null, 10, 'x', 'came to nothing'),
      ('no length', other, 'audio/ogg', 1000, 0, 'x', 'has no length'),
      ('a negative length', other, 'audio/ogg', 1000, -5, 'x', 'has no length'),
      ('a null length', other, 'audio/ogg', 1000, null, 'x', 'has no length'),
      ('15 minutes and a thousandth', other, 'audio/ogg', 1000, 900.001, 'x', 'over 15 minutes'),
      ('a blank name', other, 'audio/ogg', 1000, 10, '   ', 'needs a name'),
      ('a name of line breaks', other, 'audio/ogg', 1000, 10, E'\n\t\n', 'needs a name'),
      ('no name', other, 'audio/ogg', 1000, 10, null, 'needs a name')
    ) v(label, room, mime, bytes, secs, nm, want) loop
      perform pg_temp.refused(
        format('select * from public.chat_song_claim(%L, %L, %L, %L, %L)', c.room, c.mime, c.bytes, c.secs, c.nm),
        c.want, '2: a claim with ' || c.label || ' is refused as "' || c.want || '"');
    end loop;

    /* the edges that must be let through, each mime giving its own extension */
    select q.id, q.key into x, t from public.chat_song_claim(other, 'audio/ogg', 5242880, 900, rpad('é', 61, 'é')) q;
    filled := array[x];
    perform pg_temp.ok(t = 'songs/' || x || '.ogg', '2: an Ogg claim of exactly 5 MB and 15 minutes gets an .ogg key', t);
    perform pg_temp.ok(position(s::text in t) = 0, '2: the key carries no owner', t);
    select q.id, q.key into x, t from public.chat_song_claim(other, 'audio/webm', 1, 0.5, E'  Two\n\tlines  ') q;
    filled := filled || x;
    perform pg_temp.ok(t = 'songs/' || x || '.webm', '2: a WebM claim gets a .webm key', t);
    select q.id, q.key into x, t from public.chat_song_claim(other, 'audio/mp4', 1, 1, 'x') q;
    perform pg_temp.ok(t = 'songs/' || x || '.m4a', '2: an MP4 claim gets an .m4a key', t);

    perform pg_temp.act_as_service();
    /* ⚠️ CHARACTERS, NOT BYTES: sixty é are 120 bytes and still a name of sixty */
    select f2.name into t from public.chat_song_files f2 where f2.id = filled[1];
    perform pg_temp.ok(t = rpad('é', 60, 'é'), '2: a 61-character name is kept as its first 60 characters',
                       char_length(t) || ' characters');
    select f2.name into t from public.chat_song_files f2 where f2.id = filled[2];
    perform pg_temp.ok(t = 'Two lines', '2: a name is trimmed and kept on one line', t);

    /* the account's 25 MB, counted from zero: what s holds so far is put out of the way */
    update public.chat_song_files set deleted_at = now(), object_gone_at = now()
     where owner = s and deleted_at is null;
    perform pg_temp.act_as(s);
    filled := '{}';
    for n in 1..5 loop
      select q.id into x from public.chat_song_claim(other, 'audio/webm', 5242880, 60, 'Full ' || n) q;
      filled := filled || x;
    end loop;
    perform pg_temp.ok(cardinality(filled) = 5, '2: five songs of 5 MB fill 25 MB exactly, and are let through');
    /* the list is what the cap counts, so it must add up to the cap here, unsent claims and all */
    select coalesce(sum(m.bytes), 0), count(*) filter (where m.file_id = any(filled) and not m.sent)
      into held, n from public.chat_songs_mine() m;
    perform pg_temp.ok(held = 26214400 and n = 5,
      '2: your own list holds the five, unsent, and adds up to the 25 MB the claim counts',
      held || ' bytes, ' || n || ' of 5');
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/webm'', 1, 1, ''One more'')', other),
      'come to 25 MB', '2: one byte past 25 MB is refused as the account''s cap');

    /* the hour: unsent for 59 minutes is still held, for 61 it is let go */
    perform pg_temp.act_as_service();
    update public.chat_song_files set created_at = now() - interval '59 minutes' where id = filled[1];
    perform pg_temp.act_as(s);
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/webm'', 1, 1, ''One more'')', other),
      'come to 25 MB', '2: an upload unsent for 59 minutes still counts');
    perform pg_temp.act_as_service();
    update public.chat_song_files set created_at = now() - interval '61 minutes' where id = filled[1];
    perform pg_temp.act_as(s);
    t := pg_temp.refusal(format('select * from public.chat_song_claim(%L, ''audio/webm'', 1, 1, ''One more'')', other));
    perform pg_temp.ok(t is null, '2: an upload unsent for 61 minutes is let go, and the claim goes through', t);
    perform pg_temp.act_as_service();
    select count(*) into n from public.chat_song_files where id = any(filled) and deleted_at is not null;
    perform pg_temp.ok(n = 1 and (select deleted_at is not null from public.chat_song_files where id = filled[1]),
      '2: the sweep let go of the old upload and nothing else', n || ' let go');

    /* ready but never sent is in no chat, so it is let go too; a sent song never is */
    perform public.chat_song_ready(filled[2], s);
    perform public.chat_song_ready(filled[3], s);
    perform pg_temp.act_as(s);
    perform * from public.send_chat_song(filled[3]);
    perform pg_temp.act_as_service();
    update public.chat_song_files set created_at = now() - interval '2 hours' where id in (filled[2], filled[3]);
    perform pg_temp.act_as(s);
    perform * from public.chat_song_claim(other, 'audio/webm', 1, 1, 'And one more');
    perform pg_temp.act_as_service();
    perform pg_temp.ok((select deleted_at is not null from public.chat_song_files where id = filled[2]),
      '2: a song that went up and was never sent is let go after the hour');
    perform pg_temp.ok((select deleted_at is null from public.chat_song_files where id = filled[3]),
      '2: a sent song is never let go');

    /* what was let go is handed back for its object to be deleted, and only that */
    perform pg_temp.act_as(s);
    select array_agg(a.id order by a.id) into got from public.chat_song_abandoned() a;
    perform pg_temp.ok(got = array(select unnest(array[filled[1], filled[2]]) order by 1),
      '2: the two let go are handed back to be deleted, and nothing already gone', got::text);
    select array_agg(m.file_id) into got from public.chat_songs_mine() m;
    perform pg_temp.ok(not (got && array[filled[1], filled[2]]) and filled[3] = any(got),
      '2: what was let go leaves your own list, and the sent song stays on it', got::text);
    perform pg_temp.act_as_service();
    perform pg_temp.refused(format('select public.chat_song_ready(%L, %L)', filled[1], s), 'no such song',
      '2: a let-go upload can no longer be marked ready');
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '2: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 3. ready only through the service, then sent */
  begin
    perform pg_temp.act_as(o);
    select q.id, q.key into song, k from public.chat_song_claim(dm, 'audio/mp4', 300000, 42.5, '  Sunday  ') q;
    perform pg_temp.ok(k = 'songs/' || song || '.m4a' and position(o::text in k) = 0,
      '3: the owner''s claim gets a key with no owner in it', k);
    select m.* into ours from public.chat_songs_mine() m where m.file_id = song;
    perform pg_temp.ok(ours.name = 'Sunday' and ours.seconds = 42.5 and ours.bytes = 300000
                       and not ours.sent and ours.room_kind = 'dm',
      '3: the owner''s own list holds what they claimed, unsent', to_jsonb(ours)::text);
    perform pg_temp.act_as(f);
    select count(*) into n from public.chat_songs_mine() m where m.file_id = song;
    perform pg_temp.ok(n = 0, '3: somebody else''s list does not hold it', n::text);

    perform pg_temp.act_as(o);
    perform pg_temp.refused(format('select public.chat_song_ready(%L, %L)', song, o), '42501',
      '3: a member cannot mark their own song ready');
    perform pg_temp.refused(format('select * from public.send_chat_song(%L)', song), 'has not finished going up',
      '3: a song not yet measured cannot be sent');

    perform pg_temp.act_as_service();
    perform pg_temp.refused(format('select public.chat_song_ready(%L, %L)', song, f), 'no such song',
      '3: the service cannot mark a song ready for the wrong owner');
    perform pg_temp.refused(format('select public.chat_song_ready(%L, null)', song), 'no owner',
      '3: the service cannot mark a song ready for nobody');
    perform public.chat_song_ready(song, o);

    perform pg_temp.act_as(o);
    select m.* into sent from public.send_chat_song(song) m;
    msg := sent.id;
    perform pg_temp.ok(sent.body = '🎵 Sunday (0:42)', '3: the message reads as the song, its name trimmed', sent.body);
    perform pg_temp.ok(sent.mine and sent.room_id = dm and sent.author_user_id = o and msg is not null,
      '3: the sender is answered as send_chat_message answers, and a DM names its author', to_jsonb(sent)::text);
    perform pg_temp.refused(format('select * from public.send_chat_song(%L)', song), 'already sent',
      '3: a song cannot be sent twice');
    perform pg_temp.ok((select m.sent from public.chat_songs_mine() m where m.file_id = song),
      '3: once sent, the owner''s own list says so');

    perform pg_temp.act_as_service();
    perform pg_temp.ok(exists (select 1 from public.chat_messages m where m.id = msg and m.room_id = dm
                                  and m.user_id = o and m.body = '🎵 Sunday (0:42)'),
      '3: the message is in the room');
    perform pg_temp.ok(exists (select 1 from public.chat_song_files f2 where f2.id = song and f2.message_id = msg
                                  and f2.sent_at is not null),
      '3: the song records which message carries it');

    /* ⚠️ WHOLE SECONDS, ROUNDED DOWN, and the client's lengthLabel must agree: 59.999 and 125.7 are
       the two that tell rounding down from rounding off */
    for c in select * from (values (59.999::numeric, '0:59'), (60, '1:00'), (125.7, '2:05'), (900, '15:00'))
               v(secs, label) loop
      perform pg_temp.act_as(o);
      select q.id into x from public.chat_song_claim(dm, 'audio/webm', 1000, c.secs, 'Len') q;
      perform pg_temp.act_as_service();
      perform public.chat_song_ready(x, o);
      perform pg_temp.act_as(o);
      select m.body into t from public.send_chat_song(x) m;
      perform pg_temp.ok(t = '🎵 Len (' || c.label || ')', '3: ' || c.secs || ' seconds reads as ' || c.label, t);
    end loop;
    live := x; -- sent into the DM, and still there

    /* ready and unsent: nobody else can send it */
    select q.id into unsent from public.chat_song_claim(dm, 'audio/ogg', 1000, 5, 'Unsent') q;
    perform pg_temp.act_as_service();
    perform public.chat_song_ready(unsent, o);
    perform pg_temp.act_as(f);
    perform pg_temp.refused(format('select * from public.send_chat_song(%L)', unsent), 'no such song',
      '3: a member cannot send somebody else''s song');
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '3: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 4. who hears it */
  begin
    perform pg_temp.act_as(f);
    select count(*) into n from public.chat_songs_in(dm) z
     where z.file_id = song and z.message_id = msg and z.name = 'Sunday' and z.seconds = 42.5
       and z.mime = 'audio/mp4' and not z.mine and not z.removed;
    perform pg_temp.ok(n = 1, '4: the friend finds the song on its message, not as theirs', n::text);
    select g.key, g.mime into t, t2 from public.chat_song_get(song) g;
    perform pg_temp.ok(t = k and t2 = 'audio/mp4', '4: the friend may hear it', t);
    select count(*) into n from public.chat_songs_in(other) z where z.file_id = song;
    perform pg_temp.ok(n = 0, '4: a song is in the room it was sent to and no other');

    /* a body typed to look like a song carries nothing: only the file's record says which */
    select count(*) into n from public.chat_songs_in(dm);
    perform * from public.send_chat_message(dm, '🎵 Sunday (0:42)');
    perform pg_temp.ok((select count(*) from public.chat_songs_in(dm)) = n,
      '4: a typed message that reads like a song is not one');

    perform pg_temp.refused(format('select public.chat_song_remove(%L)', song), 'no such song',
      '4: only the sender may take a song down');
    perform pg_temp.refused(format('select * from public.chat_song_get(%L)', unsent), 'no such song',
      '4: a song nobody has sent cannot be heard');

    perform pg_temp.act_as(o);
    select count(*) into n from public.chat_songs_in(dm) z where z.file_id = song and z.mine;
    perform pg_temp.ok(n = 1, '4: the sender is told it is theirs');

    perform pg_temp.act_as(s);
    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', dm), 'not in this room',
      '4: a stranger cannot list the songs in a DM they are not in');
    perform pg_temp.refused(format('select * from public.chat_song_get(%L)', song), 'no such song',
      '4: a stranger cannot hear a song in a DM they are not in');

    /* friendship opens no room: o's circuit holds o alone, and f is o's friend */
    perform pg_temp.act_as(o);
    select q.id into cs from public.chat_song_claim(circuit, 'audio/ogg', 1000, 7, 'Circuit') q;
    perform pg_temp.act_as_service();
    perform public.chat_song_ready(cs, o);
    perform pg_temp.act_as(o);
    perform * from public.send_chat_song(cs);
    select count(*) into n from public.chat_song_get(cs);
    perform pg_temp.ok(n = 1, '4: a circuit''s member may hear a song sent to it');
    perform pg_temp.act_as(f);
    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', circuit), 'not in this room',
      '4: a friend outside the circuit cannot list its songs');
    perform pg_temp.refused(format('select * from public.chat_song_get(%L)', cs), 'no such song',
      '4: a friend outside the circuit cannot hear its song');
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '4: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 5. removed, and its object */
  begin
    perform pg_temp.act_as(o);
    t := public.chat_song_remove(song);
    perform pg_temp.ok(t = k, '5: removing a song gives back its key', t);
    perform pg_temp.refused(format('select public.chat_song_remove(%L)', song), 'no such song',
      '5: a removed song cannot be removed again');
    select count(*) into n from public.chat_songs_mine() m where m.file_id = song;
    perform pg_temp.ok(n = 0, '5: a removed song leaves its owner''s list, so it no longer counts');

    perform pg_temp.act_as(f);
    select count(*) into n from public.chat_songs_in(dm) z
     where z.file_id = song and z.message_id = msg and z.removed and not z.mine;
    perform pg_temp.ok(n = 1, '5: a removed song is still listed on its message, as removed');

    /* ⚠️ ONE ANSWER for removed, missing, never sent and not yours: the same state, the same words */
    answers := array[
      pg_temp.refusal(format('select * from public.chat_song_get(%L)', song)),
      pg_temp.refusal(format('select * from public.chat_song_get(%L)', gen_random_uuid())),
      pg_temp.refusal(format('select * from public.chat_song_get(%L)', unsent))];
    perform pg_temp.act_as(s);
    answers := answers || pg_temp.refusal(format('select * from public.chat_song_get(%L)', live));
    perform pg_temp.ok(answers = array_fill('P0001: no such song'::text, array[4]),
      '5: removed, missing, unsent and not-yours all read "no such song"', answers::text);

    perform pg_temp.act_as_service();
    perform pg_temp.ok(exists (select 1 from public.chat_messages m where m.id = msg), '5: the message stays');

    perform pg_temp.act_as(o);
    select count(*) into n from public.chat_song_abandoned() a where a.id = song and a.key = k;
    perform pg_temp.ok(n = 1, '5: a removed song is handed back so its object can be deleted');
    perform pg_temp.refused(format('select public.chat_song_gone(%L, %L)', song, o), '42501',
      '5: a member cannot say an object is gone');
    perform pg_temp.act_as(f);
    select count(*) into n from public.chat_song_abandoned() a where a.id = song;
    perform pg_temp.ok(n = 0, '5: nobody else is handed it');

    perform pg_temp.act_as_service();
    perform pg_temp.refused(format('select public.chat_song_gone(%L, %L)', song, f), 'no such song',
      '5: the service cannot mark an object gone for the wrong owner');
    perform pg_temp.refused(format('select public.chat_song_gone(%L, %L)', live, o), 'no such song',
      '5: a live song''s object is never marked gone');
    perform pg_temp.ok((select object_gone_at is null and deleted_at is null from public.chat_song_files where id = live),
      '5: and the live song is untouched');
    perform public.chat_song_gone(song, o);
    t := pg_temp.refusal(format('select public.chat_song_gone(%L, %L)', song, o));
    perform pg_temp.ok(t is null, '5: saying it twice is harmless', t);
    perform pg_temp.act_as(o);
    select count(*) into n from public.chat_song_abandoned() a where a.id = song;
    perform pg_temp.ok(n = 0, '5: once gone, it is not handed back again');

    /* twenty at a time */
    perform pg_temp.act_as_service();
    insert into public.chat_song_files (id, owner, key, mime, bytes, seconds, name, deleted_at)
    select z.g, f, 'songs/' || z.g || '.ogg', 'audio/ogg', 1, 1, 'Old', now()
      from (select gen_random_uuid() as g from generate_series(1, 22)) z;
    perform pg_temp.act_as(f);
    select count(*) into n from public.chat_song_abandoned();
    perform pg_temp.ok(n = 20, '5: no more than twenty are handed back at once', n::text);
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '5: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 6. the Lounge stays pseudonymous */
  begin
    perform pg_temp.act_as(o);
    select q.id into ls from public.chat_song_claim(lounge, 'audio/ogg', 2000, 5, 'Lounge tune') q;
    perform pg_temp.act_as_service();
    perform public.chat_song_ready(ls, o);
    perform pg_temp.act_as(o);
    select m.* into sent from public.send_chat_song(ls) m;
    perform pg_temp.ok(sent.author_user_id is null and sent.author_username is null
                       and sent.body = '🎵 Lounge tune (0:05)',
      '6: sending a Lounge song hands back no author', to_jsonb(sent)::text);
    perform pg_temp.act_as_service();
    perform pg_temp.ok((select m.user_id is null from public.chat_messages m where m.id = sent.id),
      '6: the Lounge message carries no user id');
    perform pg_temp.ok(exists (select 1 from public.lounge_message_authors la
                                where la.message_id = sent.id and la.user_id = o),
      '6: its author is kept where members cannot read it, so it went through send_chat_message');

    /* everything a member is told about a Lounge song, searched for its sender */
    perform pg_temp.act_as(f);
    select jsonb_agg(to_jsonb(z)) into j from public.chat_songs_in(lounge) z where z.file_id = ls;
    perform pg_temp.ok(jsonb_array_length(j) = 1 and not (j->0->>'mine')::boolean,
      '6: the Lounge can hear a Lounge song', j::text);
    select j || coalesce(jsonb_agg(to_jsonb(g)), '[]') into j from public.chat_song_get(ls) g;
    /* and the one list with no room check holds only the caller's own, so it holds nothing here */
    select j || coalesce(jsonb_agg(to_jsonb(m)), '[]') into j from public.chat_songs_mine() m
     where m.file_id = ls;
    perform pg_temp.ok(jsonb_array_length(j) = 2 and position(o::text in j::text) = 0
                       and position('seedowner' in j::text) = 0,
      '6: nothing a member is told names the sender', j::text);
    perform pg_temp.act_as(o);
    select jsonb_agg(to_jsonb(z)) into j from public.chat_songs_in(lounge) z where z.file_id = ls;
    select j || coalesce(jsonb_agg(to_jsonb(m)), '[]') into j from public.chat_songs_mine() m
     where m.file_id = ls;
    perform pg_temp.ok(jsonb_array_length(j) = 2 and (j->0->>'mine')::boolean
                       and j->1->>'room_kind' = 'lounge' and position(o::text in j::text) = 0,
      '6: the sender is told it is theirs, and in the Lounge, and no more', j::text);

    perform pg_temp.act_as(s);
    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', lounge), 'not in this room',
      '6: a member who has not joined the Lounge cannot list its songs');
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '6: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 7. suspended */
  begin
    perform pg_temp.act_as(o);
    select q.id into y from public.chat_song_claim(dm, 'audio/mp4', 1000, 3, 'Before') q;
    perform pg_temp.act_as_service();
    perform public.chat_song_ready(y, o);
    perform pg_temp.act_as(o);
    perform * from public.send_chat_song(y);
    perform pg_temp.act_as_service();
    update public.profiles set suspended = true where user_id = o;

    perform pg_temp.act_as(o);
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/mp4'', 1000, 10, ''x'')', dm),
      'your account is suspended', '7: a suspended member cannot start a song');
    perform pg_temp.refused(format('select * from public.send_chat_song(%L)', unsent), 'your account is suspended',
      '7: a suspended member cannot send one already up');
    t := pg_temp.refusal(format('select public.chat_song_remove(%L)', y));
    perform pg_temp.ok(t is null, '7: a suspended member can take their own song down', t);
    select count(*) into n from public.chat_song_abandoned() a where a.id = y;
    perform pg_temp.ok(n = 1, '7: and its object is still handed back to be deleted');
    select count(*) into n from public.chat_song_get(live);
    perform pg_temp.ok(n = 1, '7: and can still hear what is in their rooms');

    /* ⚠️ SUSPENSION TAKES THEM OUT OF THE LOUNGE (chat_room_member asks), so the thread can no longer
       show them their Lounge song or its Remove. Their own list is the only way left to it. */
    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', lounge), 'not in this room',
      '7: a suspended member can no longer list the Lounge''s songs');
    select count(*) into n from public.chat_songs_mine() m
     where m.file_id = ls and m.sent and m.room_kind = 'lounge';
    perform pg_temp.ok(n = 1, '7: but their own list still holds their Lounge song');
    t := pg_temp.refusal(format('select public.chat_song_remove(%L)', ls));
    perform pg_temp.ok(t is null, '7: and they can take it down from there', t);
    select count(*) into n from public.chat_songs_mine() m where m.file_id = ls;
    perform pg_temp.ok(n = 0, '7: after which it is off their list, and no longer counts');
    select count(*) into n from public.chat_song_abandoned() a where a.id = ls;
    perform pg_temp.ok(n = 1, '7: and its object is handed back to be deleted');
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '7: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 8. nobody: no session, and a guest */
  begin
    perform pg_temp.act_as_service();
    foreach t in array array[
      format('select * from public.chat_song_claim(%L, ''audio/mp4'', 1000, 10, ''x'')', dm),
      'select * from public.send_chat_song(null)', 'select * from public.chat_songs_in(null)',
      'select * from public.chat_song_get(null)', 'select public.chat_song_remove(null)',
      'select * from public.chat_song_abandoned()', 'select * from public.chat_songs_mine()'] loop
      perform pg_temp.refused(t, 'not authenticated', '8: with no session, refused: ' || t);
    end loop;

    perform pg_temp.act_as_anon();
    foreach t in array array[
      'select * from public.chat_song_claim(null, null, null, null, null)',
      'select * from public.chat_songs_mine()', 'select public.chat_song_ready(null, null)',
      'select * from public.send_chat_song(null)', 'select * from public.chat_songs_in(null)',
      'select * from public.chat_song_get(null)', 'select public.chat_song_remove(null)',
      'select * from public.chat_song_abandoned()', 'select public.chat_song_gone(null, null)'] loop
      perform pg_temp.refused(t, '42501', '8: a guest is refused by privilege: ' || t);
    end loop;
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '8: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 9. your own list, from a room you left */
  begin
    /* f joins o's circuit, sends a song into it, and leaves by the circuit's own door */
    perform pg_temp.act_as_service();
    insert into public.circuit_group_members (group_id, user_id) values (grp, f);
    perform pg_temp.act_as(f);
    select q.id into fs from public.chat_song_claim(circuit, 'audio/webm', 4321, 9, 'Left behind') q;
    perform pg_temp.act_as_service();
    perform public.chat_song_ready(fs, f);
    perform pg_temp.act_as(f);
    perform * from public.send_chat_song(fs);
    perform public.leave_circuit(grp);

    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', circuit), 'not in this room',
      '9: having left the circuit, they can no longer list its songs');
    select m.* into ours from public.chat_songs_mine() m where m.file_id = fs;
    perform pg_temp.ok(ours.name = 'Left behind' and ours.bytes = 4321 and ours.seconds = 9 and ours.sent
                       and ours.room_kind = 'circuit',
      '9: but their own list still holds the song they sent there', to_jsonb(ours)::text);
    t := pg_temp.refusal(format('select public.chat_song_remove(%L)', fs));
    perform pg_temp.ok(t is null, '9: and they can take it down from there', t);
    select count(*) into n from public.chat_songs_mine() m where m.file_id = fs;
    perform pg_temp.ok(n = 0, '9: after which it is off their list, and no longer counts');

    /* the room still has the message, so it still shows the song, as removed */
    perform pg_temp.act_as(o);
    select count(*) into n from public.chat_songs_in(circuit) z
     where z.file_id = fs and z.removed and not z.mine;
    perform pg_temp.ok(n = 1, '9: the circuit still shows it, as removed');
    perform pg_temp.act_as_service();
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '9: stopped early', sqlstate || ': ' || sqlerrm);
  end;

  /* ================================================================ 10. a sent song whose message goes */
  /* ⚠️ ASKED THROUGH THE CLAIM'S OWN COUNT, NOT BY RE-ADDING THE ROWS. The account is filled to
     exactly 25 MB; each time a message goes, a claim of exactly the bytes its song held must fit and
     one byte more must not. That says "this song stopped counting, and nothing else did" without
     repeating the sum the claim makes. The fillers are songs never sent, in the room that is about
     to be deleted: a song with no message to lose must go on counting when its room goes. */
  begin
    perform pg_temp.act_as_service();
    update public.profiles set suspended = false where user_id = o;
    insert into public.chat_rooms (kind) values ('dm') returning id into dm2;
    insert into public.chat_room_members (room_id, user_id) values (dm2, o), (dm2, f);
    /* the seed's creator made its owner, as creating a circuit does, so delete_circuit lets them */
    update public.circuit_group_members set role = 'owner' where group_id = grp and user_id = o;

    /* gs goes with its room, ms with its message alone, and cs (section 4) with the circuit */
    perform pg_temp.act_as(o);
    select q.id into gs from public.chat_song_claim(dm2, 'audio/ogg', 5242880, 30, 'Room gone') q;
    select q.id into ms from public.chat_song_claim(dm, 'audio/ogg', 4000, 30, 'Message gone') q;
    perform pg_temp.act_as_service();
    perform public.chat_song_ready(gs, o);
    perform public.chat_song_ready(ms, o);
    perform pg_temp.act_as(o);
    perform * from public.send_chat_song(gs);
    select m.id into mm from public.send_chat_song(ms) m;

    perform pg_temp.act_as_service();
    select coalesce(sum(f2.bytes), 0) into held from public.chat_song_files f2
     where f2.owner = o and f2.deleted_at is null;
    nf := 0;
    while held < 26214400 loop
      x := gen_random_uuid();
      insert into public.chat_song_files (id, owner, key, mime, bytes, seconds, name, room_id)
      values (x, o, 'songs/' || x || '.ogg', 'audio/ogg', least(5242880, 26214400 - held), 1, 'Never sent', dm2);
      held := held + least(5242880, 26214400 - held);
      nf := nf + 1;
    end loop;
    perform pg_temp.act_as(o);
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 1, 1, ''Probe'')', dm),
      'come to 25 MB', '10: the account starts full, every song counted');

    /* a message deleted while its room stays, which is what deleting an account does to its DMs */
    perform pg_temp.act_as_service();
    delete from public.chat_messages where id = mm;
    perform pg_temp.act_as(o);
    t := pg_temp.refusal(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 4000, 1, ''Probe'')', dm));
    perform pg_temp.ok(t is null, '10: once its message is deleted, a song''s 4000 bytes are free again', t);
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 1, 1, ''Probe'')', dm),
      'come to 25 MB', '10: and nothing else came free with them');
    select count(*) into n from public.chat_songs_in(dm) z where z.file_id = ms;
    perform pg_temp.ok(n = 0, '10: the room it was in, still there, no longer lists it', n::text);

    /* the whole room deleted, as postgres */
    perform pg_temp.act_as_service();
    delete from public.chat_rooms where id = dm2;
    perform pg_temp.act_as(o);
    t := pg_temp.refusal(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 5242880, 1, ''Probe'')', dm));
    perform pg_temp.ok(t is null, '10: once its room is deleted, a sent song''s 5 MB are free again', t);
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 1, 1, ''Probe'')', dm),
      'come to 25 MB', '10: and the songs never sent there still count');
    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', dm2), 'not in this room',
      '10: the deleted room lists nothing');
    select count(*) into n from public.chat_songs_mine() m
     where m.name = 'Never sent' and m.room_kind is null and not m.sent;
    perform pg_temp.ok(n = nf,
      '10: the songs never sent stay on their owner''s list when their room goes, to be removed there',
      n || ' of ' || nf);

    /* the circuit deleted by the function its owner uses, which runs as postgres */
    perform public.delete_circuit(grp);
    t := pg_temp.refusal(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 1000, 1, ''Probe'')', dm));
    perform pg_temp.ok(t is null, '10: once delete_circuit has taken its room, a song sent there no longer counts', t);
    perform pg_temp.refused(format('select * from public.chat_song_claim(%L, ''audio/ogg'', 1, 1, ''Probe'')', dm),
      'come to 25 MB', '10: and nothing else came free with it');
    perform pg_temp.refused(format('select * from public.chat_songs_in(%L)', circuit), 'not in this room',
      '10: the deleted circuit lists nothing');

    /* each of the three: let go, off its owner's list, and handed back for its object to be deleted */
    select count(*) into n from public.chat_songs_mine() m where m.file_id in (gs, ms, cs);
    perform pg_temp.ok(n = 0, '10: none of the three is on its owner''s list', n::text);
    select array_agg(a.id order by a.id) into got from public.chat_song_abandoned() a
     where a.id in (gs, ms, cs);
    perform pg_temp.ok(cardinality(got) = 3, '10: all three are handed back so their objects can be deleted',
      got::text);
    perform pg_temp.act_as_service();
    select count(*) into n from public.chat_song_files f2
     where f2.id in (gs, ms, cs) and f2.message_id is null and f2.deleted_at is not null
       and f2.object_gone_at is null;
    perform pg_temp.ok(n = 3, '10: all three are marked removed, and their objects not yet gone', n::text);
  exception when others then
    perform pg_temp.act_as_service();
    perform pg_temp.ok(false, '10: stopped early', sqlstate || ': ' || sqlerrm);
  end;
end $$;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_failed int; v_asked int; v_list text; v_silent text;
begin
  select count(*) filter (where not passed), count(*),
         string_agg('  - ' || label || coalesce(' -- ' || detail, ''), E'\n' order by asked_at)
           filter (where not passed)
    into v_failed, v_asked, v_list
    from pg_temp.checks;
  /* a section that recorded nothing asked nothing, which is not a pass */
  select string_agg(sec, ', ') into v_silent
    from unnest(array['1','2','3','4','5','6','7','8','9','10']) sec
   where not exists (select 1 from pg_temp.checks ch where ch.label like sec || ':%');
  if v_silent is not null then
    raise exception 'CHAT SONGS ASKED NOTHING in section(s) %', v_silent;
  end if;
  if v_failed > 0 then
    raise exception E'CHAT SONGS FAILED -- % of % check(s):\n%', v_failed, v_asked, v_list;
  end if;
  raise notice 'chat songs: all % checks hold', v_asked;
end $$;

select 'chat songs hold' as result, count(*) as checks from pg_temp.checks;

rollback;
