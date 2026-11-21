-- ⛔ DRAFT, NOT APPLIED. OPEN-DECISIONS 21a; the plan is docs/2026-11-10-chronicle-21ab-fix-plan.md,
-- and nothing here runs until Evan approves it.
--
-- The day's workout line rounds every number to a whole one. chronicle_moments prints each value
-- with to_char(v, 'FM999999990.##'), and `#` is not a digit in a to_char pattern, so the format has
-- no decimal places at all: 3.5 prints "4", 12.5 "13" and 0.25 "0". It becomes
-- trim_scale(round(v, 2))::text, which prints those as 3.5, 12.5 and 0.25, prints 12 as 12 with no
-- trailing point, and has no fixed digit count to overflow. Measured both ways in CI on 10 Nov;
-- the figures are in the plan.
--
-- One expression in one function changes, and no stored row. It refuses to run unless the live
-- function is the exact text it was written against (md5 ffdfc4c1…, the text CI builds as
-- production's, which step 1 of the plan reads from production itself) and the old expression
-- appears in it exactly once.

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
