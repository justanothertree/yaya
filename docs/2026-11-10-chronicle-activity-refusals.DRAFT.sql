-- ⛔ DRAFT, NOT APPLIED. Readable refusals for an activity's name and unit; the plan is
-- docs/2026-11-10-chronicle-activity-refusals-plan.md, and nothing here runs until Evan approves it.
--
-- chronicle_activity_save let the table refuse a name or a unit, so the room showed the
-- constraint's own words: an empty, blank or 61-character name came back as
-- 'new row for relation "chronicle_activities" violates check constraint
-- "chronicle_activities_name_check"', and a 17-character unit as the same sentence about
-- "chronicle_activity_metric_short". Measured in db guards run 42825583418. The add form checks
-- only that a name is not empty, and neither box has a length limit, so both are reachable by
-- typing. The function now says it in words first.
--
-- It refuses to run unless the live function is the exact text it was written against (md5
-- 8ee2ec8d…, the text CI builds as production's, which step 1 of the plan reads from
-- production itself), and unless each piece it replaces appears in it exactly once. No table, row
-- or grant changes.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_activity_save';
  if v_src is null then raise exception 'chronicle_activity_save not found'; end if;
  if md5(v_src) <> '8ee2ec8d4bf532378073214b9d438c74' then
    raise exception 'chronicle_activity_save is not the text this was written against (md5 %)', md5(v_src);
  end if;

  for r in
    select * from (values
      ($q$raise exception 'your account is suspended';
  end if;
$q$,
       $q$raise exception 'your account is suspended';
  end if;
  /* ⚠️ SAID IN WORDS BEFORE THE TABLE SAYS IT IN ITS OWN: the name and unit checks on
     chronicle_activities refused these with the constraint's name, which the room shows as is */
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'an activity needs a name';
  end if;
  if char_length(btrim(p_name)) > 60 then
    raise exception 'that is longer than a name — 60 characters';
  end if;
  if char_length(v_metric) > 16 then
    raise exception 'that is longer than a unit — 16 characters';
  end if;
$q$)
    ) as v(old, new)
  loop
    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in chronicle_activity_save, found %', r.old, v_hits;
    end if;
    v_src := replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 1 then raise exception 'expected 1 substitutions, made %', v_done; end if;

  execute v_src;
end $mig$;
