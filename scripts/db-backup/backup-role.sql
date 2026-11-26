-- The backup's own database role: it can read everything the backup needs and nothing else, and
-- it can write nothing at all. Run ONCE, as postgres, in the Supabase SQL editor — then give it a
-- password (step 2 of the walkthrough in docs/2026-11-21-database-backup-and-restore.md).
--
-- ⚠️ THE SAME FILE THE RESTORE TEST RUNS. scripts/restore-test.sh applies this to its source and
-- dumps as the role it makes, so a grant missing here fails a pull request rather than a Sunday.
-- Safe to run twice.
--
-- ⚠️ WHY A FUNCTION FOR THE MEMBER IDS, AND NOT A GRANT. postgres holds USAGE on schema auth
-- WITHOUT the grant option (measured 26 Nov 2026: auth's ACL gives postgres `U`, not `U*`), so
-- `grant usage on schema auth to …` does not fail — Postgres answers it with a WARNING and grants
-- nothing, and the SQL editor shows success. The ids are read instead through a SECURITY DEFINER
-- function owned by postgres, in a schema of its own that the API does not expose and the backup
-- does not dump, executable by this role alone.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'yaya_backup') then
    -- BYPASSRLS because pg_dump must see every row: a role subject to RLS is refused rather than
    -- given a partial dump. No password here: it is set separately so it is typed once.
    create role yaya_backup with login bypassrls;
  end if;
end $$;

-- every table and sequence in the two schemas the backup carries, now and from now on
grant usage on schema public, finance to yaya_backup;
grant select on all tables in schema public, finance to yaya_backup;
grant select on all sequences in schema public, finance to yaya_backup;
alter default privileges for role postgres in schema public grant select on tables to yaya_backup;
alter default privileges for role postgres in schema public grant select on sequences to yaya_backup;
alter default privileges for role postgres in schema finance grant select on tables to yaya_backup;
alter default privileges for role postgres in schema finance grant select on sequences to yaya_backup;

-- the member ids, and nothing else of auth
create schema if not exists backup;
revoke all on schema backup from public;
grant usage on schema backup to yaya_backup;
create or replace function backup.auth_user_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$ select id from auth.users order by id $$;
revoke all on function backup.auth_user_ids() from public, anon, authenticated, service_role;
grant execute on function backup.auth_user_ids() to yaya_backup;

-- optional, if pg_cron is installed: its job definitions, kept inside the ciphertext
do $$
begin
  if to_regclass('cron.job') is not null then
    execute 'grant usage on schema cron to yaya_backup';
    execute 'grant select on cron.job to yaya_backup';
  end if;
end $$;

-- ⚠️ THE PROOF, because a GRANT that cannot be given only warns. Every column must be true.
select r.rolcanlogin as can_log_in,
       r.rolbypassrls as sees_every_row,
       not (r.rolsuper or r.rolcreaterole or r.rolcreatedb) as administers_nothing,
       has_function_privilege('yaya_backup', 'backup.auth_user_ids()', 'execute') as reads_member_ids,
       not has_function_privilege('anon', 'backup.auth_user_ids()', 'execute')
         and not has_function_privilege('authenticated', 'backup.auth_user_ids()', 'execute') as nobody_else_does,
       (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public', 'finance') and c.relkind in ('r', 'p', 'S')
           and not has_table_privilege('yaya_backup', c.oid, 'select')) as reads_every_table,
       (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public', 'finance') and c.relkind in ('r', 'p')
           and (has_table_privilege('yaya_backup', c.oid, 'insert') or has_table_privilege('yaya_backup', c.oid, 'update')
                or has_table_privilege('yaya_backup', c.oid, 'delete') or has_table_privilege('yaya_backup', c.oid, 'truncate'))) as writes_nothing,
       to_regclass('cron.job') is null or has_table_privilege('yaya_backup', 'cron.job', 'select') as reads_cron_jobs
  from pg_roles r
 where r.rolname = 'yaya_backup';
