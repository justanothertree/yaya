-- READ-ONLY CHECKS for docs/2026-11-13-feed-hides-browsing.DRAFT.sql, to run against production.
--
-- Everything below runs inside a read-only transaction and ends with ROLLBACK, so even a mistake in
-- it cannot write. Run the whole file in the Supabase SQL editor, or with psql. Each block says
-- what it expects; if any answer differs, stop and do not apply the draft.
--
-- The md5 values are of each function's body as stored (`prosrc`). They were computed from the
-- 4 Nov schema dump that CI builds from, and supabase/tests/feed-hides-browsing.sql asserts the
-- same values inside CI's own database.
--
--   function                before the draft                  after the draft
--   chronicle_friends_log   1b3354fb5be0bdd7c4ab8c79c459286e   377de6b6bdea3c6ed6cf15bf3a86a46a
--   feed_recent             d89d80e09622db1b406ec17168fbaeff   f2841a1db68556e37e984a90721570cb

begin transaction read only;

-- ── A. Before applying: the two functions are exactly what the draft expects ──────────────────
-- Expect two rows, each with definitions = 1, anchor_found = 1, filter_found = 0, and
-- state = 'as before the draft'. Anything else: the draft would raise, or would meet a function
-- that has changed since the dump, so stop.
select p.proname,
       count(*) over (partition by p.proname) as definitions,
       (length(p.prosrc) - length(replace(p.prosrc, a.anchor, ''))) / length(a.anchor)
         as anchor_found,
       (length(p.prosrc) - length(replace(p.prosrc, 'and not a.auto', '')))
         / length('and not a.auto') as filter_found,
       md5(p.prosrc) as body_md5,
       case md5(p.prosrc)
         when a.before then 'as before the draft'
         when a.after  then 'the draft is already applied'
         else 'UNEXPECTED: stop'
       end as state
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join (values
          ('chronicle_friends_log',
           E'\n         and public.can_see_item(e.owner, a.visibility,\n',
           '1b3354fb5be0bdd7c4ab8c79c459286e', '377de6b6bdea3c6ed6cf15bf3a86a46a'),
          ('feed_recent',
           E'\n       and public.item_reaches_anyone(v_me, a.visibility,\n',
           'd89d80e09622db1b406ec17168fbaeff', 'f2841a1db68556e37e984a90721570cb')
       ) as a(fn, anchor, before, after) on a.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f'
 order by p.proname;

-- ── B. Whose Feeds change: auto (browsing) activities shared above Only me ────────────────────
-- One row per member with at least one. `timeline_shared` is whether their Chronicle timeline
-- switch is on; with it off, their browsing reaches nobody today either. `visits_31_days` is how
-- many browsing sittings in the last 31 days (the furthest back the Feed looks) will leave the Feed
-- and their friends' Friends tab. No rows means the draft changes nobody's Feed today, and only
-- stops it happening later.
select pr.username,
       public.chronicle_shares_timeline(a.owner) as timeline_shared,
       count(distinct a.id) as shared_auto_activities,
       string_agg(distinct a.name || ' (' || a.visibility::text || ')', ', ') as which,
       count(e.id) filter (where e.ended_at > clock_timestamp() - interval '31 days')
         as visits_31_days
  from public.chronicle_activities a
  join public.profiles pr on pr.user_id = a.owner
  left join public.chronicle_entries e on e.activity = a.id and e.owner = a.owner
 where a.auto
   and a.visibility <> 'private'
 group by pr.username, a.owner
 order by pr.username;

-- …and the same as totals, for the PR.
select count(distinct a.owner) as members,
       count(distinct a.id) as shared_auto_activities,
       count(e.id) filter (where e.ended_at > clock_timestamp() - interval '31 days')
         as visits_31_days
  from public.chronicle_activities a
  left join public.chronicle_entries e on e.activity = a.id and e.owner = a.owner
 where a.auto
   and a.visibility <> 'private';

-- ── C. After applying (or after the rollback): run block A again ──────────────────────────────
-- After the draft:    state = 'the draft is already applied', filter_found = 1 on both rows.
-- After the rollback: state = 'as before the draft', filter_found = 0 on both rows.
-- And neither should be callable by anon (expect two rows, anon_can_execute = false and
-- authenticated_can_execute = true), since create or replace keeps grants:
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_friends_log', 'feed_recent')
 order by p.proname;

rollback;
