-- ✅ APPLIED to production 22 Nov 2026 at 8:01 AM EST as migration `chronicle_moments_decimals`,
-- version 20261122130129, with Evan's approval of OPEN-DECISIONS 21a. Production recorded
-- md5(statements[1]) = ad320768c48ce3ccf65993c803e0ed62, this file's body byte for byte.
-- Check A before it: chronicle_moments ffdfc4c1…, the text this was written against, and the
-- 1.2.3 pre-check counted 0. Check B after: chronicle_moments d3d4fcc1…, anon refused, members
-- allowed. Live: a 3.5-mile walk logged on 1 Oct reads "3.5 mi" through it.
-- Why, and the rollback: docs/applied/2026-11-10-chronicle-moments-decimals.DRAFT.sql,
-- docs/2026-11-10-chronicle-21ab-fix-plan.md and docs/2026-11-10-chronicle-21ab-rollback/.

do $mig$
declare
  v_old constant text := $q$trim(to_char((en->>'val')::numeric, 'FM999999990.##'))$q$;
  v_new constant text := $q$trim_scale(round((en->>'val')::numeric, 2))::text$q$;
  v_src text;
  v_hits int;
begin
  if current_setting('server_version_num')::int < 130000 then
    raise exception 'trim_scale needs Postgres 13 or later, and this is %',
      current_setting('server_version');
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_moments';
  if v_src is null then raise exception 'chronicle_moments not found'; end if;
  if md5(v_src) <> 'ffdfc4c1ab852577d1a7e8c24ead8f73' then
    raise exception 'chronicle_moments is not the text this was written against (md5 %)', md5(v_src);
  end if;

  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  if v_hits <> 1 then
    raise exception 'expected 1 of [%] in chronicle_moments, found %', v_old, v_hits;
  end if;

  execute replace(v_src, v_old, v_new);
end $mig$;