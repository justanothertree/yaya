-- What a dump of public and finance cannot carry but a restore into a real project needs, kept
-- inside the encrypted bundle beside it. Read-only. `db-backup.sh after-restore DIR` turns it
-- back into SQL.
--
--   psql -X -At -F $'\t' -f scripts/db-backup/extras.sql
--
-- One line per thing, tab separated:
--   publication  <pubname>               <schema.table>
--       realtime: a restored table is in no publication, so chat and the circuit go quiet
--   policy       <schema.table.policy>   base64(create policy …)
--       policies the app wrote on Supabase's OWN tables — on 26 Nov 2026, eleven on
--       realtime.messages, which is Realtime's channel authorization
--   trigger      <schema.table.trigger>  base64(create trigger …)
--       a trigger on a table outside these schemas that calls a function inside them (an
--       auth.users trigger that makes a profile is the usual one; on 26 Nov there were none)
--   cron         <jobname>               <schedule>   base64(command)
--       pg_cron's jobs, if this role may read cron.job; otherwise one line `cron - not captured`
-- ⚠️ base64 because each of these is free text with newlines and tabs in it — and a cron command
-- can carry a key, which is one more reason this file only ever exists inside the ciphertext.

\set ON_ERROR_STOP 1
set search_path = pg_catalog;

select 'publication', pubname, schemaname || '.' || tablename
  from pg_publication_tables
 where schemaname in ('public', 'finance')
 order by pubname collate "C", schemaname || '.' || tablename collate "C";

select 'policy', n.nspname || '.' || c.relname || '.' || p.polname,
       translate(encode(convert_to(
         format('create policy %I on %I.%I as %s for %s to %s%s%s;',
                p.polname, n.nspname, c.relname,
                case when p.polpermissive then 'permissive' else 'restrictive' end,
                case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                              when 'd' then 'delete' else 'all' end,
                (select string_agg(case when x = 0 then 'public' else quote_ident(pg_get_userbyid(x)) end, ', ' order by x)
                   from unnest(p.polroles) x),
                coalesce(' using (' || pg_get_expr(p.polqual, p.polrelid) || ')', ''),
                coalesce(' with check (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '')),
         'UTF8'), 'base64'), E'\n', '')
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
 -- not ours to dump, and not pg_cron's own (it makes those itself)
 where n.nspname not in ('public', 'finance', 'cron', 'pg_catalog', 'information_schema')
 order by n.nspname || '.' || c.relname || '.' || p.polname collate "C";

select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
       translate(encode(convert_to(pg_get_triggerdef(t.oid) || ';', 'UTF8'), 'base64'), E'\n', '')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc f on f.oid = t.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
 where not t.tgisinternal and n.nspname not in ('public', 'finance') and fn.nspname in ('public', 'finance')
 order by n.nspname || '.' || c.relname || '.' || t.tgname collate "C";

-- in order, because each question errors if the one before it was no
select case when to_regnamespace('cron') is null then false
            when not has_schema_privilege('cron', 'usage') then false
            when to_regclass('cron.job') is null then false
            else has_table_privilege('cron.job', 'select') end as can_read_cron
\gset
\if :can_read_cron
select 'cron', jobname, schedule, translate(encode(convert_to(command, 'UTF8'), 'base64'), E'\n', '')
  from cron.job
 order by jobname collate "C";
\else
select 'cron', '-', 'not captured';
\endif
