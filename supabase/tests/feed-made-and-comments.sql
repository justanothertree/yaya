-- Step 3 of the Feed plan, asked of the real functions as the seeded members: things made and put
-- on a page, and comments from all three places they are left, reach the Feed with a short preview,
-- and only where the room each one lives in would already show it.
--
-- ⛔ NEEDS THE DRAFT APPLIED FIRST, and refuses to run otherwise:
--      docs/2026-11-14-feed-made-and-comments.DRAFT.sql
-- It is not applied to production. This file runs only where a throwaway database has been built
-- from the schema baseline and seed -- the `db guards` CI job, by way of a scratch-probe branch --
-- and it rolls back. NEVER against production: it writes a page, notes, comments and suspensions.
--
-- ⚠️ AND THE PROBE MUST REPLAY THE MIGRATIONS APPLIED SINCE THE DUMP FIRST: the Lab's tables
-- (20261109030613_lab_catalog_and_feedback) are newer than the dump CI builds from.
--
-- WHAT IT ASKS, section by section:
--   0  the draft is applied: feed_recent carries the new block and is one of the two md5s
--      docs/2026-11-14-feed-made-and-comments.checks.sql expects after it; the new table is
--      deny-all and the two new functions are nobody's to call
--   A  the fixture, through the real writers: the owner's page (a guestbook and a song for friends,
--      a drawing for Only me); the friend's note in that guestbook, long and over several lines;
--      the friend's comments on two workouts, one the stranger can see and one they cannot; the
--      owner's Lab notes -- one kept, one removed, one on an experiment later retired
--   B  the friend: the song, not the drawing; their own note, folded and cut to a preview; both
--      their comments; the owner's kept Lab note and neither of the others
--   C  the owner: the song as theirs, because it reaches somebody; the friend's note, marked as on
--      their own guestbook; the comment on their workout, marked as theirs
--   D  the stranger: on All members, the Lab note and the comment on the workout they may see --
--      the controls that the narrow rules are narrowing rather than hiding everything -- and not
--      the song, the guestbook note or the other comment; on You + friends, nothing of either
--   E  publishing: a re-save of the same page announces nothing new; the drawing going to friends
--      is a new moment; the song going to Only me leaves both Feeds; a block already on a page
--      before the Feed kept track (first_shown_at null) is never announced
--   F  a suspended viewer reads no workout comments, as the table's own policy has it
--   G  the rollback, applied in here and rolled back with everything else: feed_recent returns to
--      its md5 from before, the new kinds leave the Feed, and the table is gone
-- On failure it raises, naming every check that failed. A green run prints the md5s.

begin;

create temp table fails(check_name text, detail text);
create temp table seen(k text primary key, v jsonb);
grant select, insert on fails to authenticated, anon;
grant select, insert, update on seen to authenticated, anon;

create temp table who as
  select '00000000-0000-4000-a000-000000000001'::uuid as owner,
         '00000000-0000-4000-a000-000000000002'::uuid as friend,
         '00000000-0000-4000-a000-000000000003'::uuid as stranger;
grant select on who to authenticated, anon;

/* one question for every section: does this feed hold an event like this one */
create or replace function pg_temp.has(p_feed jsonb, p_like jsonb) returns boolean
language sql immutable as $$ select coalesce(p_feed, '[]'::jsonb) @> jsonb_build_array(p_like) $$;
create or replace function pg_temp.got(p_k text) returns jsonb
language sql stable as $$ select v from seen where k = p_k $$;

/* the page the fixture saves, and saves again in section E */
create temp table page(k text primary key, v jsonb);
grant select on page to authenticated;
insert into page values ('first', '[
  {"block_type": "guestbook", "size": "medium", "config": {}, "visibility": "friends"},
  {"block_type": "song", "size": "medium", "config": {"probe": "a song"}, "visibility": "friends"},
  {"block_type": "art", "size": "medium", "config": {"probe": "a drawing"}, "visibility": "private"}
]'::jsonb);

-- ── 0. the draft is applied ───────────────────────────────────────────────────────────────────
select p.proname as function, md5(p.prosrc) as body_md5_with_the_draft
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

