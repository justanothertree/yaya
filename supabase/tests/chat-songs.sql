-- Songs in chat (supabase/drafts/2026-11-21-chat-songs.sql until it is applied), asked as every
-- kind of caller: who may call what, the caps, who may hear a song, and that the Lounge stays
-- pseudonymous. Each case is a real call under a real role with real claims.
--
-- HOW TO RUN: db-guards.yml runs it after the draft, on the throwaway stack it builds. Everything
-- here is in one transaction that rolls back; it leaves nothing behind. It raises, listing every
-- failed case, if anything is wrong, and says how many cases it asked otherwise.
--
-- ⚠️ IT REFUSES TO PASS BY ASKING NOTHING: block 0 checks the functions and the seed's members are
-- there before anything is asked of them.

begin;

do $$
declare
  o uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner: sends songs
  f uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: in the DM with o
  s uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger: in no room with o
  dm uuid;
  other uuid;
  lounge uuid;
  song uuid;
  k text;
  n int;
  r record;
  fails text[] := '{}';
  asked int := 0;
  fn text;
  t text;

begin
 begin
  /* ---------------------------------------------------------------- 0. the fixtures are real */
  foreach fn in array array['public.chat_song_claim(uuid,text,integer,numeric,text)',
                            'public.chat_song_pending(uuid)', 'public.chat_song_ready(uuid,uuid)',
                            'public.send_chat_song(uuid)', 'public.chat_songs_in(uuid)',
                            'public.chat_song_get(uuid)', 'public.chat_song_remove(uuid)'] loop
    if to_regprocedure(fn) is null then
      raise exception 'FIXTURE: % does not exist; is the draft applied?', fn;
    end if;
  end loop;
  if (select count(*) from auth.users where id in (o, f, s)) <> 3 then
    raise exception 'FIXTURE: the seed''s owner, friend and stranger are not all there';
  end if;

  /* a DM between o and f, one between f and s, and the Lounge with both o and f opted in */
  insert into public.chat_rooms (kind) values ('dm') returning id into dm;
  insert into public.chat_room_members (room_id, user_id) values (dm, o), (dm, f);
  insert into public.chat_rooms (kind) values ('dm') returning id into other;
  insert into public.chat_room_members (room_id, user_id) values (other, f), (other, s);
  select id into lounge from public.chat_rooms where kind = 'lounge' limit 1;
  if lounge is null then
    insert into public.chat_rooms (kind) values ('lounge') returning id into lounge;
  end if;
  update public.profiles set lounge_opt_in = true, suspended = false where user_id in (o, f);

  /* ---------------------------------------------------------------- 1. who holds what */
  foreach fn in array array['public.chat_song_claim(uuid,text,integer,numeric,text)',
                            'public.chat_song_pending(uuid)', 'public.send_chat_song(uuid)',
                            'public.chat_songs_in(uuid)', 'public.chat_song_get(uuid)',
                            'public.chat_song_remove(uuid)'] loop
    asked := asked + 2;
    if has_function_privilege('anon', fn, 'execute') then
      fails := array_append(fails, '1: anon can execute ' || fn);
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      fails := array_append(fails, '1: authenticated cannot execute ' || fn);
    end if;
  end loop;
  asked := asked + 3;
  if has_function_privilege('anon', 'public.chat_song_ready(uuid,uuid)', 'execute') then
    fails := array_append(fails, '1: anon can execute chat_song_ready');
  end if;
  if has_function_privilege('authenticated', 'public.chat_song_ready(uuid,uuid)', 'execute') then
    fails := array_append(fails, '1: a member can mark a song ready without the object being checked');
  end if;
  if not has_function_privilege('service_role', 'public.chat_song_ready(uuid,uuid)', 'execute') then
    fails := array_append(fails, '1: the service cannot mark a song ready');
  end if;
  foreach t in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
    asked := asked + 2;
    if has_table_privilege('anon', 'public.chat_song_files', t) then
      fails := array_append(fails, '1: anon has ' || t || ' on chat_song_files');
    end if;
    if has_table_privilege('authenticated', 'public.chat_song_files', t) then
      fails := array_append(fails, '1: authenticated has ' || t || ' on chat_song_files');
    end if;
  end loop;

  /* ---------------------------------------------------------------- 2. the owner starts one */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select c.id, c.key into song, k from public.chat_song_claim(dm, 'audio/mp4', 300000, 42.5, '  Sunday  ') c;
  asked := asked + 2;
  if k <> 'songs/' || song || '.m4a' then fails := array_append(fails, '2: key is ' || k); end if;
  if position(o::text in k) > 0 then fails := array_append(fails, '2: the key carries its owner'); end if;

  /* refusals, each its own case */
  foreach t in array array[
    format('select * from public.chat_song_claim(%L, ''audio/mp4'', 1000, 10, ''x'')', other),
    format('select * from public.chat_song_claim(%L, ''image/png'', 1000, 10, ''x'')', dm),
    format('select * from public.chat_song_claim(%L, ''audio/mp4'', 5242881, 10, ''x'')', dm),
    format('select * from public.chat_song_claim(%L, ''audio/mp4'', 1000, 10, ''   '')', dm),
    format('select * from public.chat_song_claim(%L, ''audio/mp4'', 1000, 0, ''x'')', dm),
    format('select * from public.send_chat_song(%L)', song)] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '2: allowed: ' || t);
    exception when others then null;
    end;
  end loop;

  /* the account cap: 25 MB of songs, so five more of 5 MB is one too many */
  asked := asked + 1;
  begin
    for n in 1..5 loop
      perform * from public.chat_song_claim(dm, 'audio/webm', 5242880, 100, 'Big ' || n);
    end loop;
    fails := array_append(fails, '2: more than 25 MB was allowed');
  exception when others then
    if sqlerrm not like '%25 MB%' then fails := array_append(fails, '2: the cap said ' || sqlerrm); end if;
  end;

  /* ---------------------------------------------------------------- 3. ready, then sent */
  perform set_config('role', 'postgres', true);
  perform public.chat_song_ready(song, o);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select * into r from public.send_chat_song(song);
  asked := asked + 2;
  if r.body <> '🎵 Sunday (0:42)' then fails := array_append(fails, '3: body is ' || r.body); end if;
  if not r.mine then fails := array_append(fails, '3: the sender is not told it is theirs'); end if;
  asked := asked + 1;
  begin
    perform * from public.send_chat_song(song);
    fails := array_append(fails, '3: a song was sent twice');
  exception when others then null;
  end;

  /* ---------------------------------------------------------------- 4. who hears it */
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  select count(*) into n from public.chat_songs_in(dm) x where x.file_id = song and x.message_id = r.id and not x.mine;
  asked := asked + 2;
  if n <> 1 then fails := array_append(fails, '4: the friend does not see the song in the room'); end if;
  if (select g.key from public.chat_song_get(song) g) <> k then
    fails := array_append(fails, '4: the friend cannot hear it');
  end if;
  /* and only the sender may take it down */
  asked := asked + 1;
  begin
    perform public.chat_song_remove(song);
    fails := array_append(fails, '4: the friend removed the sender''s song');
  exception when others then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  foreach t in array array[format('select * from public.chat_songs_in(%L)', dm),
                           format('select * from public.chat_song_get(%L)', song)] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '4: the stranger got: ' || t);
    exception when others then
      /* the same words for a song that exists and one that does not */
      if t like '%chat_song_get%' and sqlerrm <> 'no such song' then
        fails := array_append(fails, '4: a stranger is told more than "no such song": ' || sqlerrm);
      end if;
    end;
  end loop;

  /* a body typed to look like a song carries nothing: only the file's record says which */
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform * from public.send_chat_message(dm, '🎵 Sunday (0:42)');
  select count(*) into n from public.chat_songs_in(dm);
  asked := asked + 1;
  if n <> 1 then fails := array_append(fails, '4: a typed message counts as a song: ' || n); end if;

  /* ---------------------------------------------------------------- 5. removed */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  asked := asked + 3;
  if public.chat_song_remove(song) <> k then fails := array_append(fails, '5: remove did not give the key back'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  select count(*) into n from public.chat_songs_in(dm);
  if n <> 0 then fails := array_append(fails, '5: a removed song is still in the room'); end if;
  begin
    perform * from public.chat_song_get(song);
    fails := array_append(fails, '5: a removed song can still be heard');
  exception when others then null;
  end;

  /* ---------------------------------------------------------------- 6. the Lounge */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  select c.id into song from public.chat_song_claim(lounge, 'audio/ogg', 2000, 5, 'Lounge tune') c;
  perform set_config('role', 'postgres', true);
  perform public.chat_song_ready(song, o);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select * into r from public.send_chat_song(song);
  perform set_config('role', 'postgres', true);
  asked := asked + 2;
  if (select m.user_id from public.chat_messages m where m.id = r.id) is not null then
    fails := array_append(fails, '6: a Lounge song names its sender on the message');
  end if;
  if r.author_user_id is not null or r.author_username is not null then
    fails := array_append(fails, '6: sending a Lounge song hands back who sent it');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.chat_songs_in(lounge) x where x.file_id = song and not x.mine;
  asked := asked + 1;
  if n <> 1 then fails := array_append(fails, '6: the Lounge cannot hear a Lounge song'); end if;

  /* ---------------------------------------------------------------- 7. suspended */
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = true where user_id = o;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 2;
  begin
    perform * from public.chat_song_claim(dm, 'audio/mp4', 1000, 10, 'x');
    fails := array_append(fails, '7: a suspended member started a song');
  exception when others then null;
  end;
  begin
    perform public.chat_song_remove(song);
  exception when others then
    fails := array_append(fails, '7: a suspended member could not take their song down: ' || sqlerrm);
  end;
  perform set_config('role', 'postgres', true);

 exception when others then
  perform set_config('role', 'postgres', true);
  raise;
 end;
  if array_length(fails, 1) > 0 then
    raise exception 'chat songs: % of % cases failed:%', array_length(fails, 1), asked,
      chr(10) || array_to_string(fails, chr(10));
  end if;
  raise notice 'chat songs: all % cases hold', asked;
end $$;

rollback;
