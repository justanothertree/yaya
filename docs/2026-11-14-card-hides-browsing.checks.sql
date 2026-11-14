-- READ-ONLY CHECKS for docs/2026-11-14-card-hides-browsing.DRAFT.sql, to run against production.
--
-- Everything below runs inside a read-only transaction and ends with ROLLBACK, so even a mistake in
-- it cannot write. Run the whole file in the Supabase SQL editor, or with psql. Each block says
-- what it expects; if any answer differs, stop and do not apply the draft.
--
-- The md5 values are of each function's body as stored (`prosrc`). "Before" is the 4 Nov schema
-- dump CI builds from, plus the one migration since that changed either function
-- (20261110030419_chronicle_repeat_marks_profile, on get_member_chronicle's goal lines).
-- supabase/tests/card-hides-browsing.sql asserts the same values inside CI's own database.
--
--   function                before the draft                  after the draft
--   chronicle_sharing_mine  caf481fcd16fb245ae40c7e93a8e9e7e   702f1932689bcdd33b16f0171dbe9b89
--   get_member_chronicle    175d50d2a9a4a43baa8e801e10603ca9   ae31965d4220269491da5b0b1f59f6ed

begin transaction read only;

-- ── A. Before applying: the two functions are exactly what the draft expects ──────────────────
-- Expect two rows, each with definitions = 1, anchors_found = anchors_wanted, filter_found = 0,
-- and state = 'as before the draft'. Anything else: the draft would raise, or would meet a
-- function that has changed since the dump, so stop.
select p.proname,
       count(*) over (partition by p.proname) as definitions,
       (select sum((length(p.prosrc) - length(replace(p.prosrc, x, ''))) / length(x))
          from unnest(a.anchors) x) as anchors_found,
       a.anchors_wanted,
       (length(p.prosrc) - length(replace(p.prosrc, a.filter, ''))) / length(a.filter)
         as filter_found,
       md5(p.prosrc) as body_md5,
       case md5(p.prosrc)
         when a.before then 'as before the draft'
         when a.after  then 'the draft is already applied'
         else 'UNEXPECTED: stop'
       end as state
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join (values
          ('chronicle_sharing_mine',
           array[E'\n       where a.owner = auth.uid() and a.archived_at is null), ''[]''::jsonb),\n'],
           1, 'and not a.auto',
           'caf481fcd16fb245ae40c7e93a8e9e7e', '702f1932689bcdd33b16f0171dbe9b89'),
          ('get_member_chronicle',
           array[E'\n     where e.owner = v_target\n       and e.started_at < v_to\n',
                 E'\n       where e.owner = v_target and e.ended_at is null\n'],
           3, '(v_target = v_viewer or not a.auto)',
           '175d50d2a9a4a43baa8e801e10603ca9', 'ae31965d4220269491da5b0b1f59f6ed')
       ) as a(fn, anchors, anchors_wanted, filter, before, after) on a.fn = p.proname
 where n.nspname = 'public' and p.prokind = 'f'
 order by p.proname;

-- ── B1. Whose profile cards change: browsing a card currently shows to other people ───────────
-- One row per member whose Chronicle card is set above Only me and who has browsing in the last
-- 90 days (the longest window a card can cover). `browsing_mins_7_days` is what leaves the default
-- one-week card. No rows means nobody's card changes today.
select pr.username,
       (select string_agg(b.visibility::text, ', ' order by b.position)
          from public.profile_blocks b
         where b.user_id = t.owner and b.block_type = 'chronicle') as card_level,
       t.browsing_mins_7_days,
       t.browsing_sittings_90_days
  from (select a.owner,
               round(sum(greatest(0, extract(epoch from (
                 coalesce(e.ended_at, clock_timestamp())
                 - greatest(e.started_at, clock_timestamp() - interval '7 days')))) / 60.0))
                 as browsing_mins_7_days,
               count(*) as browsing_sittings_90_days
          from public.chronicle_activities a
          join public.chronicle_entries e on e.activity = a.id and e.owner = a.owner
         where a.auto
           and coalesce(e.ended_at, clock_timestamp()) > clock_timestamp() - interval '90 days'
         group by a.owner) t
  join public.profiles pr on pr.user_id = t.owner
 where exists (select 1 from public.profile_blocks b
                where b.user_id = t.owner and b.block_type = 'chronicle'
                  and b.visibility <> 'private')
 order by pr.username;

-- ── B2. Whose Sharing panels change: browsing rows that leave the activity list ───────────────
-- One row per member with browsing activities in their panel today. `set_above_only_me` counts the
-- ones somebody chose a level for; after step 1 and this, that level is inert, and the row goes.
select pr.username,
       count(*) as browsing_rows,
       count(*) filter (where a.visibility <> 'private') as set_above_only_me
  from public.chronicle_activities a
  join public.profiles pr on pr.user_id = a.owner
 where a.auto and a.archived_at is null
 group by pr.username
 order by pr.username;

-- ── C. After applying (or after the rollback): run block A again ──────────────────────────────
-- After the draft:    state = 'the draft is already applied', filter_found = anchors_wanted.
-- After the rollback: state = 'as before the draft', filter_found = 0.
-- And neither should be callable by anon (expect two rows, anon_can_execute = false and
-- authenticated_can_execute = true), since create or replace keeps grants:
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_sharing_mine', 'get_member_chronicle')
 order by p.proname;

rollback;
