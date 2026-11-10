-- ⛔ SCRATCH BRANCH chronicle/ci-probe-server-batch ONLY — never to be merged. Runs the batch
-- plan's apply order on the dump plus the release's seven migrations, then its rollback, then the
-- standing guards.
\ir ../migrations/20261110025141_chronicle_sets.sql
\ir ../migrations/20261110025303_chronicle_sets_links.sql
\ir ../migrations/20261110025332_circuit_grid_sessions.sql
\ir ../migrations/20261110025407_chronicle_weekdays.sql
\ir ../migrations/20261110025449_chronicle_repeat_marks.sql
\ir ../migrations/20261110025520_chronicle_day_notes.sql
\ir ../migrations/20261110030419_chronicle_repeat_marks_profile.sql
\pset format unaligned
\pset tuples_only on
\echo '#### CHECK A'
select '#### BEFORE ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save', 'chronicle_goal_save', 'chronicle_routine_save') order by p.proname;
select '#### GRANTS ' || p.proname || ' anon=' || has_function_privilege('anon', p.oid, 'execute') || ' member=' || has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save', 'chronicle_goal_save', 'chronicle_routine_save') order by p.proname;
select '#### VERSION ' || (current_setting('server_version_num')::int >= 130000);
\echo '#### APPLY, in the plan''s order'
\echo '#### STEP 2 docs/2026-11-10-chronicle-moments-decimals.DRAFT.sql'
\ir ../../docs/2026-11-10-chronicle-moments-decimals.DRAFT.sql
\echo '#### STEP 3 docs/2026-11-10-chronicle-entry-amount-negative.DRAFT.sql'
\ir ../../docs/2026-11-10-chronicle-entry-amount-negative.DRAFT.sql
\echo '#### STEP 4 docs/2026-11-10-chronicle-activity-refusals.DRAFT.sql'
\ir ../../docs/2026-11-10-chronicle-activity-refusals.DRAFT.sql
\echo '#### STEP 5 docs/2026-11-10-chronicle-goal-refusals.DRAFT.sql'
\ir ../../docs/2026-11-10-chronicle-goal-refusals.DRAFT.sql
\echo '#### STEP 6 docs/2026-11-10-chronicle-routine-refusals.DRAFT.sql'
\ir ../../docs/2026-11-10-chronicle-routine-refusals.DRAFT.sql
\echo '#### CHECK B'
select '#### AFTER ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save', 'chronicle_goal_save', 'chronicle_routine_save') order by p.proname;
select '#### GRANTS ' || p.proname || ' anon=' || has_function_privilege('anon', p.oid, 'execute') || ' member=' || has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save', 'chronicle_goal_save', 'chronicle_routine_save') order by p.proname;
\echo '#### TEST chronicle-21ab.sql'
\ir chronicle-21ab.sql
\echo '#### TEST chronicle-activity-refusals.sql'
\ir chronicle-activity-refusals.sql
\echo '#### TEST chronicle-goal-refusals.sql'
\ir chronicle-goal-refusals.sql
\echo '#### TEST chronicle-routine-refusals.sql'
\ir chronicle-routine-refusals.sql
\echo '#### ROLLBACK, most recent first'
\! md5sum docs/2026-11-10-chronicle-routine-refusals-rollback/chronicle_routine_save.sql | sed 's/^/#### ROLLBACK FILE /'
\set rb `cat docs/2026-11-10-chronicle-routine-refusals-rollback/chronicle_routine_save.sql`
select set_config('probe.rb', :'rb', false) is not null;
do $$ begin execute current_setting('probe.rb'); end $$;
\! md5sum docs/2026-11-10-chronicle-goal-refusals-rollback/chronicle_goal_save.sql | sed 's/^/#### ROLLBACK FILE /'
\set rb `cat docs/2026-11-10-chronicle-goal-refusals-rollback/chronicle_goal_save.sql`
select set_config('probe.rb', :'rb', false) is not null;
do $$ begin execute current_setting('probe.rb'); end $$;
\! md5sum docs/2026-11-10-chronicle-activity-refusals-rollback/chronicle_activity_save.sql | sed 's/^/#### ROLLBACK FILE /'
\set rb `cat docs/2026-11-10-chronicle-activity-refusals-rollback/chronicle_activity_save.sql`
select set_config('probe.rb', :'rb', false) is not null;
do $$ begin execute current_setting('probe.rb'); end $$;
\! md5sum docs/2026-11-10-chronicle-21ab-rollback/chronicle_entry_amount.sql | sed 's/^/#### ROLLBACK FILE /'
\set rb `cat docs/2026-11-10-chronicle-21ab-rollback/chronicle_entry_amount.sql`
select set_config('probe.rb', :'rb', false) is not null;
do $$ begin execute current_setting('probe.rb'); end $$;
\! md5sum docs/2026-11-10-chronicle-21ab-rollback/chronicle_moments.sql | sed 's/^/#### ROLLBACK FILE /'
\set rb `cat docs/2026-11-10-chronicle-21ab-rollback/chronicle_moments.sql`
select set_config('probe.rb', :'rb', false) is not null;
do $$ begin execute current_setting('probe.rb'); end $$;
select '#### ROLLED BACK ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save', 'chronicle_goal_save', 'chronicle_routine_save') order by p.proname;
select '#### GRANTS ' || p.proname || ' anon=' || has_function_privilege('anon', p.oid, 'execute') || ' member=' || has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save', 'chronicle_goal_save', 'chronicle_routine_save') order by p.proname;
\pset format aligned
\pset tuples_only off

