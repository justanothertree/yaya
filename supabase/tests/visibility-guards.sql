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
create temp table fx as
  select l.id as log_id, cp.owner_user_id as owner
  from public.circuit_logs l
  join public.circuit_people cp on cp.id = l.person_id
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
    'get_public_profile', 'submit_contact_message', 'submit_score'
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