insert into fails select 'DRAFT NOT APPLIED', 'feed_recent is ' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent'
   /* this draft alone, or with step 1 (#304) as well */
   and md5(p.prosrc) not in ('b38af65c0778b022aaad41b33211a910', 'b919de6d50d05ec301289bf2377419d8');

insert into fails select 'the new table is not deny-all', r
  from (values ('anon'), ('authenticated')) v(r)
 where has_table_privilege(r, 'public.profile_showcase',
                           'select,insert,update,delete,truncate,references,trigger');
insert into fails select 'the new table has no RLS, or has a policy', ''
 where not (select relrowsecurity from pg_class where oid = 'public.profile_showcase'::regclass)
    or exists (select 1 from pg_policy where polrelid = 'public.profile_showcase'::regclass);
insert into fails select 'a new function is callable from the API', r || ' ' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 cross join (values ('anon'), ('authenticated')) v(r)
 where n.nspname = 'public' and p.proname in ('profile_showcase_note', 'feed_preview')
   and has_function_privilege(r, p.oid, 'execute');

-- ── A. the fixture ────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.save_my_profile_blocks((select v from page where k = 'first'));
  perform public.lab_comment_add('swarm', 'idea', 'Feed probe: more colours, please');
  perform public.lab_comment_add('swarm', 'bug', 'Feed probe: a note that gets removed');
  perform public.lab_comment_add('life', 'more', 'Feed probe: a note on a toy that retires');