-- Standing guard check for the visibility ladder. Run it after ANY change to grants, policies,
-- SECURITY DEFINER functions, or the ceiling.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor, or hand it to execute_sql. It
-- wraps itself in a transaction and rolls back, so it is safe against production and leaves
-- nothing behind.
--
-- WHAT IT DOES ON FAILURE: raises, naming every check that failed. A green run prints one row
-- saying the guards hold. There is deliberately no "mostly passed" outcome.
--
-- ⚠️ IT IS NOT pgTAP, AND THAT IS A CHOICE RATHER THAN A SHORTCUT. pgtap is available on this
-- project but not installed, and installing an extension on a production database to run six
-- assertions is a bigger change than the assertions. CI cannot run this either: the workflows
-- have no database credentials (build / lint / test are npm-only), and giving GitHub Actions a
-- connection string to the live database is a decision for Evan rather than a side effect of
-- writing a test. Until then this is run by hand and by me after every migration.
--
-- ⚠️ CHECK H IS THE ONE THAT CATCHES THE UNKNOWN. The others test things we already know to be
-- true; H fails when a NEW SECURITY DEFINER function becomes anon-callable, which is the shape
-- of every accident this file exists to prevent. Its allow-list is the eight functions that are
-- deliberately open to the signed-out web. Adding a ninth should be a decision somebody makes on
-- purpose, which means editing this list on purpose.

begin;

create temp table fails(check_name text, detail text);
create temp table subject as
  select (select user_id from public.profiles p
           where coalesce(p.suspended,false) = false
             and not exists (select 1 from public.admin_users a where a.user_id = p.user_id)
           order by p.username limit 1) as member,
         (select user_id from public.admin_users limit 1) as admin;
grant select on subject to authenticated, anon;
grant select, insert on fails to authenticated, anon;

-- ── 0. THE FIXTURES MUST EXIST, OR EVERY CHECK BELOW PASSES BY TESTING NOTHING ──────────────
-- ⚠️ THIS IS THE MOST IMPORTANT BLOCK IN THE FILE, and it was added when this test was pointed
-- at CI. Against the live database the fixtures are obviously there; against a freshly created
-- database with only the migrations applied there are no members, no admin and no logs — and
-- every check that needs a session would then quietly succeed against nobody. A guard suite that
-- reports "0 failures" on an empty schema is worse than no suite, because it reports it in green.
insert into fails select 'FIXTURE: no non-admin member exists', 'seed the database before running this'
where (select member from subject) is null;
insert into fails select 'FIXTURE: no admin exists', 'seed an admin_users row before running this'
where (select admin from subject) is null;
insert into fails select 'FIXTURE: no profiles at all', 'the schema may be empty'
where not exists (select 1 from public.profiles);
insert into fails select 'FIXTURE: no circuit log with an owner',
       'the suspension checks below would test nothing'
where not exists (select 1 from public.circuit_logs l
                   join public.circuit_people cp on cp.id = l.person_id
                  where cp.owner_user_id is not null);

-- ── A. the ceiling helpers are not callable by members or anon ──────────────────────────────
insert into fails
select 'ceiling helper is callable', r || ' can execute ' || f
from (values ('anon'),('authenticated')) roles(r),
     (values ('public.visibility_ceiling(uuid)'),
             ('public.clamp_visibility(uuid, public.visibility_tier)'),
             ('public.may_publish_a_page(uuid)'),
             ('public.feed_may_show(uuid)')) fns(f)
where has_function_privilege(r, f, 'execute');

-- ── B. the deny-all tables are deny-all, per privilege ──────────────────────
-- ⚠️ `visibility_certain` JOINED THIS LIST THE DAY IT WAS CREATED, because the default
-- ACL on this schema hands arwdDxtm to anon and authenticated on EVERY new table. Deny-all is
-- something a table has to be given, never something it starts with -- so the revoke in the
-- migration and this check are the same rule said twice, once as an action and once as a test.
-- `picture_orphans` joined it the same way, on 3 Nov, for the same reason.
--
-- ⚠️ TRUNCATE IS IN THE PRIVILEGE LIST AND IS THE ONE RLS CANNOT COVER. There is no
-- TRUNCATE policy type, so a deny-all table with a stray grant is one verb away from being
-- emptied -- measured on a scratch table: INSERT refused, DELETE allowed but 0 rows, TRUNCATE
-- succeeded. What stood between `anon` and an empty table was PostgREST having no verb that
-- emits one, which is an accident of the API surface rather than a privilege check.
insert into fails
select 'a deny-all table is not deny-all', r || ' has ' || priv || ' on ' || t
from (values ('anon'),('authenticated')) roles(r),
     (values ('public.visibility_circles'),('public.visibility_circle_members'),
             ('public.visibility_certain'),('public.picture_orphans')) tbls(t),
     (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) privs(priv)
where has_table_privilege(r, t, priv);

insert into fails
select 'a deny-all table has RLS off or a policy', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('visibility_circles','visibility_circle_members','visibility_certain',
                    'picture_orphans')
  and (not c.relrowsecurity
       or exists (select 1 from pg_policy p where p.polrelid = c.oid));

