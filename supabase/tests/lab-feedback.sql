-- The Lab's catalog, votes and notes, asked as every kind of caller: a guest, the voter, another
-- member, a minor and the minor's friend, somebody the minor is NOT friends with, a member with no
-- age band, a suspended member, and a member trying to be the admin. Each case is a real call
-- under a real role with real claims, against the functions as the draft defines them.
--
-- HOW TO RUN: against a database that has supabase/drafts/lab-catalog-and-feedback.sql applied —
--   PGHOST=… PGPORT=… supabase/tests/plain-postgres/build.sh \
--     --draft supabase/drafts/lab-catalog-and-feedback.sql --test supabase/tests/lab-feedback.sql
-- Everything is in one transaction that rolls back; it leaves nothing behind. It raises, listing
-- every failed case, if anything is wrong, and says how many cases it asked otherwise.
--
-- ⚠️ IT REFUSES TO PASS BY ASKING NOTHING: block 0 checks the fixtures exist and are what the
-- cases assume (an adult, a minor, a suspended member…), the same shape as visibility-guards.sql.

begin;

-- fixtures: the seed's three, plus a minor, an unconnected adult and a suspended member
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000a4', 'minor@example.test'),
  ('00000000-0000-4000-a000-0000000000a5', 'adult@example.test'),
  ('00000000-0000-4000-a000-0000000000a6', 'suspended@example.test');
-- a username is claimed in the registry before a profile can carry it, as in seed.sql
insert into public.player_registry (player_name) values ('labminor'), ('labadult'), ('labbanned');
insert into public.profiles (user_id, username, age_band, suspended) values
  ('00000000-0000-4000-a000-0000000000a4', 'labminor', 'minor', false),
  ('00000000-0000-4000-a000-0000000000a5', 'labadult', 'adult', false),
  ('00000000-0000-4000-a000-0000000000a6', 'labbanned', 'adult', true);
-- the minor is friends with seedfriend, and with nobody else
insert into public.friendships (user_a, user_b, requested_by, status, responded_at) values
  (least('00000000-0000-4000-a000-000000000002'::uuid, '00000000-0000-4000-a000-0000000000a4'::uuid),
   greatest('00000000-0000-4000-a000-000000000002'::uuid, '00000000-0000-4000-a000-0000000000a4'::uuid),
   '00000000-0000-4000-a000-000000000002', 'accepted', now());

do $$
declare
  o  uuid := '00000000-0000-4000-a000-000000000001'; -- seedowner: the admin, an adult
  f  uuid := '00000000-0000-4000-a000-000000000002'; -- seedfriend: adult, the owner's and the minor's friend
  s  uuid := '00000000-0000-4000-a000-000000000003'; -- seedstranger: no age band, so Friends ceiling
  m  uuid := '00000000-0000-4000-a000-0000000000a4'; -- labminor: a minor, friends with f only
  a  uuid := '00000000-0000-4000-a000-0000000000a5'; -- labadult: an adult, friends with nobody
  x  uuid := '00000000-0000-4000-a000-0000000000a6'; -- labbanned: suspended
  fails text[] := '{}';
  asked int := 0;
  j jsonb;
  t text;
  n int;
  note_a uuid; note_m uuid; note_s uuid; note_x uuid; note_f uuid;
  last_at timestamptz; last_id uuid; seen uuid[];
  row_for jsonb;
