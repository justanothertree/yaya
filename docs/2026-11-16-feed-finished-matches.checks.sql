-- READ-ONLY CHECKS for docs/applied/2026-11-16-feed-finished-matches.DRAFT.sql, to run against production.
--
-- Everything below runs inside a read-only transaction and ends with ROLLBACK, so even a mistake in
-- it cannot write. Run block A before applying and block B after; if any answer differs from what
-- the block says to expect, stop and do not go further.
--
-- feed_recent's body (`prosrc`) by md5, measured on 16 Nov 2026 by applying the draft and its
-- rollback to a database built from every migration, and back again:
--
--   before this draft    b919de6d50d05ec301289bf2377419d8   <- production since 20261114161206
--   with this draft      5fe92f634f8f7dc53a3fc6f99acb9a6f
--
-- THE BASELINE (A2 and B2) is feed_recent's answer for every member who has a profile, in both
-- scopes, over a FIXED past window, read as that member — with every 'match' row taken out. Before
-- the draft there are none, so taking them out changes nothing; after it, taking them out must
-- give back exactly the same md5 for every member, which is the proof that the new branch added
-- rows and changed none of the others. The window ends in the past, so somebody posting between A
-- and B cannot move it; somebody DELETING something in that window between A and B can, and a
-- mismatch is a reason to look, not to assume.

begin transaction read only;

-- ── A1. Before applying: one feed_recent, in the state the draft expects, with its anchor once ─
-- Expect one row: definitions = 1, anchor_found = 1, state 'before this draft'.
select p.proname,
       count(*) over () as definitions,
       (length(p.prosrc) - length(replace(p.prosrc, E'          ) ev\n          join public.profiles p on p.user_id = ev.actor\n', '')))
         / length(E'          ) ev\n          join public.profiles p on p.user_id = ev.actor\n')
         as anchor_found,
       md5(p.prosrc) as body_md5,
       case md5(p.prosrc)
         when 'b919de6d50d05ec301289bf2377419d8' then 'before this draft'
         when '5fe92f634f8f7dc53a3fc6f99acb9a6f' then 'this draft is already applied'
         else 'UNEXPECTED: stop'
       end as state
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

-- ── A2 / B2. The baseline: one row per member, the md5 of what they are shown, matches aside ──
-- Copy A2's rows. B2 must give the same `without_matches` for every member; `matches` is 0 in A2.
-- ⚠️ THE CLAIMS ARE SET INSIDE THE CALL'S OWN ARGUMENT. A first draft set them in a LATERAL of
-- their own and gave every member the same md5: nothing ties when that runs to when the call
-- does, and the planner ran every set_config before the first call. An argument is evaluated
-- immediately before the call that takes it, so this one cannot be separated from its member.
select m.username as member,
       md5(string_agg(q.without_matches, '|' order by q.scope)) as without_matches,
       sum(q.matches) as matches
  from public.profiles m
  cross join (values ('you_and_friends'), ('all_members')) sc(scope)
  cross join lateral (
    select public.feed_recent(
             '2026-11-02T00:00:00Z'::timestamptz
               + interval '0 seconds' * length(set_config('request.jwt.claims',
                   json_build_object('sub', m.user_id, 'role', 'authenticated')::text, true)),
             '2026-11-16T02:00:00Z', 40, sc.scope) as feed
  ) f
  cross join lateral (
    select sc.scope,
           (select coalesce(jsonb_agg(e order by e->>'kind', e->>'id'), '[]'::jsonb)::text
              from jsonb_array_elements(f.feed) e where e->>'kind' <> 'match') as without_matches,
           (select count(*) from jsonb_array_elements(f.feed) e where e->>'kind' = 'match') as matches
  ) q
 group by m.username
 order by 1;

-- ── A3. What will start appearing: finished matches that the new branch posts ───────────────
-- Counts only. A loss together and a retired toy are counted apart, because they are never posted.
select m.mode,
       case when m.result->>'winner' = 'draw' then 'drawn'
            when m.mode = 'versus' then 'won'
            when m.result->>'winner' = '0' then 'won together'
            else 'lost together: never posted' end as how,
       d.hidden as retired_toy,
       count(*) as matches
  from public.lab_matches m
  join public.lab_demos d on d.id = m.demo_id
 where m.status = 'finished'
 group by 1, 2, 3
 order by 1, 2, 3;

-- ── B1. After applying: run A1 again — expect state 'this draft is already applied' ──────────
-- ── B2. Run A2 again — every `without_matches` as A2 gave it ─────────────────────────────────
-- ── B3. And the grant is untouched: anon false, authenticated true ───────────────────────────
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

rollback;