-- ── C. members cannot write profiles directly ───────────────────────────────────────────────
insert into fails
select 'profiles is writable by a role', r || ' has ' || priv
from (values ('anon'),('authenticated')) roles(r),
     (values ('INSERT'),('UPDATE'),('DELETE')) privs(priv)
where has_table_privilege(r, 'public.profiles', priv);

insert into fails
select 'profiles has a write policy', polname
from pg_policy where polrelid = 'public.profiles'::regclass and polcmd in ('a','w');

-- ── D. age_band must not acquire a default, or new members stop being capped ────────────────
insert into fails
select 'age_band gained a column default', coalesce(pg_get_expr(d.adbin, d.adrelid), '?')
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where c.oid = 'public.profiles'::regclass and a.attname = 'age_band';

insert into fails
select 'signup now sets age_band', 'complete_member_signup mentions age_band'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'complete_member_signup'
  and pg_get_functiondef(p.oid) ~* 'age_band';

-- ── E. as a member: self-only answers, and no writing to profiles ───────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select member::text from subject), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare v_mine text; v_admin uuid; v_member uuid;
begin
  select member, admin into v_member, v_admin from subject;

  begin
    v_mine := public.my_visibility_ceiling()::text;
    if v_mine is distinct from 'members' and v_mine is distinct from 'friends' then
      insert into fails values ('my_visibility_ceiling', 'returned ' || coalesce(v_mine,'NULL'));
    end if;
  exception when others then
    insert into fails values ('my_visibility_ceiling', 'raised: ' || sqlerrm);
  end;

  /* it must answer about the CALLER -- if it ever reports the admin's 'public' it is reading
     the wrong row */
  if v_mine = 'public' then
    insert into fails values ('my_visibility_ceiling', 'a non-admin member got the public ceiling');
  end if;

  if public.is_suspended(v_admin) is not null then
    insert into fails values ('is_suspended leaks', 'answered about another member');
  end if;
  if public.is_suspended(v_member) is null then
    insert into fails values ('is_suspended broken', 'will not answer about the caller');
  end if;
  if public.are_friends(v_admin, v_admin) is not null then
    insert into fails values ('are_friends leaks', 'answered about two other members');
  end if;

  -- the policies that depend on those two must still work
  begin perform 1 from public.circuit_logs limit 1;
  exception when others then insert into fails values ('circuit_logs unreadable', sqlerrm); end;
  begin perform 1 from public.circuit_movies limit 1;
  exception when others then insert into fails values ('circuit_movies unreadable', sqlerrm); end;

  begin
    execute 'update public.profiles set age_band = ''adult'' where user_id = auth.uid()';
    insert into fails values ('member wrote profiles', 'age_band update succeeded');
  exception when insufficient_privilege then null;
           when others then null;
  end;
end $$;
reset role;

-- ── F. a suspended member cannot comment or react ───────────────────────────────────────────
-- ids are resolved BEFORE the suspension, because a suspended member cannot select a log and a
-- fixture that looks one up afterwards silently tests nothing.
-- ⚠️ IT REMEMBERS WHAT IT FOUND, because this block suspends somebody and block L below needs a
-- cast that is not quietly one member short. `limit 1` here has no ORDER BY, so WHICH member gets
-- suspended is up to the planner; leaving them suspended made every later block depend on that
-- choice, which is the "result turns on fixture order" trap certain-lists.sql already paid for.
-- The restore is three lines below the last assertion that needs the suspension.
create temp table fx as
  select l.id as log_id, cp.owner_user_id as owner,
         coalesce(p.suspended, false) as was_suspended
  from public.circuit_logs l
  join public.circuit_people cp on cp.id = l.person_id
  join public.profiles p on p.user_id = cp.owner_user_id
  where cp.owner_user_id is not null
  limit 1;
grant select on fx to authenticated;

insert into fails select 'suspension fixture is empty', 'no log with an owner to test against'
where not exists (select 1 from fx);

update public.profiles set suspended = true
 where user_id = (select owner from fx);

