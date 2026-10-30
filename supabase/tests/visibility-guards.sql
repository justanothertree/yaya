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

-- ── A. the ceiling helpers are not callable by members or anon ──────────────────────────────
insert into fails
select 'ceiling helper is callable', r || ' can execute ' || f
from (values ('anon'),('authenticated')) roles(r),
     (values ('public.visibility_ceiling(uuid)'),
             ('public.clamp_visibility(uuid, public.visibility_tier)'),
             ('public.may_publish_a_page(uuid)'),
             ('public.feed_may_show(uuid)')) fns(f)
where has_function_privilege(r, f, 'execute');

-- ── B. the circles tables are deny-all, per privilege ───────────────────────────────────────
insert into fails
select 'circles table is not deny-all', r || ' has ' || priv || ' on ' || t
from (values ('anon'),('authenticated')) roles(r),
     (values ('public.visibility_circles'),('public.visibility_circle_members')) tbls(t),
     (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) privs(priv)
where has_table_privilege(r, t, priv);

insert into fails
select 'circles table has RLS off or a policy', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('visibility_circles','visibility_circle_members')
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
