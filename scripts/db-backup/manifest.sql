-- A database's account of public and finance: every table's rows, every object's definition, and
-- who may do what to it. Read from the source either side of a dump and from the target after a
-- restore; scripts/db-backup.sh compares the two line for line. Read-only.
--
--   psql -X -At -F $'\t' -f scripts/db-backup/manifest.sql
--
-- Each line is   kind <TAB> what <TAB> name <TAB> md5
--   rows     table | sequence   every row of a table (count:md5), a sequence's position
--   catalog  relation, columns, constraints, indexes, triggers, policies, function, view, type,
--            schema, default-acl, comment
--
-- ⚠️ WHAT MAKES TWO SERVERS AGREE ABOUT THE SAME ROWS, each one a way this found a false mismatch
-- or could have:
--   - the text of a timestamptz depends on TimeZone, a float on extra_float_digits, a bytea on
--     bytea_output — all pinned below;
--   - `order by` on text depends on the database's collation, and production and a scratch
--     server need not share one — every sort here is COLLATE "C";
--   - an object restored with --no-owner belongs to whoever restored it, and a GRANT run during a
--     restore is GRANTED BY that role, so neither owner nor grantor is compared; who RECEIVES a
--     privilege, which privilege, and whether it can be passed on, is;
--   - a NULL ACL means "the built-in default" — compared as that default, so a NULL here and the
--     same grants spelt out there agree;
--   - attnum has gaps where a column was dropped, and a restore renumbers; columns are compared
--     in order, never by number.
-- ⚠️ supabase_admin's default privileges are left out on purpose: Supabase manages them on every
-- project and a restore cannot set them (db-backup.sh leaves those entries out of the restore).

\set ON_ERROR_STOP 1
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set intervalstyle = 'postgres';
set extra_float_digits = 1;
set bytea_output = 'hex';
-- refuse rather than filter: a role subject to RLS would otherwise count only what it may see
set row_security = off;
-- every name printed schema-qualified, the same on both sides
set search_path = pg_catalog;

-- ── rows ────────────────────────────────────────────────────────────────────────────────────────
select format($q$select 'rows', 'table', %L, count(*)::text || ':' || md5(coalesce(string_agg(row(t.*)::text, E'\n' order by row(t.*)::text collate "C"), '')) from %s t$q$,
              c.oid::regclass::text, c.oid::regclass)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'finance') and c.relkind in ('r', 'p')
   -- an extension's own tables are the extension's: pg_dump leaves them out, so this does too
   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
 order by c.oid::regclass::text collate "C"
\gexec

select format($q$select 'rows', 'sequence', %L, last_value::text || ':' || is_called::text from %s$q$,
              c.oid::regclass::text, c.oid::regclass)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'finance') and c.relkind = 'S'
   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
 order by c.oid::regclass::text collate "C"
\gexec

-- ── catalog ─────────────────────────────────────────────────────────────────────────────────────
with rel as (
  select c.*, c.oid::regclass::text as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'finance') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')),