select set_config('request.jwt.claims',
  json_build_object('sub', (select owner::text from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    insert into public.circuit_log_comments (log_id, user_id, body)
    select log_id, owner, 'guard check' from fx;
    insert into fails values ('suspended member commented', 'insert succeeded');
  exception when others then null; end;
  begin
    insert into public.circuit_log_reactions (log_id, user_id, emoji)
    select log_id, owner, '🔥' from fx;
    insert into fails values ('suspended member reacted', 'insert succeeded');
  exception when others then null; end;
end $$;
reset role;

/* put them back as found -- see the note on `fx`. Both assertions above have run by here. */
update public.profiles set suspended = (select was_suspended from fx)
 where user_id = (select owner from fx);

-- ── G. anon cannot reach anything but the eight public doors ────────────────────────────────
set local role anon;
do $$
begin
  begin
    perform public.my_visibility_ceiling();
    insert into fails values ('anon called my_visibility_ceiling', 'it answered');
  exception when others then null; end;
end $$;
reset role;

-- ── H. no NEW security definer function may be anon-callable ────────────────────────────────
insert into fails
select 'new SECURITY DEFINER function is anon-callable', p.proname || '(' ||
       pg_get_function_identity_arguments(p.oid) || ')'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute')
  and p.proname not in (
    'circuit_public', 'get_demo_profile', 'get_invite_by_token', 'get_public_activity',
    'get_public_profile', 'submit_contact_message', 'submit_score',
    -- the Lab's catalog flags (featured / experiment / hidden), so a guest's picker hides what the
    -- owner retired. It answers a guest with those flags and nothing counted: no vote total, no
    -- note, nobody's activity. Applied 9 Nov 2026 as 20261109030613_lab_catalog_and_feedback.
    'lab_catalog'
  );

-- ── I. every writer of a visibility tier must route through the clamp ────────────────────
-- ⚠️ THE ENUMERATION IS THE CHECK, because a function's NAME is no guide at all. Four setters
-- wrote a raw tier for a month while `clamp_visibility` sat beside them, and the fourth --
-- `save_my_profile_blocks` -- is one nobody would ever have listed: its job reads as "save my
-- page", and it writes the tier in an INSERT column list rather than a `set visibility =`. This
-- asks the SCHEMA which tables carry a tier and then asks which statements write one.
--
-- ⚠️ JUDGED PER STATEMENT, NOT PER FUNCTION, and the first version got this wrong. It exempted
-- a whole function body as soon as the word `clamp_visibility` appeared anywhere in it -- so a
-- function with one clamped write and one unclamped write passed on the strength of the clamped
-- one. Proved by injecting exactly that: the old block was silent, this one names it.
--
-- ⚠️ AND COMMENTS ARE STRIPPED FIRST, which is not tidiness -- it is the difference between a
-- checker and a nuisance. `pg_get_functiondef` returns the comments, and on the first run they
-- produced two findings on a clean tree: `chronicle_share_timeline` has the word 'public' IN
-- QUOTES inside a comment explaining why it does not use that tier, which defeated the
-- narrow-literal exemption; and a semicolon inside one of `chronicle_import`'s comments split
-- the goals insert away from its own helper call. A checker that cries wolf about correct code
-- is one nobody runs twice.
--
-- The split is naive about semicolons inside STRING LITERALS, and that is the safe direction: an
-- over-split statement loses its clamp and gets REPORTED, which is visible and fixable.
--
-- ⚠️ AND IT READS `prosrc`, THE BODY, NOT `pg_get_functiondef`, WHICH ALSO RETURNS THE HEADER.
-- `player_registry_default_reveal` has no semicolon before its one assignment, so the first
-- fragment carried the whole header down with it -- including `SET search_path TO 'public'`,
-- whose quoted 'public' defeated the narrow-literal exemption and failed a correct trigger.
--
-- Exempt, by rule rather than by name: a statement whose only tier values are the narrow
-- literals. `private`, `certain` and `friends` are at or below the LOWEST ceiling the ladder can
-- produce, so a statement that mentions those and never `members` or `public` cannot exceed
-- anybody's. `chronicle_share_timeline` creates its card at a literal 'friends' that way, and
-- `chronicle_tier_sync` and `player_registry_default_reveal` derive one the same way.
insert into fails
select 'writes a visibility tier without clamping', f.proname || ' -> ' || t.t
from (
  select s.proname, btrim(st.stmt) as stmt
    from (
      select p.proname,
             regexp_replace(
               regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
               '--[^' || chr(10) || ']*', ' ', 'g') as src
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
    ) s
    cross join lateral regexp_split_to_table(s.src, ';') as st(stmt)
) f
join (
  select distinct c.relname as t
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and a.attname in ('visibility', 'activity_visibility')
) t
  on f.stmt ~* ('(update|insert\s+into)\s+(public\.)?' || t.t || '\M')
where (
       f.stmt ~* 'set[^;]*\m(activity_)?visibility\s*='
    or f.stmt ~* 'insert\s+into[^(]*\([^)]*\m(activity_)?visibility\M'
    or f.stmt ~* 'do\s+update\s+set[^;]*\m(activity_)?visibility\s*='
  )
  and f.stmt !~* 'clamp_visibility|chronicle_tier_from_file'
  and not (f.stmt ~ '''(private|certain|friends)''' and f.stmt !~ '''(members|public)''');

insert into fails
select 'a trigger assigns a visibility tier without clamping', f.proname
from (
  select s.proname, btrim(st.stmt) as stmt
    from (
      select p.proname,
             regexp_replace(
               regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
               '--[^' || chr(10) || ']*', ' ', 'g') as src
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
    ) s
    cross join lateral regexp_split_to_table(s.src, ';') as st(stmt)
) f
where f.stmt ~* '\mnew\.(activity_)?visibility\s*:='
  and f.stmt !~* 'clamp_visibility|chronicle_tier_from_file'
  and not (f.stmt ~ '''(private|certain|friends)''' and f.stmt !~ '''(members|public)''');

-- ⚠️ AND THE FUNCTIONS ARE ONLY HALF OF IT: A GRANT IS A WRITE PATH TOO. `authenticated` held
-- INSERT and UPDATE on `circuit_people`, column `visibility` included, with no trigger -- so a
-- hand-sent PATCH wrote the tier directly and never met `set_person_visibility`. Measured before
-- it was closed: through the RPC, asking for `public` stored `members`; a direct UPDATE stored
-- `public` on an account whose ceiling is `members`. Every other tier table is deny-all, which
-- is why no amount of looking at FUNCTIONS could ever have found it.
--
-- A table whose tier column a member may write must carry a BEFORE INSERT OR UPDATE trigger
-- whose function clamps. A deny-all table needs no trigger, because there is no way in.
insert into fails
select 'a tier column is writable with no clamp trigger on the table',
       r.role || ' has ' || pr.priv || ' on ' || t.t || '.' || t.col
from (
  select distinct c.oid, c.relname as t, a.attname as col
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and a.attname in ('visibility', 'activity_visibility')
) t,
(values ('anon'), ('authenticated')) r(role),
(values ('INSERT'), ('UPDATE')) pr(priv)
where has_column_privilege(r.role, t.oid, t.col, pr.priv)
  and not exists (
    select 1 from pg_trigger tg
     where tg.tgrelid = t.oid
       and not tg.tgisinternal
       and (tg.tgtype & 2) <> 0    -- BEFORE
       and (tg.tgtype & 4) <> 0    -- INSERT
       and (tg.tgtype & 16) <> 0   -- UPDATE
       and pg_get_functiondef(tg.tgfoid) ~* 'clamp_visibility'
  );

-- ── J. no stored tier may sit above its owner's ceiling ────────────────────────────
-- ⚠️ THIS WAS A REPORT UNTIL 3 NOV AND IS NOW A FAILURE, because the five rows it was reporting
-- have been brought down. It could not be a failure before that: they were real members' saved
-- choices, and a suite that stays red until somebody else's data is rewritten is a suite that
-- gets ignored. Once the data is clean, the same check becomes the thing that keeps it clean.
--
-- These were never a leak -- the read doors clamp, and that clamp was measured load-bearing
-- (an anonymous read of a page went from 50 rows to 0 when its owner's ceiling dropped). What
-- they were is a LATENT widening: `least(stored, ceiling)` starts returning the wider value the
-- day a ceiling rises, and nobody chooses that on the day it happens.
--
-- Counts immediately before the backfill: profiles 1, circuit_people 1, profile_blocks 3,
-- player_registry 0. After it, and expected from here on: 0 everywhere.
insert into fails
select 'a stored tier sits above its owner''s ceiling', col || ': ' || n || ' row(s)'
from (
  select 'profiles.activity_visibility' as col, count(*) as n
    from public.profiles p where p.activity_visibility > public.visibility_ceiling(p.user_id)
  union all select 'player_registry.visibility', count(*)
    from public.player_registry r where r.visibility > public.visibility_ceiling(r.user_id)
  union all select 'circuit_people.visibility', count(*)
    from public.circuit_people c where c.visibility > public.visibility_ceiling(c.owner_user_id)
  union all select 'profile_blocks.visibility', count(*)
    from public.profile_blocks b where b.visibility > public.visibility_ceiling(b.user_id)
  -- chronicle carries a second, lower cap of its own: a timeline is friends-only by design
  union all select 'chronicle_activities.visibility', count(*)
    from public.chronicle_activities a
   where a.visibility > least(public.visibility_ceiling(a.owner), 'friends'::public.visibility_tier)
  union all select 'chronicle_goals.visibility', count(*)
    from public.chronicle_goals g
   where g.visibility > least(public.visibility_ceiling(g.owner), 'friends'::public.visibility_tier)
) z where n > 0;

-- ── K. a member-callable writer must refuse a suspended member ─────────────────
-- ⚠️ THREE SWEEPS BY HAND WENT STALE IN THREE DAYS. Ten functions were guarded on 3 Nov by
-- naming them, then seven more, and a census afterwards found 91 member-callable SECURITY
-- DEFINER writers still unguarded -- including `post_profile_note`, which puts your words on
-- somebody else's page, and `submit_score`, which puts your name on the board everybody reads.
-- A list cannot keep up with a schema. This asks the catalogue instead.
--
-- WHY THE FUNCTIONS AND NOT THE TABLES: these all run as the OWNER, so the RESTRICTIVE
-- `*_not_suspended` policies on the circuit tables never see the caller. A policy cannot guard a
-- definer function; only the function can.
--
-- WHO IS OUT, and each exemption is a rule rather than a name on a list:
--
--   * anything whose only writes are DELETEs. Suspension stops somebody acting on other
--     people's screens; taking your own things down is the opposite, and blocking it would trap
--     a suspended member with the very thing they were suspended for. That is the `picture_drop`
--     decision, generalised.
--   * anything named `admin_*`, or whose body OPENS with a refusal for non-admins. It has its
--     own door, and `admin_set_suspended` must never be blocked by the state it exists to change.
--     ⚠️ "Opens with" rather than "mentions": the first version of this check took the
--     mere presence of `is_admin()` as a gate, and `rename_circuit` -- `is_admin() OR the
--     circuit OWNER` -- walked straight through it.
--
-- And four named exemptions, which ARE a list, because each is a judgement:
--
--   * `submit_contact_message` -- how somebody APPEALS a suspension. Shutting it would make the
--     punishment unappealable.
--   * `mark_activity_seen`, `mark_room_read` -- pure self-bookkeeping; they clear your own
--     unread badges and reach nobody.
--   * `close_park_room`, `close_profile_room` -- they only close a room of your own, which is a
--     narrowing action like a delete.
--
--   `link_snake_names_to_accounts` used to be listed here and is no longer member-callable at
--   all: anybody can pre-post a leaderboard score under a username nobody has claimed, and that
--   function would hand the row to the real person the day they signed up. Revoked, so it falls
--   out of this check's scope by itself.
insert into fails
select 'a member-callable writer does not refuse a suspended member', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute')
  and p.proname not like 'admin\_%'
  and p.proname not in (
    'submit_contact_message', 'mark_activity_seen', 'mark_room_read',
    'close_park_room', 'close_profile_room'
  )
  /* comments stripped first, for the reason block I records: a word in a comment is not code */
  and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
                     '--[^' || chr(10) || ']*', ' ', 'g')
        ~* '\m(insert\s+into|update)\s+(public\.)?[a-z_]+'
  and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
                     '--[^' || chr(10) || ']*', ' ', 'g') !~* 'is_suspended'
  /* ⚠️ GATED BY is_admin(), NOT MERELY MENTIONING IT. The first version of this
     check exempted any body containing the word, and that let `rename_circuit` through: it reads
     `if not (is_admin() or <the circuit owner>)`, so it mentions the function and is gated by
     neither. A suspended circuit OWNER could rename a circuit everybody in it sees.
     (Checked rather than assumed: the exists clause requires `gm.role = 'owner'`, and an
     ordinary member of the group is refused. The size of the blast radius was smaller than
     first written; the hole, and the reason the exemption was wrong, were not.)

     The test is now that the body OPENS with a refusal for non-admins -- optionally after a
     `declare`, optionally with the admin test inside parentheses alongside a service-role
     alternative, which is how `upsert_prices` reads. Anything that checks something else first,
     or that offers a non-admin branch, is not exempt. */
  and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
                     '--[^' || chr(10) || ']*', ' ', 'g')
        !~* '^\s*(declare\s.*?)?\s*begin\s*if\s+not\s*\(?\s*(public\.)?is_admin\s*\(\)';

-- ── L. a minor's things stay out of BOTH feed tabs until their guardian opts in ─────────────
-- The one rule in this file that protects a person rather than a preference, and the only one
-- that had no test. `feed_may_show(owner)` is `owner = auth.uid() or adult or feed_opt_in`, and
-- `feed_recent` applies it twice — once to the list of members it walks, once to the sittings
-- block. Neither application was checked, in either scope.
--
-- ⚠️ IT IS A DIFFERENTIAL, BECAUSE "A MINOR'S THINGS ARE ABSENT" IS ALSO WHAT AN EMPTY FEED
-- SAYS. A feed with nothing in it, a window with nothing in it and a cast with no activity in it
-- are indistinguishable from a working rule when all you have is the zero — the empty-room trap
-- in CLAUDE.md §2. So the opted-in state must be non-zero, or the zero beside it means nothing.
--
-- ⚠️ THE TWO STATES DIFFER ONLY IN `feed_opt_in`, AND THE FIRST DRAFT OF THIS BLOCK GOT IT
-- WRONG. It compared an ADULT against a MINOR, which moves two rules at once: this one and
-- `visibility_ceiling`, which caps a minor at Friends. Against production that happened not to
-- matter — the cast's subject is the admin, and the ceiling answers `public` for an admin before
-- it looks at age — so the block passed with the confound sitting in it unseen. Against the CI
-- seed, where the subject is an ordinary member, the ceiling really does drop, and the block
-- would have reported a zero it had not earned. Holding `age_band` at `minor` across BOTH
-- measurements removes the confound by construction rather than by luck: the ceiling is identical
-- either side, so the only thing that moved is the guardian's tick. It is still compared below,
-- as a tripwire rather than as a hope.
--
-- ⚠️ AND THE POSITIVE CONTROL HAS TO BE THE FRIEND, NOT THE NON-FRIEND. A minor's ceiling is
-- Friends, so a non-friend cannot see their things whatever the guardian ticks; there is no state
-- in which that viewer's count comes back, and demanding one would fail honestly for the wrong
-- reason. The non-friend is still measured, as a one-directional check that All members shows
-- them nothing — the friend's pair is what makes the zeros mean something.
--
-- Costs five `feed_recent` calls, ~1.2s. The window is frozen once so both states span the same
-- fourteen days.
--
-- Measured against production, 4 Nov 2026. The subject there is the admin, so the ceiling holds
-- at `public` and even the non-friend's count returns, which is more than this block asks for:
--   a friend, All members        0 -> 88
--   a friend, You + friends      0 -> 88
--   a non-friend, All members    0  (not asserted on the opted-in side)
--
-- Made to fail once, by deleting `and public.feed_may_show(p.user_id)` from the member loop
-- inside the same rolled-back transaction: 3 assertions red, naming 24 items to a non-friend and
-- 2 to a friend in each tab.
--
-- ⚠️ AND THE SHAPE OF THAT FAILURE SAYS SOMETHING THE GREEN RUN CANNOT: 2, not 88. `feed_recent`
-- applies `feed_may_show` in TWO places, and deleting one leaves the other holding — the friend's
-- other 86 items are sittings, gated separately in the `chronicle_friends_log` block. So the two
-- applications are independent and both load-bearing, and a future edit that removes either one
-- is caught by these assertions rather than by only the first.
do $$
declare
  v_sub uuid; v_sub_u text; v_far uuid; v_near uuid;
  v_from timestamptz := clock_timestamp() - interval '14 days';
  v_to   timestamptz := clock_timestamp();
  v_band text; v_opt boolean;                 -- the subject's real values, put back at the end
  v_ceil_off text; v_ceil_on text;
  n_near_all_off int; n_near_yf_off int; n_far_all_off int;
  n_near_all_on int;  n_near_yf_on int;
begin
  /* the same cast rule as certain-lists.sql: the member with the most accepted friendships is
     the one most likely to have activity worth seeing, and the suite stays consistent */
  select p.user_id, p.username::text into v_sub, v_sub_u
    from public.profiles p
   where coalesce(p.suspended, false) = false
   order by (select count(*) from public.friendships f
              where f.status = 'accepted'
                and (f.user_a = p.user_id or f.user_b = p.user_id)) desc,
            p.username
   limit 1;

  select p.user_id into v_far
    from public.profiles p
   where coalesce(p.suspended, false) = false and p.user_id <> v_sub
     and not exists (select 1 from public.friendships f
                      where f.status = 'accepted'
                        and f.user_a = least(v_sub, p.user_id)
                        and f.user_b = greatest(v_sub, p.user_id))
   order by p.username limit 1;

  select p.user_id into v_near
    from public.profiles p
   where coalesce(p.suspended, false) = false and p.user_id <> v_sub
     and exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and f.user_a = least(v_sub, p.user_id)
                    and f.user_b = greatest(v_sub, p.user_id))
   order by p.username limit 1;

  if v_sub is null or v_far is null or v_near is null then
    insert into fails values ('FIXTURE: the feed cast is incomplete',
      'need a subject with both a non-friend and an accepted friend, none of them suspended');
    return;
  end if;

  select age_band::text, coalesce(feed_opt_in, false) into v_band, v_opt
    from public.profiles where user_id = v_sub;

  -- ── a minor whose guardian has not opted in: nothing of theirs, in either tab ──
  update public.profiles set age_band = 'minor', feed_opt_in = false where user_id = v_sub;
  v_ceil_off := public.visibility_ceiling(v_sub)::text;

  if public.feed_may_show(v_sub) then
    insert into fails values ('feed_may_show admits a minor whose guardian has not opted in',
      v_sub_u);
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_near::text, 'role', 'authenticated')::text, true);
  select count(*) into n_near_all_off from jsonb_array_elements(
    public.feed_recent(v_from, v_to, 40, 'all_members')) e where e->>'who' = v_sub_u;
  select count(*) into n_near_yf_off from jsonb_array_elements(
    public.feed_recent(v_from, v_to, 40, 'you_and_friends')) e where e->>'who' = v_sub_u;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_far::text, 'role', 'authenticated')::text, true);
  select count(*) into n_far_all_off from jsonb_array_elements(
    public.feed_recent(v_from, v_to, 40, 'all_members')) e where e->>'who' = v_sub_u;

  if n_near_all_off <> 0 then
    insert into fails values ('a minor reaches All members with no guardian opt-in',
      n_near_all_off || ' item(s) of ' || v_sub_u || ' to a friend');
  end if;
  if n_far_all_off <> 0 then
    insert into fails values ('a minor reaches All members with no guardian opt-in',
      n_far_all_off || ' item(s) of ' || v_sub_u || ' to a non-friend');
  end if;
  if n_near_yf_off <> 0 then
    insert into fails values ('a minor reaches You + friends with no guardian opt-in',
      n_near_yf_off || ' item(s) of ' || v_sub_u);
  end if;

  -- ── the same minor, guardian opted in. `age_band` is untouched, so the ceiling cannot be
  --    what changes the answer ──
  update public.profiles set feed_opt_in = true where user_id = v_sub;
  v_ceil_on := public.visibility_ceiling(v_sub)::text;

  if not public.feed_may_show(v_sub) then
    insert into fails values ('feed_may_show refuses a minor whose guardian HAS opted in', v_sub_u);
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_near::text, 'role', 'authenticated')::text, true);
  select count(*) into n_near_all_on from jsonb_array_elements(
    public.feed_recent(v_from, v_to, 40, 'all_members')) e where e->>'who' = v_sub_u;
  select count(*) into n_near_yf_on from jsonb_array_elements(
    public.feed_recent(v_from, v_to, 40, 'you_and_friends')) e where e->>'who' = v_sub_u;

  /* the control. Without this the three zeros above are also what an empty feed says. */
  if n_near_all_on = 0 then
    insert into fails values ('FIXTURE: an opted-in minor still reaches their friend with nothing',
      'the zeros above would pass against an empty feed — seed the subject some activity');
  end if;
  if n_near_yf_on = 0 then
    insert into fails values ('FIXTURE: an opted-in minor reaches You + friends with nothing',
      'the zeros above would pass against an empty feed — seed the subject some activity');
  end if;

  /* the tripwire -- see the note above this block. Both measurements are taken at `minor`, so
     this can only move if something else reads `feed_opt_in` into the ceiling. */
  if v_ceil_on is distinct from v_ceil_off then
    insert into fails values ('this block now measures two rules at once',
      'the ceiling moved ' || v_ceil_off || ' -> ' || v_ceil_on
      || ' on a guardian tick, so a zero above could be the cap rather than the feed rule');
  end if;

  /* put the subject back as found. The file rolls back regardless, so this is for the blocks
     that might one day be added after it rather than for the database. `age_band` is text and
     may legitimately be null — "unknown", which is what a new signup starts as. */
  update public.profiles set age_band = v_band, feed_opt_in = v_opt where user_id = v_sub;
