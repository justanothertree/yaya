-- READ-ONLY CHECKS for docs/2026-11-14-feed-made-and-comments.DRAFT.sql, to run against production.
--
-- Everything below runs inside a read-only transaction and ends with ROLLBACK, so even a mistake in
-- it cannot write. Run the whole file in the Supabase SQL editor, or with psql. Each block says
-- what it expects; if any answer differs, stop and do not apply the draft.
--
-- feed_recent is also changed by step 1 (docs/2026-11-13-feed-hides-browsing.DRAFT.sql, #304), on
-- different lines, so it can be in four states. The md5 is of its body as stored (`prosrc`),
-- computed from the 4 Nov dump CI builds from (no migration since has touched it) and asserted
-- inside CI's own database by supabase/tests/feed-made-and-comments.sql:
--
--   neither draft          d89d80e09622db1b406ec17168fbaeff
--   step 1 (#304) only     f2841a1db68556e37e984a90721570cb
--   this draft only        b38af65c0778b022aaad41b33211a910
--   both                   b919de6d50d05ec301289bf2377419d8

begin transaction read only;

-- ── A. Before applying: feed_recent is a state the draft expects, and nothing it adds exists ──
-- Expect one row: definitions = 1, anchor_found = 1, and state 'as before the draft' or
-- '#304 only'. Then expect the second query to return no rows at all.
select p.proname,
       count(*) over () as definitions,
       (length(p.prosrc) - length(replace(p.prosrc, E'\n  return coalesce((\n    select jsonb_agg(q.e order by (q.e->>''at'')::timestamptz desc)\n', '')))
         / length(E'\n  return coalesce((\n    select jsonb_agg(q.e order by (q.e->>''at'')::timestamptz desc)\n')
         as anchor_found,
       md5(p.prosrc) as body_md5,
       case md5(p.prosrc)
         when 'd89d80e09622db1b406ec17168fbaeff' then 'as before the draft'
         when 'f2841a1db68556e37e984a90721570cb' then '#304 only'
         when 'b38af65c0778b022aaad41b33211a910' then 'the draft is already applied'
         when 'b919de6d50d05ec301289bf2377419d8' then 'the draft and #304 are applied'
         else 'UNEXPECTED: stop'
       end as state
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

-- the objects the draft creates: none of them may exist yet
select 'table' as kind, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'profile_showcase'
union all
select 'function', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('profile_showcase_note', 'feed_preview')
union all
select 'trigger', t.tgname
  from pg_trigger t
 where t.tgrelid = 'public.profile_blocks'::regclass and t.tgname = 'profile_showcase_note';

-- ── B1. What the backfill writes: blocks already on pages, marked "before the Feed kept track" ─
-- One row per kind. These are written with first_shown_at NULL and are never announced.
select b.block_type,
       count(*) as blocks,
       count(distinct (b.user_id, md5(b.config::text))) as rows_written,
       count(distinct b.user_id) as members
  from public.profile_blocks b
 where b.block_type in ('song', 'art', 'pet', 'looks')
   and b.visibility <> 'private'
 group by b.block_type
 order by b.block_type;

-- ── B2. Comments the Feed would start showing, from the last 14 days ──────────────────────────
-- Counts only, and before anybody's reading rules, which narrow them further per viewer. Bodies
-- are not selected: this is a count of what exists, not a read of what people wrote.
select 'workout' as on_what, count(*) as comments, count(distinct c.user_id) as authors
  from public.circuit_log_comments c
 where c.created_at > clock_timestamp() - interval '14 days'
union all
select 'lab', count(*), count(distinct c.user_id)
  from public.lab_comments c
 where c.created_at > clock_timestamp() - interval '14 days' and c.removed_at is null
union all
select 'guestbook', count(*), count(distinct n.author_user_id)
  from public.profile_notes n
 where n.created_at > clock_timestamp() - interval '14 days';

-- ── C. After applying (or after the rollback) ─────────────────────────────────────────────────
-- Run block A again. After the draft: state 'the draft is already applied' (or '... and #304'),
-- and the second query lists four objects. After the rollback: as before, and none.
-- Then: nothing new is reachable by anon or authenticated. Expect every column false.
select 'profile_showcase' as object,
       has_table_privilege('anon', to_regclass('public.profile_showcase')::oid,
                           'select,insert,update,delete,truncate,references,trigger') as anon_any,
       has_table_privilege('authenticated', to_regclass('public.profile_showcase')::oid,
                           'select,insert,update,delete,truncate,references,trigger') as authenticated_any
 where to_regclass('public.profile_showcase') is not null
union all
select p.proname,
       has_function_privilege('anon', p.oid, 'execute'),
       has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('profile_showcase_note', 'feed_preview');

-- …and feed_recent keeps its grant: anon false, authenticated true.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

-- …and the table holds RLS with no policy: expect rls = true, policies = 0.
select c.relrowsecurity as rls,
       (select count(*) from pg_policy pol where pol.polrelid = c.oid) as policies
  from pg_class c
 where c.oid = to_regclass('public.profile_showcase');

rollback;