fn as (
  select p.*, p.oid::regprocedure::text as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'finance')
     -- an extension's own functions are the extension's, not the schema's
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
typ as (
  select t.*, t.oid::regtype::text as name
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public', 'finance') and t.typtype in ('e', 'd', 'c')
     and (t.typrelid = 0 or (select relkind from pg_class where oid = t.typrelid) = 'c')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')),
lines(kind, name, val) as (
  -- what each relation is: kind, persistence, row security, replica identity, options, grants
  select 'relation', r.name,
         concat_ws('|', r.relkind, r.relpersistence, r.relrowsecurity, r.relforcerowsecurity, r.relreplident,
                   coalesce(array_to_string(r.reloptions, ','), '-'),
                   (select coalesce(string_agg(g, ',' order by g collate "C"), '-')
                      from (select format('%s:%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                                          x.privilege_type, x.is_grantable) as g
                              from aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) x) a))
    from rel r
  union all
  -- the columns, in order: name, type, not null, default, identity, generated, collation, grants
  select 'columns', r.name,
         string_agg(concat_ws('|', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                              coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), a.attidentity, a.attgenerated,
                              coalesce(co.collname, '-'),
                              (select coalesce(string_agg(g, ',' order by g collate "C"), '-')
                                 from (select format('%s:%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                                                     x.privilege_type, x.is_grantable) as g
                                         from aclexplode(a.attacl) x) ca)),
                    E'\n' order by a.attnum)
    from rel r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    left join pg_collation co on co.oid = a.attcollation
   group by r.name
  union all
  select 'constraints', r.name,
         string_agg(k.conname || '|' || k.contype::text || '|' || pg_get_constraintdef(k.oid), E'\n' order by k.conname collate "C")
    from rel r join pg_constraint k on k.conrelid = r.oid
   group by r.name
  union all
  select 'indexes', r.name,
         string_agg(pg_get_indexdef(i.indexrelid), E'\n' order by pg_get_indexdef(i.indexrelid) collate "C")
    from rel r join pg_index i on i.indrelid = r.oid
   group by r.name
  union all
  select 'triggers', r.name,
         string_agg(t.tgenabled::text || '|' || pg_get_triggerdef(t.oid), E'\n' order by t.tgname collate "C")
    from rel r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
   group by r.name
  union all
  select 'policies', r.name,
         string_agg(concat_ws('|', p.polname, p.polcmd, p.polpermissive,
                              (select string_agg(who, ',' order by who collate "C")
                                 from (select case when x = 0 then 'PUBLIC' else pg_get_userbyid(x)::text end as who
                                         from unnest(p.polroles) x) pr),
                              coalesce(pg_get_expr(p.polqual, p.polrelid), '-'),
                              coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')),
                    E'\n' order by p.polname collate "C")
    from rel r join pg_policy p on p.polrelid = r.oid
   group by r.name
  union all
  select 'view', r.name, pg_get_viewdef(r.oid, true)
    from rel r where r.relkind in ('v', 'm')
  union all
  -- a function's whole definition (SECURITY DEFINER, search_path, body), and who may call it
  select 'function', f.name,
         case when f.prokind in ('f', 'p') then pg_get_functiondef(f.oid) else f.prokind::text end || '|' ||
         (select coalesce(string_agg(g, ',' order by g collate "C"), '-')
            from (select format('%s:%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                                x.privilege_type, x.is_grantable) as g
                    from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) x) a)
    from fn f
  union all
  select 'type', t.name,
         concat_ws('|', t.typtype,
                   (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
                   case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) || '|' || t.typnotnull || '|' ||
                     coalesce((select string_agg(pg_get_constraintdef(k.oid), ',' order by k.conname collate "C")
                                 from pg_constraint k where k.contypid = t.oid), '-') end,
                   case when t.typtype = 'c' then (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
                                                     from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) end,
                   (select coalesce(string_agg(g, ',' order by g collate "C"), '-')
                      from (select format('%s:%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                                          x.privilege_type, x.is_grantable) as g
                              from aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) x) a))
    from typ t
  union all
  -- who may use the two schemas themselves
  select 'schema', n.nspname::text,
         (select coalesce(string_agg(g, ',' order by g collate "C"), '-')
            from (select format('%s:%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                                x.privilege_type, x.is_grantable) as g
                    from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x) a)
    from pg_namespace n where n.nspname in ('public', 'finance')
  union all
  -- what a role's NEW objects will be granted: this is where deny-all is won or lost
  select 'default-acl', pg_get_userbyid(d.defaclrole) || ':' || n.nspname || ':' || d.defaclobjtype::text,
         (select coalesce(string_agg(g, ',' order by g collate "C"), '-')
            from (select format('%s:%s:%s', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
                                x.privilege_type, x.is_grantable) as g
                    from aclexplode(d.defaclacl) x) a)
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname in ('public', 'finance') and pg_get_userbyid(d.defaclrole) <> 'supabase_admin'
  union all
  select 'comment', coalesce(r.name, f.name, t.name, s.nspname::text) || coalesce('.' || nullif(dsc.objsubid, 0)::text, ''),
         dsc.description
    from pg_description dsc
    left join rel r on dsc.classoid = 'pg_class'::regclass and r.oid = dsc.objoid
    left join fn f on dsc.classoid = 'pg_proc'::regclass and f.oid = dsc.objoid
    left join typ t on dsc.classoid = 'pg_type'::regclass and t.oid = dsc.objoid
    left join pg_namespace s on dsc.classoid = 'pg_namespace'::regclass and s.oid = dsc.objoid and s.nspname in ('public', 'finance')
   where coalesce(r.name, f.name, t.name, s.nspname::text) is not null)
select 'catalog', kind, name, md5(coalesce(val, '-'))
  from lines
 order by kind collate "C", name collate "C";