end $$;

-- ── M. the unknown-age notice is admin-only, and so is the column under it ──────────────────
-- `admin_members_without_age_band` is the only thing on the site that says "these members are
-- invisible to everybody but themselves". It is a list of who has no age recorded, which is a
-- fact about children, so it is admin-only in the server rather than in the panel.
--
-- ⚠️ IT NEEDS A SEEDED MEMBER OR IT PROVES NOTHING, and production is the awkward case: every
-- one of the 14 members has an age band today, so the honest answer to the admin is an empty
-- list. Against that, a function that returned `{"count":0,"handles":[]}` to EVERYBODY would
-- pass a refusal test by accident — the empty-room trap in CLAUDE.md §2, in the one place where
-- the thing being hidden is a child's. So one member is moved to a null age band first, the
-- admin's answer must NAME them, and the refusals are only meaningful beside that.
--
-- ⚠️ AND THE SECOND HALF IS THE TABLE, NOT THE FUNCTION. `authenticated` holds SELECT on
-- `profiles.age_band` and `profiles.feed_opt_in` — the schema's default ACL again — so a
-- member-callable PostgREST read is the obvious way round this function. What makes it inert is
-- the row policy: `profiles_select` is self-only, measured as a member on 4 Nov as **1 row** of
-- `profiles`, their own. That is what makes "non-admins get nothing" a claim about the DATA
-- rather than about one RPC, so it is asserted here. If members are ever meant to read each
-- other's profile rows directly, these two columns need a column-level revoke on the same day.
create temp table agefx as
  select p.user_id as uid, p.username::text as u, p.age_band::text as was
  from public.profiles p
  where p.user_id = (select member from subject);
