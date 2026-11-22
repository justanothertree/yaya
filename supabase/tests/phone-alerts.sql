-- Phone alerts, step 2 (docs/2026-11-22-phone-alerts.DRAFT.sql): who may reach the four tables
-- and the functions, and whether each function does what the plan says, asked as every kind of
-- caller — a member, a suspended member, a stranger to the row, anon, the push function's service
-- role, and an admin.
--
-- HOW TO RUN: db-guards.yml puts production's default grants back, loads the draft (or, once
-- applied, its migration) with psql -1, then runs this file. Everything is in one transaction that
-- rolls back. It raises, listing every failed check, if anything is wrong, and says how many it
-- asked otherwise — and which of pg_net and pg_cron the stack had, because two checks depend on
-- that and the log should say which way they went.
--
-- ⚠️ A MEMBER HAS NO GRANT ON ANY OF THE FOUR TABLES (deny-all, the house pattern), so every member
-- section reads through the member's own RPCs, the way their browser does. What the tables hold is
-- read as postgres between them.
--
-- ⚠️ IT REFUSES TO RUN WITHOUT ITS CAST, because nearly every check here is "this was refused" and
-- against a member who does not exist the refusal proves nothing. The cast is the seed's:
-- seedowner (an admin), seedfriend and seedstranger. are_friends is not used and is not needed —
-- nothing here is about friendship, and it answers nothing to a connection with no session.
--
-- ⚠️ pg_net MAY OR MAY NOT BE THERE, and every check of the kick runs either way. Where
-- net.http_post is missing, the kick must say 'no pg_net' and an insert must still succeed, and a
-- recording stub then stands in under pg_net's signature. Where the real one is there, a kick
-- queues a request that is never sent: pg_net sends only after commit, and this rolls back. Then,
-- on both, a recorder replaces the draft's own push_http_post — which a test can replace where
-- pg_net's function, owned by the extension's owner, may not be — so what the kick SENDS, how
-- often, and what a failure does are asked on every stack, not only on one without pg_net.

begin;

/* the recorders' notebook: what the wire was handed, by the net.http_post stub where the stack has
   no pg_net and by the push_http_post stand-in on every stack */
create temp table kicks (url text, body jsonb, headers jsonb, timeout_ms int);

do $$
declare
  o_id uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner: a member, and the admin
  f_id uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: a member
  s_id uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger: suspended for one section
  e1 text := 'https://fcm.googleapis.com/fcm/send/phone-alerts-test-1';
  e2 text := 'https://updates.push.services.mozilla.com/wpush/v2/phone-alerts-test-2';
  e3 text := 'https://web.push.apple.com/phone-alerts-test-3';
  e5 text := 'https://fcm.googleapis.com/fcm/send/phone-alerts-test-5';
  good_key text := 'B' || repeat('A', 86);  -- the shape of a P-256 point in base64url
  good_auth text := repeat('a', 22);        -- the shape of a 16-octet secret
  fails text[] := '{}';
  asked int := 0;
  net_real boolean := to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is not null;
  cron_here boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  st text;
  msg text;
  t text;
  n int;
  j jsonb;
  id1 uuid;
  dev2 uuid;
  dev5 uuid;
  r1 bigint; r2 bigint; r3 bigint; r4 bigint; r5 bigint; r6 bigint;
  stuck0 int;
  first_ boolean;
  again_ boolean;
