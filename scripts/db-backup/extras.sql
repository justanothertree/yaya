-- What a dump of public and finance cannot carry but a restore needs to know about, kept inside
-- the encrypted bundle beside it. Read-only.
--
--   psql -X -At -F $'\t' -f scripts/db-backup/extras.sql
--
-- Each line is   kind <TAB> name <TAB> value
--   publication  <pubname> <schema.table>   realtime: a restored table is in no publication, so
--                                           chat and the circuit go quiet until these are re-added
--                                           (db-backup.sh verify prints the statements)
--   cron         <jobname> <schedule>, base64(command)
--                                           pg_cron's jobs live in the cron schema, not in either
--                                           of these; captured only if this role may read them
--   cron         -   not captured            when it may not

\set ON_ERROR_STOP 1
set search_path = pg_catalog;

select 'publication', pubname, schemaname || '.' || tablename
  from pg_publication_tables
 where schemaname in ('public', 'finance')
 order by pubname collate "C", schemaname || '.' || tablename collate "C";

-- in order, because each question errors if the one before it was no
select case when to_regnamespace('cron') is null then false
            when not has_schema_privilege('cron', 'usage') then false
            when to_regclass('cron.job') is null then false
            else has_table_privilege('cron.job', 'select') end as can_read_cron
\gset
\if :can_read_cron
-- ⚠️ base64, because a command is free text with newlines and tabs in it. It can also name a
-- key, which is one more reason this file only ever exists inside the ciphertext.
select 'cron', jobname, schedule || ',' || translate(encode(convert_to(command, 'UTF8'), 'base64'), E'\n', '')
  from cron.job
 order by jobname collate "C";
\else
select 'cron', '-', 'not captured';
\endif
