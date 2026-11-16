-- ROLLBACK for docs/2026-11-14-card-hides-browsing.DRAFT.sql. ⛔ Not applied, like the draft.
--
-- The draft's three substitutions with old and new swapped, so it takes the filter back out of
-- `get_member_chronicle` and `chronicle_sharing_mine` and leaves each body byte for byte as it was
-- before the draft. Nothing else was changed, so nothing else needs restoring: the draft touched no
-- table, column, row or grant.
--
-- Like the draft it raises, changing nothing, unless each anchor is found exactly as often as it
-- says. Afterwards, check A of docs/2026-11-14-card-hides-browsing.checks.sql should read
-- 'as before the draft' on both rows.

do $rollback$
declare
  r      record;
  v_src  text;
  v_hits int;
  v_defs int;
  v_done int := 0;
begin
  for r in
    select * from (values
      ('get_member_chronicle',
       E'\n     where e.owner = v_target\n       and (v_target = v_viewer or not a.auto)\n       and e.started_at < v_to\n',
       E'\n     where e.owner = v_target\n       and e.started_at < v_to\n', 2),
      ('get_member_chronicle',
       E'\n       where e.owner = v_target and e.ended_at is null\n         and (v_target = v_viewer or not a.auto)\n',
       E'\n       where e.owner = v_target and e.ended_at is null\n', 1),
      ('chronicle_sharing_mine',
       E'\n       where a.owner = auth.uid() and a.archived_at is null\n         and not a.auto), ''[]''::jsonb),\n',
       E'\n       where a.owner = auth.uid() and a.archived_at is null), ''[]''::jsonb),\n', 1)
    ) as v(fn, old, new, want)
  loop
    select count(*) into v_defs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_defs <> 1 then
      raise exception 'expected one definition of %, found %', r.fn, v_defs;
    end if;

    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> r.want then
      raise exception 'expected % of [%] in %, found %', r.want, r.old, r.fn, v_hits;
    end if;

    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 3 then raise exception 'expected 3 substitutions, made %', v_done; end if;

  /* and the result says so: neither function mentions `a.auto` any more */
  if exists (select 1
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f'
                and p.proname in ('get_member_chronicle', 'chronicle_sharing_mine')
                and p.prosrc like '%a.auto%') then
    raise exception 'a function still mentions a.auto after the rollback';
  end if;
end
$rollback$;