grant select on agefx to authenticated, anon;

insert into fails select 'unknown-age fixture is empty', 'no non-admin member to seed'
where not exists (select 1 from agefx);

update public.profiles set age_band = null where user_id = (select uid from agefx);

do $$
declare v_answer jsonb; v_u text := (select u from agefx);
begin
  /* the admin, who must be able to see it, or the two refusals below mean nothing */
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select admin::text from subject), 'role', 'authenticated')::text,
    true);
  begin
    v_answer := public.admin_members_without_age_band();
    if not (v_answer->'handles') @> to_jsonb(v_u) then
      insert into fails values ('the notice does not name a member with no age band',
        'seeded one and got ' || v_answer::text);
    end if;
    if (v_answer->>'count')::int is distinct from jsonb_array_length(v_answer->'handles') then
      insert into fails values ('the notice count disagrees with its own list', v_answer::text);
    end if;
    /* count + handle and nothing else: a key beyond these two is personal data travelling for
       no reason, and this is the check that notices one being added */
    if (select count(*) from jsonb_object_keys(v_answer) k where k not in ('count', 'handles')) > 0
    then
      insert into fails values ('the notice answers with more than count and handles',
        (select string_agg(k, ', ') from jsonb_object_keys(v_answer) k));
    end if;
  exception when others then
    insert into fails values ('the notice refuses the admin', sqlerrm);
  end;

  /* a signed-in non-admin: past the privilege check, stopped by is_admin() in the body */
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select uid::text from agefx), 'role', 'authenticated')::text, true);
  begin
    v_answer := public.admin_members_without_age_band();
    insert into fails values ('a non-admin member can read the unknown-age notice',
      v_answer::text);
  exception when others then null; end;