begin
 begin
  /* ------------------------------------------------------------------- 0. the fixtures are real */
  if to_regclass('public.push_outbox') is null or to_regprocedure('public.push_claim(integer)') is null then
    raise exception 'FIXTURE: the phone alerts tables or functions are missing; is the draft loaded?';
  end if;
  if (select count(*) from auth.users where id in (o_id, f_id, s_id)) <> 3 then
    raise exception 'FIXTURE: the seed''s owner, friend and stranger are not all there';
  end if;
  if not exists (select 1 from public.admin_users where user_id = o_id)
     or exists (select 1 from public.admin_users where user_id in (f_id, s_id)) then
    raise exception 'FIXTURE: seedowner must be the only admin of the three';
  end if;
  if exists (select 1 from public.profiles where user_id in (o_id, f_id, s_id) and coalesce(suspended, false)) then
    raise exception 'FIXTURE: one of the cast is already suspended';
  end if;
  asked := asked + 1;
  if (select count(*) from public.push_config) <> 1 then
    fails := array_append(fails, '0: push_config does not hold exactly one row');
  end if;
  /* blank, whatever it held: the kick's no-config case is asked below, and nothing here should
     kick a real deployment (it could not anyway — this rolls back — but it should not try) */
  update public.push_config set url = null, anon_key = null;

  /* ------------------------------------------------------------------- 1. privileges */
  asked := asked + 1;
  select string_agg(rl || ' has ' || pv || ' on ' || tb, ', ') into t
    from unnest(array['anon', 'authenticated']) rl,
         unnest(array['public.push_devices', 'public.push_prefs', 'public.push_outbox',
                      'public.push_config']) tb,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pv
   where has_table_privilege(rl, tb, pv);
  if t is not null then
    fails := array_append(fails, '1: a deny-all table is not: ' || t);
  end if;

  asked := asked + 1;
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('push_devices', 'push_prefs', 'push_outbox', 'push_config')
     and c.relrowsecurity
     and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid);
  if n <> 4 then
    fails := array_append(fails, format('1: %s of the 4 tables have RLS on and no policy', n));
  end if;

  asked := asked + 1;
  select string_agg(rl || ' has ' || pv, ', ') into t
    from unnest(array['anon', 'authenticated']) rl, unnest(array['USAGE', 'SELECT', 'UPDATE']) pv
   where has_sequence_privilege(rl, 'public.push_outbox_id_seq', pv);
  if t is not null then
    fails := array_append(fails, '1: the outbox sequence is reachable: ' || t);
  end if;

  asked := asked + 1;
  select string_agg(want.fn || ' for ' || want.rl || ': ' || h.has::text, '; ') into t
    from (values
      ('public.push_device_add(text, text, text, text)', 'authenticated', true),
      ('public.push_device_add(text, text, text, text)', 'anon', false),
      ('public.push_device_remove(text)', 'authenticated', true),
      ('public.push_device_remove(text)', 'anon', false),
      ('public.push_devices_mine()', 'authenticated', true),
      ('public.push_devices_mine()', 'anon', false),
      ('public.push_prefs_get()', 'authenticated', true),
      ('public.push_prefs_get()', 'anon', false),
      ('public.push_prefs_set(boolean, boolean, boolean, boolean, boolean)', 'authenticated', true),
      ('public.push_prefs_set(boolean, boolean, boolean, boolean, boolean)', 'anon', false),
      ('public.push_test()', 'authenticated', true),
      ('public.push_test()', 'anon', false),
      ('public.push_stuck()', 'authenticated', true),
      ('public.push_stuck()', 'anon', false),
      ('public.push_claim(integer)', 'service_role', true),
      ('public.push_claim(integer)', 'authenticated', false),
      ('public.push_claim(integer)', 'anon', false),
      ('public.push_done(bigint, text)', 'service_role', true),
      ('public.push_done(bigint, text)', 'authenticated', false),
      ('public.push_done(bigint, text)', 'anon', false),
      ('public.push_device_ok(uuid)', 'service_role', true),
      ('public.push_device_ok(uuid)', 'authenticated', false),
      ('public.push_device_ok(uuid)', 'anon', false),
      ('public.push_device_gone(uuid)', 'service_role', true),
      ('public.push_device_gone(uuid)', 'authenticated', false),
      ('public.push_device_gone(uuid)', 'anon', false),
      ('public.push_kick()', 'authenticated', false),
      ('public.push_kick()', 'anon', false),
      ('public.push_http_post(text, jsonb, jsonb)', 'authenticated', false),
      ('public.push_http_post(text, jsonb, jsonb)', 'anon', false),
      ('public.push_due(public.push_outbox)', 'authenticated', false),
      ('public.push_due(public.push_outbox)', 'anon', false),
      ('public.push_outbox_kick()', 'authenticated', false),
      ('public.push_outbox_kick()', 'anon', false)
    ) want(fn, rl, ok)
    cross join lateral (select has_function_privilege(want.rl, want.fn, 'execute') as has) h
   where h.has is distinct from want.ok;
  if t is not null then
    fails := array_append(fails, '1: a function privilege is wrong: ' || t);
  end if;

  /* the exact member surface, so a push_ function added later is a decision, not an accident */
  asked := asked + 1;
  select string_agg(p.proname, ', ' order by p.proname collate "C") into t
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'push\_%'
     and has_function_privilege('authenticated', p.oid, 'execute');
  if t is distinct from
     'push_device_add, push_device_remove, push_devices_mine, push_prefs_get, push_prefs_set, push_stuck, push_test'
  then
    fails := array_append(fails, '1: members can call ' || coalesce(t, 'nothing'));
  end if;
  asked := asked + 1;
  select string_agg(p.proname, ', ') into t
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'push\_%'
     and has_function_privilege('anon', p.oid, 'execute');
  if t is not null then
    fails := array_append(fails, '1: anon can call ' || t);
  end if;

  asked := asked + 1;
  select string_agg(p.proname, ', ') into t
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'push\_%'
     and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%');
  if t is not null then
    fails := array_append(fails, '1: these do not pin search_path: ' || t);
  end if;

  /* AFTER INSERT, FOR EACH STATEMENT (tgtype: bit 0 is ROW, bit 1 is BEFORE, bit 2 is INSERT) */
  asked := asked + 1;
  select count(*) into n from pg_trigger tg
   where tg.tgrelid = 'public.push_outbox'::regclass and not tg.tgisinternal
     and tg.tgfoid = 'public.push_outbox_kick()'::regprocedure
     and (tg.tgtype & 1) = 0 and (tg.tgtype & 2) = 0 and (tg.tgtype & 4) = 4;
  if n <> 1 or (select count(*) from pg_trigger tg
                 where tg.tgrelid = 'public.push_outbox'::regclass and not tg.tgisinternal) <> 1 then
    fails := array_append(fails, '1: push_outbox does not have exactly the one statement-level after-insert kick');
  end if;

  /* ------------------------------------------------------------------- 2. a member and their devices */
  perform set_config('request.jwt.claims', json_build_object('sub', o_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  asked := asked + 1;
  if public.push_devices_mine() <> '[]'::jsonb then
    fails := array_append(fails, '2: a member with no devices has some: ' || public.push_devices_mine()::text);
  end if;
  asked := asked + 1;
  j := public.push_prefs_get();
  if j <> '{"ring": true, "message": true, "post": true, "challenge": true, "chronicle": true}'::jsonb then
    fails := array_append(fails, '2: the defaults are not every kind on: ' || j::text);
  end if;

  asked := asked + 1;
  id1 := public.push_device_add(e1, good_key, good_auth, 'Pixel, Chrome');
  j := public.push_devices_mine();
  if jsonb_array_length(j) <> 1 or j->0->>'endpoint' is distinct from e1
     or j->0->>'label' is distinct from 'Pixel, Chrome' or (j->0->>'id')::uuid is distinct from id1 then
    fails := array_append(fails, '2: an added device reads back as ' || j::text);
  end if;
  asked := asked + 1;
  if j->0 ? 'p256dh' or j->0 ? 'auth' then
    fails := array_append(fails, '2: push_devices_mine hands back the subscription keys');
  end if;

  /* somewhere that is not a push service, five ways, each the same refusal */
  foreach t in array array[
    'https://evil.example/push/1',                 -- anywhere at all
    'http://fcm.googleapis.com/fcm/send/x',        -- not https
    'https://fcm.googleapis.com.evil.example/x',   -- the service's name as a prefix
    'https://fcm.googleapis.com@evil.example/x',   -- the service's name as a user
    'https://notfcm.googleapis.com/x'              -- the service's name as a suffix
  ] loop
    asked := asked + 1;
    begin
      perform public.push_device_add(t, good_key, good_auth);
      fails := array_append(fails, '2: stored a device whose push service is ' || t);
    exception when sqlstate '22023' then null;
    end;
  end loop;

  asked := asked + 1;
  begin
    perform public.push_device_add(e5, 'B' || repeat('A', 40), good_auth);
    fails := array_append(fails, '2: stored a p256dh too short to be a point');
  exception when sqlstate '22023' then null;
  end;
  asked := asked + 1;
  begin
    perform public.push_device_add(e5, good_key, repeat('a', 30));
    fails := array_append(fails, '2: stored an auth secret that is not 16 octets');
  exception when sqlstate '22023' then null;
  end;

  /* plain base64 with padding is the same key: it is stored url-safe and unpadded */
  asked := asked + 1;
  perform public.push_device_add(e2, 'B' || repeat('A+/a', 21) || 'Aa=', repeat('a+/b', 5) || 'cd==', 'Firefox');
  perform set_config('role', 'postgres', true);
  select d.id into dev2 from public.push_devices d
   where d.endpoint = e2
     and d.p256dh = 'B' || repeat('A-_a', 21) || 'Aa' and d.auth = repeat('a-_b', 5) || 'cd';
  if dev2 is null then
    fails := array_append(fails, '2: plain base64 keys were not stored as base64url');
  end if;
  perform set_config('role', 'authenticated', true);

  /* adding it again with no label keeps the label: null is "not saying", never "clear it" */
  asked := asked + 1;
  if public.push_device_add(e1, good_key, good_auth) is distinct from id1
     or (select x->>'label' from jsonb_array_elements(public.push_devices_mine()) x
          where x->>'endpoint' = e1) is distinct from 'Pixel, Chrome' then
    fails := array_append(fails, '2: adding a device again changed its id or lost its label');
  end if;

  /* one toggle at a time: a null leaves the others alone */
  asked := asked + 1;
  j := public.push_prefs_set(p_message => false);
  if j <> '{"ring": true, "message": false, "post": true, "challenge": true, "chronicle": true}'::jsonb then
    fails := array_append(fails, '2: turning messages off reads ' || j::text);
  end if;
  asked := asked + 1;
  j := public.push_prefs_set(p_ring => false);
  if j <> '{"ring": false, "message": false, "post": true, "challenge": true, "chronicle": true}'::jsonb then
    fails := array_append(fails, '2: a second toggle undid the first: ' || j::text);
  end if;
  asked := asked + 1;
  if public.push_prefs_get() <> j then
    fails := array_append(fails, '2: push_prefs_get disagrees with what push_prefs_set stored');
  end if;

  /* Send a test: to both devices, and once a minute */
  asked := asked + 1;
  n := public.push_test();
  if n <> 2 then
    fails := array_append(fails, format('2: the test said it was going to %s devices, not 2', n));
  end if;
  asked := asked + 1;
  begin
    perform public.push_test();
    fails := array_append(fails, '2: a second test inside a minute was queued');
  exception when sqlstate 'PT429' then null;
  end;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  select count(*) into n from public.push_outbox ob
   where ob.user_id = o_id and ob.kind = 'test' and ob.title = 'Test alert'
     and ob.url = '#account-settings' and ob.tag = 'test'
     and ob.sent_at is null and ob.attempts = 0 and ob.not_before <= now();
  if n <> 1 then
    fails := array_append(fails, format('2: %s test rows queued as described, not 1', n));
  end if;
  update public.push_outbox set created_at = now() - interval '61 seconds'
   where user_id = o_id and kind = 'test';
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.push_test();
  exception when others then
    fails := array_append(fails, '2: a test a minute after the last was refused: ' || sqlerrm);
  end;

  /* ------------------------------------------------------------------- 3. remove, return, move */
  asked := asked + 1;
  if not public.push_device_remove(e2) then
    fails := array_append(fails, '3: removing my own device said there was nothing to remove');
  end if;
  asked := asked + 1;
  if exists (select 1 from jsonb_array_elements(public.push_devices_mine()) x where x->>'endpoint' = e2) then
    fails := array_append(fails, '3: a removed device is still listed');
  end if;
  asked := asked + 1;
  if public.push_device_remove(e2) then
    fails := array_append(fails, '3: removing a device twice found it the second time');
  end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if not exists (select 1 from public.push_devices d where d.id = dev2 and d.gone_at is not null) then
    fails := array_append(fails, '3: a removed device was deleted, or not marked gone');
  end if;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if public.push_device_add(e2, good_key, good_auth) is distinct from dev2
     or not exists (select 1 from jsonb_array_elements(public.push_devices_mine()) x where x->>'endpoint' = e2) then
    fails := array_append(fails, '3: turning a removed device back on did not bring the same row back');
  end if;

  /* somebody else: they cannot remove it, and taking the browser over moves it to them */
  perform set_config('role', 'postgres', true);
  update public.push_devices set last_ok_at = now() - interval '1 hour' where id = id1;
  perform set_config('request.jwt.claims', json_build_object('sub', f_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.push_test();
    fails := array_append(fails, '3: a test was queued for a member with no device');
  exception when sqlstate 'P0002' then null;
  end;
  asked := asked + 1;
  if public.push_device_remove(e2) then
    fails := array_append(fails, '3: a member removed somebody else''s device');
  end if;
  asked := asked + 1;
  perform public.push_device_add(e1, good_key, good_auth, 'Tablet');
  j := public.push_devices_mine();
  if jsonb_array_length(j) <> 1 or j->0->>'endpoint' is distinct from e1
     or j->0->>'label' is distinct from 'Tablet' or j->0->>'last_ok_at' is not null then
    fails := array_append(fails, '3: a browser taken over reads, for its new holder, as ' || j::text);
  end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if (select count(*) from public.push_devices d where d.endpoint = e1) <> 1
     or not exists (select 1 from public.push_devices d
                     where d.endpoint = e1 and d.user_id = f_id and d.gone_at is null) then
    fails := array_append(fails, '3: the browser was copied, or did not move to the new account');
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', o_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if exists (select 1 from jsonb_array_elements(public.push_devices_mine()) x where x->>'endpoint' = e1) then
    fails := array_append(fails, '3: the browser still lists for the account it moved away from');
  end if;
  dev5 := public.push_device_add(e5, good_key, good_auth, 'Second phone');

  /* ------------------------------------------------------------------- 4. a suspended member */
  perform set_config('request.jwt.claims', json_build_object('sub', s_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.push_device_add(e3, good_key, good_auth);
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = true where user_id = s_id;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.push_device_add(e3, good_key, good_auth, 'renamed while suspended');
    fails := array_append(fails, '4: a suspended member added a device');
  exception when sqlstate '42501' then null;
  end;
  asked := asked + 1;
  begin
    perform public.push_prefs_set(p_post => false);
    fails := array_append(fails, '4: a suspended member changed their alerts');
  exception when sqlstate '42501' then null;
  end;
  asked := asked + 1;
  begin
    perform public.push_test();
    fails := array_append(fails, '4: a suspended member sent a test');
  exception when sqlstate '42501' then null;
  end;
  asked := asked + 1;
  if not public.push_device_remove(e3) then
    fails := array_append(fails, '4: a suspended member could not turn their own alerts off');
  end if;
  perform set_config('role', 'postgres', true);
  update public.profiles set suspended = false where user_id = s_id;

  /* ------------------------------------------------------------------- 5. the wrong caller at each door */
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
  foreach t in array array[
    'select public.push_device_add(''x'', ''y'', ''z'')', 'select public.push_device_remove(''x'')',
    'select public.push_devices_mine()', 'select public.push_prefs_get()',
    'select public.push_prefs_set()', 'select public.push_test()', 'select public.push_stuck()',
    'select public.push_claim(1)', 'select public.push_done(1, null)', 'select public.push_kick()',
    'select public.push_http_post(''https://example.com'', ''{}'', ''{}'')'
  ] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '5: anon ran ' || t);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', o_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach t in array array[
    'select public.push_claim(1)', 'select public.push_done(1, null)',
    'select public.push_device_ok(gen_random_uuid())', 'select public.push_device_gone(gen_random_uuid())',
    'select public.push_kick()', 'select public.push_http_post(''https://example.com'', ''{}'', ''{}'')'
  ] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, '5: a member ran ' || t);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  /* ------------------------------------------------------------------- 6. claim and done, as the push function */
  -- the cast now: seedowner has e2 and e5, seedfriend has e1, seedstranger has no live device
  insert into public.push_outbox (user_id, kind, title, body, url, tag)
  values (o_id, 'message', 'From the test', 'one', '#chat', 'pa-1') returning id into r1;
  insert into public.push_outbox (user_id, kind, title, url, tag, not_before)
  values (o_id, 'chronicle', 'Later', '#chronicle', 'pa-2', now() + interval '1 hour') returning id into r2;
  insert into public.push_outbox (user_id, kind, title, tag)
  values (f_id, 'post', 'For the friend', 'pa-3') returning id into r3;
  insert into public.push_outbox (user_id, kind, title, tag)
  values (s_id, 'ring', 'For nobody', 'pa-4') returning id into r4;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  j := public.push_claim(200);

  asked := asked + 1;
  select string_agg(x->>'id', ',' order by (x->>'id')::bigint) into t
    from jsonb_array_elements(j) x where (x->>'id')::bigint in (r1, r2, r3, r4);
  if t is distinct from concat_ws(',', r1, r3, r4) then
    fails := array_append(fails, format('6: the claim took %s of %s,%s,%s,%s (want every one but the alarm due in an hour)',
      coalesce(t, 'none'), r1, r2, r3, r4));
  end if;
  asked := asked + 1;
  select string_agg(d->>'endpoint', ' ' order by (d->>'endpoint') collate "C") into t
    from jsonb_array_elements(j) x, jsonb_array_elements(x->'devices') d
   where (x->>'id')::bigint = r1;
  if t is distinct from (select string_agg(ep, ' ' order by ep collate "C") from unnest(array[e2, e5]) ep) then
    fails := array_append(fails, '6: seedowner''s row went to ' || coalesce(t, 'no device') || ', not e2 and e5');
  end if;
  asked := asked + 1;
  /* id1 is still e1's row: a browser that moves keeps its row, and gets a new holder */
  if (select x->'devices' from jsonb_array_elements(j) x where (x->>'id')::bigint = r3)
       is distinct from jsonb_build_array(jsonb_build_object(
         'id', id1, 'endpoint', e1, 'p256dh', good_key, 'auth', good_auth)) then
    fails := array_append(fails, '6: seedfriend''s row does not carry exactly their one device and its keys');
  end if;
  asked := asked + 1;
  if (select x->'devices' from jsonb_array_elements(j) x where (x->>'id')::bigint = r4) is distinct from '[]'::jsonb then
    fails := array_append(fails, '6: a member whose only device is gone still has one to send to');
  end if;
  asked := asked + 1;
  if exists (select 1 from jsonb_array_elements(j) x
              where (x->>'id')::bigint in (r1, r3, r4) and (x->>'attempts')::int <> 1)
     or exists (select 1 from jsonb_array_elements(j) x where x ? 'user_id') then
    fails := array_append(fails, '6: a claimed row did not count one attempt, or names its member');
  end if;
  asked := asked + 1;
  if (select concat_ws('|', x->>'title', x->>'body', x->>'url', x->>'tag', x->>'kind')
        from jsonb_array_elements(j) x where (x->>'id')::bigint = r1)
     is distinct from 'From the test|one|#chat|pa-1|message' then
    fails := array_append(fails, '6: a claimed row does not carry what was queued');
  end if;

  /* ⚠️ THE LEASE: a second send a moment later must not take any of them again */
  asked := asked + 1;
  j := public.push_claim(200);
  if exists (select 1 from jsonb_array_elements(j) x where (x->>'id')::bigint in (r1, r3, r4)) then
    fails := array_append(fails, '6: a row claimed a moment ago was claimed again, so two sends would both deliver it');
  end if;

  asked := asked + 1;
  first_ := public.push_done(r1, null);
  again_ := public.push_done(r1, null);
  if not first_ or again_ then
    fails := array_append(fails, format('6: done is not once and only once (%s, then %s)', first_, again_));
  end if;
  asked := asked + 1;
  if not public.push_done(r3, '500 from fcm.googleapis.com') then
    fails := array_append(fails, '6: a failure could not be recorded');
  end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if not exists (select 1 from public.push_outbox ob where ob.id = r1 and ob.sent_at is not null and ob.last_error is null)
     or not exists (select 1 from public.push_outbox ob
                     where ob.id = r3 and ob.sent_at is null and ob.attempts = 1
                       and ob.last_error = '500 from fcm.googleapis.com') then
    fails := array_append(fails, '6: done did not mark the delivered row sent and keep the failed one waiting');
  end if;

  /* the lease runs out, and the failed row is offered again */
  update public.push_outbox set claimed_at = now() - interval '121 seconds' where id = r3;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  j := public.push_claim(200);
  if not exists (select 1 from jsonb_array_elements(j) x where (x->>'id')::bigint = r3 and (x->>'attempts')::int = 2) then
    fails := array_append(fails, '6: a failed row was not tried again once its lease ran out');
  end if;
  /* the fifth try is the last */
  perform set_config('role', 'postgres', true);
  update public.push_outbox set attempts = 5, claimed_at = null where id = r3;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  j := public.push_claim(200);
  if exists (select 1 from jsonb_array_elements(j) x where (x->>'id')::bigint = r3) then
    fails := array_append(fails, '6: a row was tried a sixth time');
  end if;
  /* the alarm's time comes */
  perform set_config('role', 'postgres', true);
  update public.push_outbox set not_before = now() - interval '1 second' where id = r2;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  j := public.push_claim(200);
  if not exists (select 1 from jsonb_array_elements(j) x where (x->>'id')::bigint = r2) then
    fails := array_append(fails, '6: a scheduled row was not taken once its time came');
  end if;

  /* what the push services said about two devices */
  asked := asked + 1;
  if not public.push_device_ok(dev2) then
    fails := array_append(fails, '6: push_device_ok found nothing to mark');
  end if;
  asked := asked + 1;
  first_ := public.push_device_gone(dev5);
  again_ := public.push_device_gone(dev5);
  if not first_ or again_ then
    fails := array_append(fails, format('6: push_device_gone is not once and only once (%s, then %s)', first_, again_));
  end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if not exists (select 1 from public.push_devices d where d.id = dev2 and d.last_ok_at is not null and d.gone_at is null)
     or not exists (select 1 from public.push_devices d where d.id = dev5 and d.gone_at is not null) then
    fails := array_append(fails, '6: ok and gone were not recorded on the devices');
  end if;
  insert into public.push_outbox (user_id, kind, title, tag)
  values (o_id, 'message', 'After a phone went', 'pa-5') returning id into r5;
  perform set_config('role', 'service_role', true);
  asked := asked + 1;
  j := public.push_claim(200);
  select string_agg(d->>'endpoint', ' ') into t
    from jsonb_array_elements(j) x, jsonb_array_elements(x->'devices') d where (x->>'id')::bigint = r5;
  if t is distinct from e2 then
    fails := array_append(fails, '6: after a device went, seedowner''s next alert goes to ' || coalesce(t, 'nobody'));
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', o_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if exists (select 1 from jsonb_array_elements(public.push_devices_mine()) x where x->>'endpoint' = e5) then
    fails := array_append(fails, '6: a device its push service called gone is still listed');
  end if;

  /* ⚠️ THE CAP, asked after the claims above because it leaves seedstranger with ten devices: ten
     live devices a member, a device already on the list is not a new one, and a phone turned off
     makes room. seedstranger's only earlier device is gone, so it starts from none. */
  perform set_config('request.jwt.claims', json_build_object('sub', s_id, 'role', 'authenticated')::text, true);
  for i in 1..10 loop
    perform public.push_device_add('https://fcm.googleapis.com/fcm/send/pa-cap-' || i, good_key, good_auth);
  end loop;
  asked := asked + 1;
  begin
    perform public.push_device_add('https://fcm.googleapis.com/fcm/send/pa-cap-11', good_key, good_auth);
    fails := array_append(fails, '6: an eleventh live device was added');
  exception when sqlstate '22023' then
    if sqlerrm not like '%10 devices%' then
      fails := array_append(fails, '6: the eleventh device was refused for another reason: ' || sqlerrm);
    end if;
  end;
  asked := asked + 1;
  begin
    perform public.push_device_add('https://fcm.googleapis.com/fcm/send/pa-cap-1', good_key, good_auth, 'Again');
  exception when others then
    fails := array_append(fails, '6: at ten, a device already on the list could not be added again: ' || sqlerrm);
  end;
  asked := asked + 1;
  perform public.push_device_remove('https://fcm.googleapis.com/fcm/send/pa-cap-2');
  begin
    perform public.push_device_add('https://fcm.googleapis.com/fcm/send/pa-cap-11', good_key, good_auth);
  exception when others then
    fails := array_append(fails, '6: turning a device off did not make room for another: ' || sqlerrm);
  end;
  asked := asked + 1;
  if jsonb_array_length(public.push_devices_mine()) <> 10 then
    fails := array_append(fails, format('6: after the cap, seedstranger has %s live devices, not 10',
      jsonb_array_length(public.push_devices_mine())));
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', o_id, 'role', 'authenticated')::text, true);

  /* ------------------------------------------------------------------- 7. push_stuck, admin only */
  stuck0 := (public.push_stuck()->>'stuck')::int;
  perform set_config('role', 'postgres', true);
  -- late: due ten minutes ago and never sent
  insert into public.push_outbox (user_id, kind, title, tag, not_before, last_error)
  values (o_id, 'message', 'Late', 'pa-6', now() - interval '10 minutes', 'pa-6 failed') returning id into r6;
  -- not late: sent, though due long ago
  insert into public.push_outbox (user_id, kind, title, tag, not_before, sent_at)
  values (o_id, 'message', 'Went', 'pa-7', now() - interval '10 minutes', now() - interval '9 minutes');
  -- not late: queued an hour ago for an hour from now, which counting from created_at would call stuck
  insert into public.push_outbox (user_id, kind, title, tag, created_at, not_before)
  values (o_id, 'chronicle', 'Tomorrow', 'pa-8', now() - interval '1 hour', now() + interval '1 hour');
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  j := public.push_stuck();
  if (j->>'stuck')::int is distinct from stuck0 + 1 or j->>'last_error' is distinct from 'pa-6 failed'
     or (j->>'oldest_due')::timestamptz > now() - interval '10 minutes' then
    fails := array_append(fails, format('7: with one alert late, push_stuck reads %s (it read %s stuck before)', j, stuck0));
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', f_id, 'role', 'authenticated')::text, true);
  asked := asked + 1;
  begin
    perform public.push_stuck();
    fails := array_append(fails, '7: a member who is not an admin read push_stuck');
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ------------------------------------------------------------------- 8. the kick */
  asked := asked + 1;
  t := public.push_kick();
  if t is distinct from 'not configured' then
    fails := array_append(fails, '8: with no config the kick said ' || coalesce(t, 'nothing'));
  end if;
  asked := asked + 1;
  begin
    insert into public.push_outbox (user_id, kind, title, tag) values (o_id, 'message', 'No config', 'pa-9');
  exception when others then
    fails := array_append(fails, '8: an alert could not be queued with no config: ' || sqlerrm);
  end;

  update public.push_config
     set url = 'http://127.0.0.1:9/functions/v1/push', anon_key = 'test-anon-key-not-a-real-one';

  if not net_real then
    asked := asked + 1;
    t := public.push_kick();
    if t is distinct from 'no pg_net' then
      fails := array_append(fails, '8: with no pg_net the kick said ' || coalesce(t, 'nothing'));
    end if;
    asked := asked + 1;
    begin
      insert into public.push_outbox (user_id, kind, title, tag) values (o_id, 'message', 'No pg_net', 'pa-10');
    exception when others then
      fails := array_append(fails, '8: an alert could not be queued with no pg_net: ' || sqlerrm);
    end;

    /* the stand-in, under the signature push_http_post calls. It rolls back with everything else. */
    execute 'create schema if not exists net';
    execute $stub$
      create function net.http_post(
        url text, body jsonb default '{}', params jsonb default '{}',
        headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language plpgsql as $fn$
      begin
        insert into pg_temp.kicks values (url, body, headers, timeout_milliseconds);
        return 1;
      end;
      $fn$
    $stub$;
  end if;

  /* the wire as the draft wrote it, through its own push_http_post. With the real pg_net the
     request is queued and never sent: pg_net sends after commit, and this rolls back. */
  asked := asked + 1;
  t := public.push_kick();
  if t is distinct from 'queued' then
    fails := array_append(fails, '8: with a config and work to do, the kick said ' || coalesce(t, 'nothing'));
  end if;
  if not net_real then
    asked := asked + 1;
    if (select count(*) from kicks) <> 1
       or not exists (select 1 from kicks k
                       where k.url = 'http://127.0.0.1:9/functions/v1/push'
                         and k.body = '{"op": "send"}'::jsonb and k.timeout_ms = 20000) then
      fails := array_append(fails, '8: net.http_post was handed ' || coalesce((select jsonb_agg(to_jsonb(k)) from kicks k)::text, 'nothing'));
    end if;
  end if;

  /* ⚠️ A RECORDER IN PLACE OF THE WIRE, ON EVERY STACK. Where pg_net is real its function belongs to
     the extension's owner and cannot be swapped; push_http_post belongs to the draft's, so from
     here on every check asks what was SENT, whichever pg_net this is. */
  execute $wire$
    create or replace function public.push_http_post(p_url text, p_body jsonb, p_headers jsonb)
    returns bigint language plpgsql set search_path = public, pg_temp as $fn$
    begin
      insert into pg_temp.kicks values (p_url, p_body, p_headers, null);
      return 1;
    end;
    $fn$
  $wire$;
  delete from kicks;

  /* a no-op with no config, even with pg_net there and work to do */
  update public.push_config set url = null, anon_key = null;
  asked := asked + 1;
  t := public.push_kick();
  if t is distinct from 'not configured' or (select count(*) from kicks) <> 0 then
    fails := array_append(fails, '8: with no config and work to do the kick said ' || coalesce(t, 'nothing')
      || format(' and sent %s request(s)', (select count(*) from kicks)));
  end if;
  update public.push_config
     set url = 'http://127.0.0.1:9/functions/v1/push', anon_key = 'test-anon-key-not-a-real-one';

  asked := asked + 1;
  t := public.push_kick();
  if t is distinct from 'queued' or (select count(*) from kicks) <> 1 then
    fails := array_append(fails, '8: with work to do the kick said ' || coalesce(t, 'nothing')
      || format(' and sent %s request(s)', (select count(*) from kicks)));
  end if;
  asked := asked + 1;
  if not exists (select 1 from kicks k
                  where k.url = 'http://127.0.0.1:9/functions/v1/push'
                    and k.body = '{"op": "send"}'::jsonb
                    and k.headers->>'apikey' = 'test-anon-key-not-a-real-one'
                    and k.headers->>'Authorization' = 'Bearer test-anon-key-not-a-real-one'
                    and k.headers->>'Content-Type' = 'application/json') then
    fails := array_append(fails, '8: the kick asked for ' || coalesce((select jsonb_agg(to_jsonb(k)) from kicks k)::text, 'nothing'));
  end if;

  /* nothing due, nothing sent: the cron's empty minute costs no function call */
  update public.push_outbox set sent_at = now() where sent_at is null;
  asked := asked + 1;
  t := public.push_kick();
  if t is distinct from 'nothing due' or (select count(*) from kicks) <> 1 then
    fails := array_append(fails, '8: with an empty queue the kick said ' || coalesce(t, 'nothing'));
  end if;

  /* one statement, one kick, however many rows it queues — and only for rows that are due */
  asked := asked + 1;
  insert into public.push_outbox (user_id, kind, title, tag)
  values (o_id, 'message', 'One', 'pa-11'), (f_id, 'message', 'Two', 'pa-12');
  if (select count(*) from kicks) <> 2 then
    fails := array_append(fails, format('8: a two-row insert kicked %s times, not once', (select count(*) from kicks) - 1));
  end if;
  update public.push_outbox set sent_at = now() where sent_at is null;
  asked := asked + 1;
  insert into public.push_outbox (user_id, kind, title, tag, not_before)
  values (o_id, 'chronicle', 'In an hour', 'pa-13', now() + interval '1 hour');
  if (select count(*) from kicks) <> 2 then
    fails := array_append(fails, '8: queueing an alert for later woke the function now');
  end if;

  /* the wire breaks: the kick says so, and the insert that caused it does not care */
  execute $wire$
    create or replace function public.push_http_post(p_url text, p_body jsonb, p_headers jsonb)
    returns bigint language plpgsql set search_path = public, pg_temp as $fn$
    begin
      raise exception 'the network broke';
    end;
    $fn$
  $wire$;
  asked := asked + 1;
  begin
    insert into public.push_outbox (user_id, kind, title, tag) values (o_id, 'message', 'Net broke', 'pa-14');
  exception when others then
    fails := array_append(fails, '8: a failed request failed the insert that caused it: ' || sqlerrm);
  end;
  asked := asked + 1;
  t := public.push_kick();
  if t is null or t not like 'failed: %the network broke%' then
    fails := array_append(fails, '8: a failed request was reported as ' || coalesce(t, 'nothing'));
  end if;

  /* ⚠️ THE TRIGGER'S OWN GUARD, whichever pg_net this is: a kick that raises outright */
  execute $kick$
    create or replace function public.push_kick()
    returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
    begin
      raise exception 'the kick broke';
    end;
    $fn$
  $kick$;
  asked := asked + 1;
  begin
    insert into public.push_outbox (user_id, kind, title, tag) values (o_id, 'message', 'Kick broke', 'pa-15');
  exception when others then
    fails := array_append(fails, '8: a kick that raised failed the insert that caused it: ' || sqlerrm);
  end;

  /* ------------------------------------------------------------------- 9. the sweep */
  if cron_here then
    asked := asked + 1;
    select count(*) into n from cron.job
     where jobname = 'push-sweep' and schedule = '* * * * *' and command = 'select public.push_kick()';
    if n <> 1 then
      fails := array_append(fails, '9: pg_cron is installed and the one-minute sweep is not scheduled');
    end if;
  end if;

 exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text;
  fails := array_append(fails, 'UNEXPECTED after ' || asked || ' checks: ' || st || ' ' || msg);
 end;
  perform set_config('role', 'postgres', true);
  if array_length(fails, 1) > 0 then
    raise exception E'PHONE ALERTS FAILED -- % of % checks:\n  %', array_length(fails, 1), asked,
      array_to_string(fails, E'\n  ');
  end if;
  raise notice 'phone alerts: all % checks hold (pg_net: %, pg_cron: %)', asked,
    case when net_real then 'real' else 'absent, a recording stub stood in' end,
    case when cron_here then 'the sweep is scheduled' else 'absent, no sweep to check' end;
end;
$$;

rollback;
