-- READ-ONLY CHECKS for docs/applied/2026-11-16-lab-match-nudge.DRAFT.sql, to run against production.
--
-- Each block runs in a transaction that ends with ROLLBACK, so nothing here can write. If any
-- answer differs from what the block expects, stop: do not apply the draft (block A), or apply the
-- ROLLBACK beside it (block B).
--
-- THE FINGERPRINT is md5 of the helper's body as stored (`prosrc`), read on the local stack
-- (Supabase CLI 2.122.0, Postgres 17) straight after applying the draft:
--
--   lab_match_topic_member   a7781b3129c13a8de2d23e9a4ddd08ab
--
-- On that stack, with production's nine realtime.messages policies copied onto it as they stood
-- on 16 Nov 2026, the client was checked end to end in two browsers: a move nudged the other
-- page in under 200 ms, an accept as soon as the accepter's channel joined, a non-player's join
-- was refused, and with this draft rolled back the join was refused once and let go.

-- ── A. Before applying ──────────────────────────────────────────────────────────────────────
begin transaction read only;

-- A1. Expect NO ROWS: nothing the draft creates exists yet.
select 'function' as kind, p.proname as name
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'lab_match_topic_member'
union all
select 'policy', policyname from pg_policies
where schemaname = 'realtime' and tablename = 'messages' and policyname like 'lab matches:%';

-- A2. Expect exactly these nine policies on realtime.messages, the set the draft was tested beside:
--   members: a room's live messages · members: bell and conversation list · pool: members can spin
--   it · pool: members can watch the wheel · presence: audience can listen · presence: audience
--   can send · public data: signed-out visitors can listen · voice: members can listen · voice:
--   members can send
select policyname, cmd, roles::text from pg_policies
where schemaname = 'realtime' and tablename = 'messages' order by policyname;

-- A3. Expect one row, true: the columns the helper reads are there, as uuids.
select bool_and(data_type = 'uuid') and count(*) = 3 as columns_ok
from information_schema.columns
where table_schema = 'public' and table_name = 'lab_matches'
  and column_name in ('id', 'player_a', 'player_b');

rollback;

-- ── B. After applying ───────────────────────────────────────────────────────────────────────
begin transaction read only;

-- B1. Expect a7781b3129c13a8de2d23e9a4ddd08ab | f | t : the body as tested, anon cannot call it,
--     a signed-in member can (the policies run as them).
select md5(p.prosrc),
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'lab_match_topic_member';

-- B2. Expect two rows: SELECT and INSERT, each to {authenticated} only.
select policyname, cmd, roles::text from pg_policies
where schemaname = 'realtime' and tablename = 'messages' and policyname like 'lab matches:%'
order by policyname;

-- B3. Expect t, f, f, f, f: a match's first player yes; a member who plays in no match, no; the
--     same player on a malformed topic, on another channel kind, and with no session, no. Run as a
--     simulated session, read-only and rolled back: nothing is written and no account is touched.
--     Uses the oldest match there is; if there are none, the first column reads null — stop there.
with m as (select id, player_a from public.lab_matches order by created_at limit 1),
     outsider as (
       select u.id from auth.users u
       where not exists (select 1 from public.lab_matches x where u.id in (x.player_a, x.player_b))
       order by u.created_at limit 1
     )
select
  (select set_config('request.jwt.claims', json_build_object('sub', player_a, 'role', 'authenticated')::text, true) is not null
     and public.lab_match_topic_member('labmatch:' || id) from m) as player,
  (select set_config('request.jwt.claims', json_build_object('sub', (select id from outsider), 'role', 'authenticated')::text, true) is not null
     and public.lab_match_topic_member('labmatch:' || id) from m) as outsider,
  (select set_config('request.jwt.claims', json_build_object('sub', player_a, 'role', 'authenticated')::text, true) is not null
     and public.lab_match_topic_member('labmatch:' || id || ':x') from m) as malformed,
  (select set_config('request.jwt.claims', json_build_object('sub', player_a, 'role', 'authenticated')::text, true) is not null
     and public.lab_match_topic_member('voice:' || id) from m) as other_kind,
  (select set_config('request.jwt.claims', '{}', true) is not null
     and public.lab_match_topic_member('labmatch:' || id) from m) as no_session;

rollback;