end $$;

/* the claims are still the member's -- now as the member's ROLE, so RLS applies */
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.profiles where user_id <> auth.uid();
  if n > 0 then
    insert into fails values ('a member can read other members'' profile rows directly',
      n || ' row(s); age_band and feed_opt_in are readable columns, so this is the notice '
        || 'as a PostgREST query');
  end if;
exception when others then null;   -- refused outright is the stricter answer, not a failure
end $$;
reset role;

/* anon. ⚠️ THE CLAIMS HAVE TO BE CLEARED FIRST, and the first draft of this block did not do it:
   the do block above leaves the MEMBER's JWT in place, so `set local role anon` alone tests a
   signed-in member calling from the anon role, which `is_admin()` refuses for its own reason.
   The test passed and was about the wrong thing. Measured by granting anon execute inside a
   rolled-back transaction: with the member's claims still set it came back `admin only`, so a
   stray grant would not have shown up here at all.
   It does not need to: a grant is block H's job, which enumerates every anon-callable SECURITY
   DEFINER function. What this asserts is the OUTCOME — anon gets nothing — and that outcome is
   held twice over, by the revoke and by `auth.uid() is null` in the body. */
select set_config('request.jwt.claims', '{}', true);
set local role anon;
do $$
begin
  perform public.admin_members_without_age_band();
  insert into fails values ('anon can read the unknown-age notice', 'it answered');
exception when others then null; end $$;
reset role;

/* put the age band back as found. The file rolls back regardless; this is so a block added
   after this one cannot inherit a member who is quietly invisible. */
update public.profiles set age_band = (select was from agefx)
 where user_id = (select uid from agefx);

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n')
    into n, msg from fails;
  if n > 0 then
    raise exception E'VISIBILITY GUARDS FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'all visibility guards hold' as result, count(*) as failures from fails;

rollback;