begin
 -- an unexpected error part-way is reported WITH the failures collected before it, so a broken
 -- rule names itself rather than surfacing as whatever later case tripped over its consequence
 begin
  /* ---------------------------------------------------------------- 0. the fixtures are real */
  if not public.visibility_ceiling(m) = 'friends' or not public.visibility_ceiling(a) = 'members'
     or not public.visibility_ceiling(s) = 'friends' or not public.visibility_ceiling(o) = 'public'
     or not exists (select 1 from public.admin_users where user_id = o)
     or (select count(*) from public.lab_demos) < 51 then
    raise exception 'FIXTURE: the ceilings, the admin or the demo rows are not what these cases assume';
  end if;

  /* ---------------------------------------------------------------- 1. nothing by table verb */
  asked := asked + 1;
  select count(*) into n
  from (values ('lab_demos'), ('lab_votes'), ('lab_comments'), ('lab_comment_reports')) t(tb)
  cross join (values ('anon'), ('authenticated')) r(role)
  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
  where has_table_privilege(r.role, 'public.' || t.tb, p.priv);
  if n <> 0 then fails := array_append(fails, (format('1: %s table privileges held by anon/authenticated', n))::text); end if;

  asked := asked + 1;
  if exists (select 1 from pg_class c join pg_namespace s2 on s2.oid = c.relnamespace
             where s2.nspname = 'public' and c.relname like 'lab\_%' and c.relkind = 'r'
               and not c.relrowsecurity) then
    fails := array_append(fails, ('1: a lab table without RLS')::text);
  end if;

  asked := asked + 1;
  -- exactly these are callable: a new lab function that hands out voters would show up here
  select string_agg(p.proname || ':' || (case when has_function_privilege('anon', p.oid, 'execute') then 'anon' else '' end)
                    || (case when has_function_privilege('authenticated', p.oid, 'execute') then '+auth' else '' end),
                    ' ' order by p.proname) into t
  from pg_proc p join pg_namespace s2 on s2.oid = p.pronamespace
  where s2.nspname = 'public' and (p.proname like 'lab\_%' or p.proname like 'admin\_lab\_%')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if t is distinct from 'admin_lab_moderate:+auth admin_lab_register:+auth admin_lab_reports:+auth admin_lab_set_demo:+auth lab_catalog:anon+auth lab_comment_add:+auth lab_comment_delete:+auth lab_comment_edit:+auth lab_comment_report:+auth lab_comments_page:+auth lab_vote:+auth' then
    fails := array_append(fails, (('1: callable lab functions are ' || coalesce(t, 'none')))::text);
  end if;

  -- a member trying the tables directly is refused, TRUNCATE included
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach t in array array['select count(*) from public.lab_votes',
                           'insert into public.lab_votes values (''00000000-0000-4000-a000-0000000000a5'', ''swarm'', 1)',
                           'update public.lab_demos set hidden = true',
                           'delete from public.lab_comments',
                           'truncate public.lab_comment_reports'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('1: a member ran ' || t))::text);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 2. a guest */
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  asked := asked + 1;
  j := public.lab_catalog();
  if jsonb_array_length(j) < 51 or exists (select 1 from jsonb_array_elements(j) e
       where e ? 'up' or e ? 'down' or e ? 'few' or e ? 'mine' or e ? 'notes' or e ? 'reports') then
    fails := array_append(fails, ('2: a guest catalog carries counts, or is short')::text);
  end if;
  foreach t in array array['select public.lab_vote(''swarm'', 1)',
                           'select public.lab_comment_add(''swarm'', ''idea'', ''hello there'')',
                           'select public.lab_comments_page(''swarm'')',
                           'select public.admin_lab_reports()'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('2: a guest ran ' || t))::text);
    -- refused by the grant, or by the function's own first line: either holds, and section 1
    -- is where a grant that should not exist is caught
    exception when insufficient_privilege or invalid_authorization_specification then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 3. votes */
  -- a: +1, again +1, then −1, then 0 — always one row, the last word wins
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.lab_vote('swarm', 1);
  asked := asked + 1;
  -- the only vote there is: the voter is told their own, and the actual total at once — one
  if (j ->> 'mine')::int <> 1 or (j ->> 'up')::int is distinct from 1
     or (j ->> 'down')::int is distinct from 0 or j ? 'few' then
    fails := array_append(fails, (('3: first vote answered ' || j::text))::text);
  end if;
  j := public.lab_vote('swarm', 1);
  j := public.lab_vote('swarm', -1);
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if (select value from public.lab_votes where user_id = a and demo_id = 'swarm') <> -1 then
    fails := array_append(fails, ('3: a changed vote did not change'::text));
  end if;
  asked := asked + 1;
  if (select count(*) from public.lab_votes where user_id = a and demo_id = 'swarm') <> 1 then
    fails := array_append(fails, ('3: a changed vote is not one row')::text);
  end if;
  perform set_config('role', 'authenticated', true);
  j := public.lab_vote('swarm', 0);
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if exists (select 1 from public.lab_votes where user_id = a and demo_id = 'swarm') or j ? 'mine' and j ->> 'mine' is not null then
    fails := array_append(fails, ('3: a removed vote is still there')::text);
  end if;

  -- bad values, unknown demos
  perform set_config('role', 'authenticated', true);
  foreach t in array array['select public.lab_vote(''swarm'', 2)', 'select public.lab_vote(''swarm'', null)',
                           'select public.lab_vote(''no-such-toy'', 1)', 'select public.lab_vote(null, 1)'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('3: accepted ' || t))::text);
    exception when others then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);

  -- every member who may vote counts — an adult, the admin, a minor, an unknown age — and a
  -- suspended member's earlier vote does not, while they are suspended
  foreach t in array array[a::text, f::text, o::text, m::text, s::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.lab_vote('life', 1);
    perform set_config('role', 'postgres', true);
  end loop;
  insert into public.lab_votes (user_id, demo_id, value) values (x, 'life', -1); -- from before the suspension
  for t in select unnest(array[f::text, m::text, s::text, o::text]) loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select e into row_for from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'life';
    perform set_config('role', 'postgres', true);
    asked := asked + 1;
    if (row_for ->> 'up')::int <> 5 or (row_for ->> 'down')::int <> 0 or (row_for ->> 'mine')::int <> 1
       or row_for ? 'withheld' or row_for ? 'counted' or row_for ? 'few' then
      fails := array_append(fails, (format('3: %s sees life as %s',
        (select username from public.profiles where user_id = t::uuid), row_for))::text);
    end if;
  end loop;
  -- the catalog never names anybody
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.lab_catalog();
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if j::text ~ (m::text || '|' || a::text || '|' || f::text || '|' || x::text || '|labminor|labadult|seedfriend|labbanned') then
    fails := array_append(fails, ('3: the catalog names a voter')::text);
  end if;

  -- NO FLOOR (Evan, 8 Nov): every member sees the actual totals at once — zeros included, and a
  -- single vote as a single vote, to a voter and a non-voter alike. Nothing names the voter.
  for t in select unnest(array[m::text, a::text, s::text, o::text]) loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select e into row_for from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fluid';
    perform set_config('role', 'postgres', true);
    asked := asked + 1;
    if (row_for ->> 'up')::int is distinct from 0 or (row_for ->> 'down')::int is distinct from 0
       or row_for ? 'few' then
      fails := array_append(fails, (format('3: an unvoted experiment shows %s as %s',
        (select username from public.profiles where user_id = t::uuid), row_for))::text);
    end if;
  end loop;
  -- one vote, from the minor: the minor and everybody else see 0 up, 1 down straight away
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.lab_vote('fluid', -1);
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if (j ->> 'up')::int is distinct from 0 or (j ->> 'down')::int is distinct from 1 then
    fails := array_append(fails, ('3: a single vote answered ' || j::text)::text);
  end if;
  for t, n in select * from (values (m::text, -1), (a::text, 0), (s::text, 0), (o::text, 0)) q loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select e into row_for from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fluid';
    perform set_config('role', 'postgres', true);
    asked := asked + 1;
    if (row_for ->> 'up')::int is distinct from 0 or (row_for ->> 'down')::int is distinct from 1
       or row_for ? 'few' or (n = -1) <> ((row_for ->> 'mine')::int is not distinct from -1)
       or (n = 0 and row_for ? 'mine') then
      fails := array_append(fails, (format('3: one vote shows %s fluid as %s',
        (select username from public.profiles where user_id = t::uuid), row_for))::text);
    end if;
  end loop;
  -- three more voters: every member sees the four, moving with each vote
  foreach t in array array[a::text, f::text, s::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    j := public.lab_vote('fluid', case when t = s::text then 1 else -1 end);
    perform set_config('role', 'postgres', true);
  end loop;
  asked := asked + 1;
  if (j ->> 'up')::int <> 1 or (j ->> 'down')::int <> 3 then
    fails := array_append(fails, ('3: the fourth vote answered ' || j::text)::text);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select e into row_for from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fluid';
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if (row_for ->> 'up')::int <> 1 or (row_for ->> 'down')::int <> 3 or row_for ? 'mine' then
    fails := array_append(fails, ('3: after four votes the admin sees ' || coalesce(row_for::text, 'nothing'))::text);
  end if;
  -- a suspended member cannot vote
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_vote('swarm', 1);
    fails := array_append(fails, ('3: a suspended member voted')::text);
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 4. notes: writing */
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.lab_comment_add('swarm', 'idea', E'  More colours,\r\nplease.  ');
  note_a := (j ->> 'id')::uuid;
  asked := asked + 1;
  if j ->> 'body' <> E'More colours,\nplease.' or not (j ->> 'mine')::boolean or j ->> 'author' <> 'labadult' then
    fails := array_append(fails, (('4: a note came back as ' || j::text))::text);
  end if;
  j := public.lab_comment_add('swarm', 'bug', '<b>not bold</b> & <script>x</script>');
  asked := asked + 1;
  if j ->> 'body' <> '<b>not bold</b> & <script>x</script>' then
    fails := array_append(fails, ('4: markup was changed rather than kept as the plain text it is')::text);
  end if;
  foreach t in array array[
      'select public.lab_comment_add(''swarm'', ''idea'', '''')',
      'select public.lab_comment_add(''swarm'', ''idea'', ''   '')',
      'select public.lab_comment_add(''swarm'', ''idea'', ''x'')',
      'select public.lab_comment_add(''swarm'', ''idea'', repeat(''y'', 501))',
      'select public.lab_comment_add(''swarm'', ''idea'', ''a'' || repeat(E''\nb'', 9))',
      'select public.lab_comment_add(''swarm'', ''idea'', E''bell\x07ringing'')',
      'select public.lab_comment_add(''swarm'', ''praise'', ''hello there'')',
      'select public.lab_comment_add(''swarm'', ''idea'', null)',
      'select public.lab_comment_add(''no-such-toy'', ''idea'', ''hello there'')'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('4: accepted ' || t))::text);
    exception when others then null;
    end;
  end loop;
  -- a pasted tab is a space, not a refusal
  asked := asked + 1;
  j := public.lab_comment_add('swarm', 'idea', E'tab\there');
  if j ->> 'body' <> 'tab here' then
    fails := array_append(fails, '4: a tab was not made a space'::text);
  end if;
  perform public.lab_comment_delete((j ->> 'id')::uuid); -- so it is not one of the five
  asked := asked + 1;
  begin
    perform public.lab_comment_add('swarm', 'idea', repeat('z', 500));
    perform public.lab_comment_add('swarm', 'idea', 'a' || repeat(E'\nb', 8));
  exception when others then fails := array_append(fails, (('4: refused a note at the limits: ' || sqlerrm))::text);
  end;
  asked := asked + 1;
  begin
    perform public.lab_comment_add('swarm', 'more', 'More colours,' || E'\n' || 'please.');
    fails := array_append(fails, ('4: the same note twice in a day')::text);
  exception when unique_violation then null;
  end;
  perform set_config('role', 'postgres', true);

  -- the minor, the no-age member and the suspended member each leave one
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  note_m := (public.lab_comment_add('swarm', 'more', 'I want a bigger swarm') ->> 'id')::uuid;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  note_s := (public.lab_comment_add('swarm', 'bug', 'It froze on my laptop') ->> 'id')::uuid;
  perform set_config('role', 'postgres', true);
  insert into public.lab_comments (demo_id, user_id, kind, body) values ('swarm', x, 'idea', 'from before the suspension')
  returning id into note_x;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_add('swarm', 'idea', 'still here');
    fails := array_append(fails, ('4: a suspended member posted')::text);
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 5. notes: who reads which */
  -- [viewer, note, should see]. ⚠️ THE ADMIN (o) IS A MEMBER HERE LIKE ANY OTHER: they read the
  -- adult's note through the ladder and NOT the minor's, the unknown age's or the suspended
  -- member's — none of which reaches them, and none of which anybody has reported
  for j in select jsonb_build_object('v', v, 'n', nn, 'see', see) from (values
      (a, note_a, true), (f, note_a, true), (s, note_a, true), (m, note_a, true), (o, note_a, true),
      (m, note_m, true), (f, note_m, true), (o, note_m, false), (a, note_m, false), (s, note_m, false),
      (s, note_s, true), (o, note_s, false), (f, note_s, false), (a, note_s, false), (m, note_s, false),
      (x, note_x, true), (o, note_x, false), (a, note_x, false), (f, note_x, false)
    ) q(v, nn, see) loop
    asked := asked + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', j ->> 'v', 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from jsonb_array_elements(public.lab_comments_page('swarm', null, null, 30) -> 'items') e
     where e ->> 'id' = j ->> 'n';
    perform set_config('role', 'postgres', true);
    if (n = 1) <> (j ->> 'see')::boolean then
      fails := fails || format('5: %s reading %s: saw %s, expected %s',
        (select username from public.profiles where user_id = (j ->> 'v')::uuid),
        (select username from public.profiles p join public.lab_comments c on c.user_id = p.user_id where c.id = (j ->> 'n')::uuid),
        n = 1, j ->> 'see');
    end if;
  end loop;

  -- a note cannot be reported by somebody it does not reach: the same answer as no note at all
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_report(note_m, 'unkind');
    fails := array_append(fails, ('5: reported a note it cannot see')::text);
  exception when no_data_found then
    if sqlerrm <> 'no such note' then fails := array_append(fails, (('5: the refusal said ' || sqlerrm))::text); end if;
  end;
  asked := asked + 1;
  begin
    perform public.lab_comment_report(gen_random_uuid(), 'unkind');
    fails := array_append(fails, ('5: reported a note that does not exist')::text);
  exception when no_data_found then
    if sqlerrm <> 'no such note' then fails := array_append(fails, (('5: the refusal said ' || sqlerrm))::text); end if;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 6. edit and delete */
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach t in array array[format('select public.lab_comment_edit(%L, ''hijacked'')', note_a),
                           format('select public.lab_comment_delete(%L)', note_a)] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('6: another member ran ' || t))::text);
    exception when no_data_found then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.lab_comment_edit(note_a, null, 'more');
  asked := asked + 1;
  if j ->> 'body' <> E'More colours,\nplease.' or j ->> 'kind' <> 'more' or j ->> 'edited' is null then
    fails := array_append(fails, (('6: a kind-only edit came back as ' || j::text))::text);
  end if;
  j := public.lab_comment_edit(note_a, 'More colours and a slower drift');
  asked := asked + 1;
  if j ->> 'body' <> 'More colours and a slower drift' then fails := array_append(fails, ('6: the edit did not take')::text); end if;
  asked := asked + 1;
  begin
    perform public.lab_comment_edit(note_a, repeat('w', 501));
    fails := array_append(fails, ('6: an edit past the length')::text);
  exception when check_violation then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 7. reports and moderation */
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if public.lab_comment_report(note_a, 'unkind') <> 'reported' or public.lab_comment_report(note_a, 'spam') <> 'already' then
    fails := array_append(fails, ('7: report / report again')::text);
  end if;
  foreach t in array array[format('select public.lab_comment_report(%L, ''rude'')', note_a),
                           'select public.admin_lab_reports()',
                           format('select public.admin_lab_moderate(%L, ''remove'')', note_a),
                           'select public.admin_lab_set_demo(''swarm'', true)',
                           'select public.admin_lab_register(array[''sneaky''])'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('7: a member ran ' || t))::text);
    exception when others then
      if sqlstate not in ('42501', '22023') then fails := array_append(fails, (('7: ' || t || ' failed oddly: ' || sqlerrm))::text); end if;
    end;
  end loop;
  -- a member cannot make themselves the admin by the table either
  asked := asked + 1;
  begin
    insert into public.admin_users (user_id) values (f);
    fails := array_append(fails, ('7: a member wrote admin_users')::text);
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_report(note_a, 'spam');
    fails := array_append(fails, ('7: reported their own note')::text);
  exception when invalid_parameter_value then null;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.lab_comment_report(note_a, 'spam');
  exception when others then
    fails := array_append(fails, ('7: a second member could not report: ' || sqlerrm)::text);
  end;
  perform set_config('role', 'postgres', true);

  -- the admin sees the report, by reason, and never who made it
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.admin_lab_reports();
  asked := asked + 1;
  if jsonb_array_length(j) <> 1 or j -> 0 ->> 'id' <> note_a::text
     or j -> 0 -> 'reasons' <> '{"spam": 1, "unkind": 1}'::jsonb then
    fails := array_append(fails, (('7: the admin sees reports as ' || j::text))::text);
  end if;
  asked := asked + 1;
  if j::text ~ (f::text || '|' || s::text || '|seedfriend|seedstranger') then
    fails := array_append(fails, ('7: the report list names a reporter')::text);
  end if;
  select (e ->> 'reports')::int into n from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'swarm';
  asked := asked + 1;
  if n <> 1 then fails := array_append(fails, (format('7: the admin catalog counts %s reported notes on swarm', n))::text); end if;
  -- the admin's note counts are the notes THEY CAN READ — the same number the page gives them,
  -- and fewer than the table holds, since the minor's, the unknown age's and the suspended
  -- member's notes do not reach them
  select (select sum(v::int) from jsonb_each_text(e -> 'notes') x(k, v)) into n
    from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'swarm';
  asked := asked + 1;
  if n <> jsonb_array_length(public.lab_comments_page('swarm', null, null, 30) -> 'items') then
    fails := array_append(fails, (format('7: the admin catalog counts %s notes on swarm, the page shows %s', n,
      jsonb_array_length(public.lab_comments_page('swarm', null, null, 30) -> 'items')))::text);
  end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if n >= (select count(*) from public.lab_comments where demo_id = 'swarm' and removed_at is null) then
    fails := array_append(fails, ('7: the admin catalog counts notes the admin cannot read'::text));
  end if;
  perform set_config('role', 'authenticated', true);
  -- no standing access: an unreported note the ladder keeps from the admin cannot be moderated,
  -- and the refusal is the one a missing note gets
  foreach t in array array[format('select public.admin_lab_moderate(%L, ''remove'')', note_m),
                           format('select public.admin_lab_moderate(%L, ''keep'')', note_s),
                           format('select public.admin_lab_moderate(%L, ''remove'')', note_x),
                           format('select public.admin_lab_moderate(%L, ''remove'')', gen_random_uuid())] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, ('7: the admin moderated an unreported note they cannot see: ' || t)::text);
    exception when no_data_found then
      if sqlerrm <> 'no such note' then fails := array_append(fails, ('7: the refusal said ' || sqlerrm)::text); end if;
    end;
  end loop;
  asked := asked + 1;
  if public.admin_lab_reports()::text ~ (note_m::text || '|' || note_s::text || '|' || note_x::text) then
    fails := array_append(fails, ('7: the report queue holds a note nobody reported'::text));
  end if;
  perform set_config('role', 'postgres', true);
  -- the minor's friend reports the minor's note: now — and only through the queue — the admin
  -- reads it and may act on it, while the page still does not show it to them
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.lab_comment_report(note_m, 'unsafe');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select e into row_for from jsonb_array_elements(public.admin_lab_reports()) e where e ->> 'id' = note_m::text;
  asked := asked + 1;
  if row_for is null or row_for ->> 'body' is null or row_for ->> 'state' <> 'open'
     or row_for -> 'reasons' <> '{"unsafe": 1}'::jsonb then
    fails := array_append(fails, ('7: a reported private note in the queue: ' || coalesce(row_for::text, 'missing'))::text);
  end if;
  asked := asked + 1;
  if exists (select 1 from jsonb_array_elements(public.lab_comments_page('swarm', null, null, 30) -> 'items') e
             where e ->> 'id' = note_m::text) then
    fails := array_append(fails, ('7: a report put a private note on the admin''s page'::text));
  end if;
  asked := asked + 1;
  begin
    perform public.admin_lab_moderate(note_m, 'keep');
  exception when others then
    fails := array_append(fails, ('7: the admin could not act on a reported note: ' || sqlerrm)::text);
  end;
  row_for := null;
  j := public.admin_lab_moderate(note_a, 'remove');
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if exists (select 1 from public.lab_comment_reports where comment_id = note_a and resolved_at is null)
     or (select resolution from public.lab_comment_reports where comment_id = note_a and reporter = f) <> 'removed' then
    fails := array_append(fails, ('7: removing did not close its reports')::text);
  end if;
  -- removed: gone for the others — the admin included, on the page — and still there for its
  -- author with its text
  for t, n in select * from (values (f::text, 0), (s::text, 0), (a::text, 1), (o::text, 0)) q loop
    asked := asked + 1;
    perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select e into row_for from jsonb_array_elements(public.lab_comments_page('swarm', null, null, 30) -> 'items') e
     where e ->> 'id' = note_a::text;
    perform set_config('role', 'postgres', true);
    if (row_for is not null)::int <> n or (row_for is not null and (not (row_for ->> 'removed')::boolean or row_for ->> 'body' is null)) then
      fails := array_append(fails, (format('7: after removal, %s sees %s', t, coalesce(row_for::text, 'nothing')))::text);
    end if;
    row_for := null;
  end loop;
  -- the admin finds it in the queue as removed, which is where it is restored from
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select e into row_for from jsonb_array_elements(public.admin_lab_reports()) e where e ->> 'id' = note_a::text;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if row_for is null or row_for ->> 'state' <> 'removed' then
    fails := array_append(fails, ('7: a removed note is not in the queue to restore: ' || coalesce(row_for::text, 'missing'))::text);
  end if;
  row_for := null;
  -- a removed note cannot be edited back into view, and the admin can restore it
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_edit(note_a, 'edited after removal');
    fails := array_append(fails, ('7: edited a removed note')::text);
  exception when no_data_found then null;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.admin_lab_moderate(note_a, 'restore');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from jsonb_array_elements(public.lab_comments_page('swarm', null, null, 30) -> 'items') e
   where e ->> 'id' = note_a::text and not (e ->> 'removed')::boolean;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if n <> 1 then fails := array_append(fails, ('7: a restored note is not back')::text); end if;

  -- the author deletes their note, and its reports go with it
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  if not public.lab_comment_delete(note_a) then fails := array_append(fails, ('7: delete said no')::text); end if;
  perform set_config('role', 'postgres', true);
  asked := asked + 1;
  if exists (select 1 from public.lab_comments where id = note_a)
     or exists (select 1 from public.lab_comment_reports where comment_id = note_a) then
    fails := array_append(fails, ('7: a deleted note or its reports remain')::text);
  end if;

  /* ---------------------------------------------------------------- 8. limits */
  -- a fresh author, five recent notes already: the sixth is refused
  delete from public.lab_comments where user_id = f;
  insert into public.lab_comments (demo_id, user_id, kind, body, created_at)
  select 'life', f, 'idea', 'note number ' || g, now() - make_interval(mins => g) from generate_series(1, 5) g;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_add('life', 'idea', 'a sixth inside ten minutes');
    fails := array_append(fails, ('8: six notes in ten minutes')::text);
  exception when program_limit_exceeded then null;
  end;
  perform set_config('role', 'postgres', true);
  -- …and twenty in a day, spread out so the ten-minute rule is not the one answering
  delete from public.lab_comments where user_id = f;
  insert into public.lab_comments (demo_id, user_id, kind, body, created_at)
  select 'life', f, 'idea', 'older note ' || g, now() - make_interval(mins => 15 + g * 60) from generate_series(1, 20) g;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_add('life', 'idea', 'the twenty-first today');
    fails := array_append(fails, ('8: twenty-one notes in a day')::text);
  exception when program_limit_exceeded then null;
  end;
  perform set_config('role', 'postgres', true);
  -- …and once a day has passed, a note goes in
  update public.lab_comments set created_at = created_at - interval '1 day' where user_id = f;
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    perform public.lab_comment_add('life', 'idea', 'the next day');
  exception when others then fails := array_append(fails, (('8: refused after the day passed: ' || sqlerrm))::text);
  end;
  perform set_config('role', 'postgres', true);
  -- ten reports an hour
  insert into public.lab_comments (demo_id, user_id, kind, body)
  select 'fluid', o, 'idea', 'owner note ' || g from generate_series(1, 11) g;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  begin
    for j in select e from jsonb_array_elements(public.lab_comments_page('fluid', null, null, 30) -> 'items') e loop
      perform public.lab_comment_report((j ->> 'id')::uuid, 'other');
    end loop;
    fails := array_append(fails, ('8: eleven reports in an hour')::text);
  exception when program_limit_exceeded then null;
  end;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 9. paging */
  delete from public.lab_comments where demo_id = 'galaxy';
  insert into public.lab_comments (demo_id, user_id, kind, body, created_at)
  select 'galaxy', o, 'idea', 'galaxy note ' || g, now() - interval '3 days' - make_interval(secs => g)
  from generate_series(1, 25) g;
  -- two at the very same instant, so the id has to break the tie
  update public.lab_comments set created_at = now() - interval '3 days' - interval '10 seconds'
   where demo_id = 'galaxy' and body in ('galaxy note 10', 'galaxy note 11');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  seen := '{}';
  j := public.lab_comments_page('galaxy', null, null, 20);
  asked := asked + 1;
  if jsonb_array_length(j -> 'items') <> 20 or not (j ->> 'more')::boolean then
    fails := array_append(fails, (format('9: page one held %s, more=%s', jsonb_array_length(j -> 'items'), j ->> 'more'))::text);
  end if;
  seen := seen || array(select (e ->> 'id')::uuid from jsonb_array_elements(j -> 'items') e);
  last_at := (j -> 'items' -> 19 ->> 'at')::timestamptz;
  last_id := (j -> 'items' -> 19 ->> 'id')::uuid;
  j := public.lab_comments_page('galaxy', last_at, last_id, 20);
  asked := asked + 1;
  if jsonb_array_length(j -> 'items') <> 5 or (j ->> 'more')::boolean then
    fails := array_append(fails, (format('9: page two held %s, more=%s', jsonb_array_length(j -> 'items'), j ->> 'more'))::text);
  end if;
  seen := seen || array(select (e ->> 'id')::uuid from jsonb_array_elements(j -> 'items') e);
  asked := asked + 1;
  if (select count(distinct u) from unnest(seen) u) <> 25 then
    fails := array_append(fails, ('9: the two pages overlap or miss a note')::text);
  end if;
  asked := asked + 1;
  if jsonb_array_length(public.lab_comments_page('galaxy', null, null, 500) -> 'items') <> 25
     or jsonb_array_length(public.lab_comments_page('galaxy', null, null, 0) -> 'items') <> 1 then
    -- 25 because a page is capped at 30; 1 because a limit is at least one
    fails := array_append(fails, ('9: the page size is not clamped to 1..30')::text);
  end if;
  perform set_config('role', 'postgres', true);

  /* ---------------------------------------------------------------- 10. the owner's controls */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.admin_lab_set_demo('fold', p_featured => true);
  j := public.admin_lab_set_demo('fold', p_hidden => true);
  asked := asked + 1;
  if not (j ->> 'featured')::boolean or not (j ->> 'hidden')::boolean or (j ->> 'experiment')::boolean then
    fails := array_append(fails, (('10: a null flag was not left alone: ' || j::text))::text);
  end if;
  asked := asked + 1;
  if not exists (select 1 from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fold' and (e ->> 'hidden')::boolean) then
    fails := array_append(fails, ('10: the admin does not see the hidden experiment')::text);
  end if;
  asked := asked + 1;
  if public.admin_lab_register(array['swarm', 'a-new-toy', 'a-new-toy']) <> 1 then
    fails := array_append(fails, ('10: registering counted wrong')::text);
  end if;
  asked := asked + 1;
  begin
    perform public.admin_lab_register(array['Not An Id']);
    fails := array_append(fails, ('10: registered a malformed id')::text);
  exception when check_violation then null;
  end;
    -- the admin cannot add to a retired experiment either: hidden is retired, not a private room
  foreach t in array array['select public.lab_vote(''fold'', 1)',
                           'select public.lab_comment_add(''fold'', ''idea'', ''one more thing'')'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, ('10: on a hidden experiment the admin ran ' || t)::text);
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);
  -- a vote and a note on fold from before it was hidden
  insert into public.lab_votes (user_id, demo_id, value) values (a, 'fold', 1);
  insert into public.lab_comments (demo_id, user_id, kind, body) values ('fold', a, 'bug', 'the crease jumps');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  asked := asked + 1;
  -- listed as hidden, so the page leaves it out — and carrying nothing but that
  if (select e from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fold')
     is distinct from '{"id": "fold", "hidden": true}'::jsonb then
    fails := array_append(fails, ('10: a member is told about a hidden experiment: ' || coalesce(
      (select e::text from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fold'), 'nothing'))::text);
  end if;
  foreach t in array array['select public.lab_vote(''fold'', -1)',
                           'select public.lab_comment_add(''fold'', ''idea'', ''bring it back'')',
                           'select public.lab_comments_page(''fold'')'] loop
    asked := asked + 1;
    begin
      execute t;
      fails := array_append(fails, (('10: on a hidden experiment a member ran ' || t))::text);
    exception when no_data_found or insufficient_privilege then null;
    end;
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  asked := asked + 1;
  if (select e from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fold')
     is distinct from '{"id": "fold", "hidden": true}'::jsonb then
    fails := array_append(fails, ('10: a guest is told about a hidden experiment wrongly')::text);
  end if;
  perform set_config('role', 'postgres', true);
  -- restore: everything it had is still there
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.admin_lab_set_demo('fold', p_hidden => false);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select e into row_for from jsonb_array_elements(public.lab_catalog()) e where e ->> 'id' = 'fold';
  asked := asked + 1;
  -- its one vote is still the voter's own and still in the total, and its note is back
  n := jsonb_array_length(public.lab_comments_page('fold') -> 'items');
  perform set_config('role', 'postgres', true);
  if (row_for ->> 'mine')::int <> 1 or (row_for ->> 'up')::int is distinct from 1 or n <> 1
     or (select count(*) from public.lab_votes where demo_id = 'fold') <> 1 then
    fails := array_append(fails, (('10: restored fold lost its history: ' || coalesce(row_for::text, 'not listed')))::text);
  end if;
  perform set_config('role', 'postgres', true);

  exception when others then
    if sqlerrm like 'FIXTURE:%' then raise; end if;
    perform set_config('role', 'postgres', true);
    fails := array_append(fails, format('stopped after %s cases on: %s', asked, sqlerrm));
  end;

  /* ---------------------------------------------------------------- the verdict */
  if cardinality(fails) > 0 then
    raise exception E'% of % lab feedback cases failed:\n  %', cardinality(fails), asked, array_to_string(fails, E'\n  ');
  end if;
  raise notice 'all % lab feedback cases hold', asked;
end $$;

rollback;