exception when others then
  insert into fails values ('FIXTURE: setting up as the owner raised', sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.post_profile_note('seedowner',
    E'Feed probe: lovely page!\n\n   The song is   stuck in my head and I keep humming it all day long, honestly.');
exception when others then
  insert into fails values ('FIXTURE: the friend''s guestbook note raised', sqlerrm);
end $$;
/* through the table and its policies, as the Circuit writes them */
insert into public.circuit_log_comments (log_id, user_id, body)
values ('seed-log-1', (select friend from who), 'Feed probe: strong day'),
       ('seed-log-2', (select friend from who), 'Feed probe: my own day');
reset role;

/* the admin's two hands: one note removed, one toy retired */
update public.lab_comments set removed_at = clock_timestamp()
 where body = 'Feed probe: a note that gets removed';
update public.lab_demos set hidden = true where id = 'life';

insert into fails select 'FIXTURE: ' || x.what, ''
  from (values
    ('the song went up without a first moment',
     not exists (select 1 from public.profile_showcase s
                  where s.owner = (select owner from who) and s.block_type = 'song'
                    and s.first_shown_at is not null)),
    ('the private drawing was given a first moment',
     exists (select 1 from public.profile_showcase s
              where s.owner = (select owner from who) and s.block_type = 'art')),
    ('the friend''s note is not in the guestbook',
     not exists (select 1 from public.profile_notes where body like 'Feed probe: lovely page!%')),
    ('the workout comments are missing',
     (select count(*) from public.circuit_log_comments where body like 'Feed probe:%') <> 2),
    ('the Lab notes are missing',
     (select count(*) from public.lab_comments where body like 'Feed probe:%') <> 3)
  ) x(what, bad)
 where x.bad;

-- ── B. the friend ─────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;

insert into fails select 'the friend: ' || x.what, ''
  from (values
    ('the song the owner put on their page is missing',
     not pg_temp.has(pg_temp.got('friend'), '{"kind": "made", "detail": "song", "who": "seedowner", "mine": false}')),
    ('the drawing at Only me reached them',
     pg_temp.has(pg_temp.got('friend'), '{"kind": "made", "detail": "art"}')),
    ('their own guestbook note is missing',
     not pg_temp.has(pg_temp.got('friend'), '{"kind": "comment", "on": "guestbook", "who": "seedfriend", "mine": true, "about": "Owner", "about_who": "seedowner", "about_mine": false}')),
    ('their comment on the owner''s workout is missing',
     not pg_temp.has(pg_temp.got('friend'), '{"kind": "comment", "on": "workout", "detail": "Feed probe: strong day", "about": "Owner", "mine": true}')),
    ('their comment on their own workout is missing',
     not pg_temp.has(pg_temp.got('friend'), '{"kind": "comment", "on": "workout", "detail": "Feed probe: my own day", "about_mine": true}')),
    ('the owner''s Lab note is missing',
     not pg_temp.has(pg_temp.got('friend'), '{"kind": "comment", "on": "lab", "about": "swarm", "detail": "Feed probe: more colours, please", "who": "seedowner"}')),
    ('a REMOVED Lab note reached them',
     pg_temp.has(pg_temp.got('friend'), '{"detail": "Feed probe: a note that gets removed"}')),
    ('a note on a RETIRED toy reached them',
     pg_temp.has(pg_temp.got('friend'), '{"about": "life"}'))
  ) x(what, bad)
 where x.bad;

/* the preview: folded to one line, cut to 80 characters with an ellipsis */
insert into seen select 'preview', to_jsonb(x->>'detail')
  from jsonb_array_elements(pg_temp.got('friend')) x where x->>'id' like 'guestbook:%' limit 1;
insert into fails select 'the guestbook preview is not one folded line of at most 80 characters',
       coalesce(pg_temp.got('preview') #>> '{}', 'nothing')
 where pg_temp.got('preview') is null
    or char_length(pg_temp.got('preview') #>> '{}') > 80
    or (pg_temp.got('preview') #>> '{}') ~ '\s\s|\n'
    or (pg_temp.got('preview') #>> '{}') not like 'Feed probe: lovely page! The song is stuck in my head%…';

-- ── C. the owner ──────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('owner', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;

insert into fails select 'the owner: ' || x.what, ''
  from (values
    ('their own song is missing, though it reaches their friend',
     not pg_temp.has(pg_temp.got('owner'), '{"kind": "made", "detail": "song", "mine": true}')),
    ('the friend''s note is not marked as on their own guestbook',
     not pg_temp.has(pg_temp.got('owner'), '{"kind": "comment", "on": "guestbook", "who": "seedfriend", "about_mine": true}')),
    ('the comment on their workout is not marked as theirs',
     not pg_temp.has(pg_temp.got('owner'), '{"kind": "comment", "on": "workout", "detail": "Feed probe: strong day", "about_mine": true}')),
    ('the comment on the workout they see through the circuit is missing',
     not pg_temp.has(pg_temp.got('owner'), '{"kind": "comment", "detail": "Feed probe: my own day"}')),
    ('their removed Lab note reached their own Feed',
     pg_temp.has(pg_temp.got('owner'), '{"detail": "Feed probe: a note that gets removed"}'))
  ) x(what, bad)
 where x.bad;

-- ── D. the stranger ───────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select stranger::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('stranger_all',  public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'all_members')),
  ('stranger_mine', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;

insert into fails select 'the stranger: ' || x.what, ''
  from (values
    ('the owner''s Lab note, which any member may read, is missing on All members',
     not pg_temp.has(pg_temp.got('stranger_all'), '{"kind": "comment", "on": "lab", "detail": "Feed probe: more colours, please"}')),
    ('the comment on the public workout is missing on All members',
     not pg_temp.has(pg_temp.got('stranger_all'), '{"kind": "comment", "detail": "Feed probe: strong day"}')),
    ('the song for friends reached them',
     pg_temp.has(pg_temp.got('stranger_all'), '{"kind": "made"}')),
    ('a note in a guestbook for friends reached them',
     pg_temp.has(pg_temp.got('stranger_all'), '{"kind": "comment", "on": "guestbook"}')),
    ('the comment on a workout they cannot see reached them',
     pg_temp.has(pg_temp.got('stranger_all'), '{"detail": "Feed probe: my own day"}')),
    ('You + friends showed them people who are not their friends',
     pg_temp.has(pg_temp.got('stranger_mine'), '{"kind": "comment"}')
       or pg_temp.has(pg_temp.got('stranger_mine'), '{"kind": "made"}'))
  ) x(what, bad)
 where x.bad;

-- ── E. publishing ─────────────────────────────────────────────────────────────────────────────
insert into seen select 'song_before', to_jsonb(s.id::text || ' ' || s.first_shown_at::text)
  from public.profile_showcase s where s.owner = (select owner from who) and s.block_type = 'song';

select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  /* the same page again: a re-save re-inserts every block */
  perform public.save_my_profile_blocks((select v from page where k = 'first'));
exception when others then
  insert into fails values ('FIXTURE: re-saving the page raised', sqlerrm);
end $$;
reset role;

insert into fails select 'a re-save gave the song a new first moment', ''
 where (select to_jsonb(s.id::text || ' ' || s.first_shown_at::text) from public.profile_showcase s
         where s.owner = (select owner from who) and s.block_type = 'song')
       is distinct from pg_temp.got('song_before')
    or (select count(*) from public.profile_showcase where owner = (select owner from who)) <> 1;

/* a pet already on a page before the Feed kept track, as the backfill writes it */
insert into public.profile_showcase (owner, block_type, config_md5, first_shown_at)
select owner, 'pet', md5('{"probe": "an old pet"}'::jsonb::text), null from who;

select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.save_my_profile_blocks('[
    {"block_type": "guestbook", "size": "medium", "config": {}, "visibility": "friends"},
    {"block_type": "song", "size": "medium", "config": {"probe": "a song"}, "visibility": "private"},
    {"block_type": "art", "size": "medium", "config": {"probe": "a drawing"}, "visibility": "friends"},
    {"block_type": "pet", "size": "small", "config": {"probe": "an old pet"}, "visibility": "friends"}
  ]'::jsonb);
exception when others then
  insert into fails values ('FIXTURE: changing the page raised', sqlerrm);
end $$;
insert into seen values
  ('owner_after', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend_after', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;

insert into fails select 'publishing: ' || x.what, ''
  from (values
    ('the drawing going to friends did not reach the friend',
     not pg_temp.has(pg_temp.got('friend_after'), '{"kind": "made", "detail": "art"}')),
    ('the song at Only me still reaches the friend',
     pg_temp.has(pg_temp.got('friend_after'), '{"kind": "made", "detail": "song"}')),
    ('the song at Only me is still in the owner''s own Feed, as if it reached somebody',
     pg_temp.has(pg_temp.got('owner_after'), '{"kind": "made", "detail": "song"}')),
    ('a pet from before the Feed kept track was announced',
     pg_temp.has(pg_temp.got('friend_after'), '{"kind": "made", "detail": "pet"}'))
  ) x(what, bad)
 where x.bad;

-- ── F. a suspended viewer reads no workout comments ───────────────────────────────────────────
update public.profiles set suspended = true where user_id = (select owner from who);
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('owner_suspended', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;
update public.profiles set suspended = false where user_id = (select owner from who);

insert into fails select 'a suspended viewer still reads workout comments', ''
 where pg_temp.has(pg_temp.got('owner_suspended'), '{"kind": "comment", "on": "workout"}');

-- ── G. the rollback: the way back, and the proof the checks above can fail ────────────────────
\ir ../../docs/2026-11-14-feed-made-and-comments.ROLLBACK.sql

select p.proname as function, md5(p.prosrc) as body_md5_after_the_rollback
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

insert into fails select 'the rollback did not restore feed_recent', md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent'
   /* as before the draft, or with step 1 (#304) still applied */
   and md5(p.prosrc) not in ('d89d80e09622db1b406ec17168fbaeff', 'f2841a1db68556e37e984a90721570cb');
insert into fails select 'the rollback left an object behind', x
  from (values (to_regclass('public.profile_showcase')::text),
               (to_regprocedure('public.feed_preview(text)')::text),
               (to_regprocedure('public.profile_showcase_note()')::text)) v(x)
 where x is not null;

select set_config('request.jwt.claims',
  json_build_object('sub', (select friend::text from who), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into seen values
  ('friend_without', public.feed_recent(clock_timestamp() - interval '1 day', null, 40, 'you_and_friends'));
reset role;
insert into fails select 'without the draft the Feed still shows comments or things made',
       'so sections B to E could not have failed'
 where pg_temp.has(pg_temp.got('friend_without'), '{"kind": "comment"}')
    or pg_temp.has(pg_temp.got('friend_without'), '{"kind": "made"}');

-- ── the verdict ───────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'FEED MADE AND COMMENTS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'things made and comments reach the Feed by their own rooms'' rules' as result,
       count(*) as failures from fails;

rollback;
