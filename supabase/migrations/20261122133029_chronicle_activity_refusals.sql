-- ✅ APPLIED to production 22 Nov 2026 at 8:30 AM EST as migration `chronicle_activity_refusals`,
-- version 20261122133029, with Evan's approval of #144 that morning. Production recorded
-- md5(statements[1]) = 8842eea9496342229401a20a48c97591, this file's body byte for byte.
-- Check A before it: chronicle_activity_save 8ee2ec8d…, the text this was written against.
-- Check B after: 91d49b2b…, anon refused, members allowed. Live, as a member and rolled back:
-- a blank or all-space name says "an activity needs a name" (with an unknown id too), 61
-- characters "that is longer than a name — 60 characters", a 17-character unit "that is longer
-- than a unit — 16 characters".
-- Why, and the rollback: docs/applied/2026-11-10-chronicle-activity-refusals.DRAFT.sql,
-- docs/2026-11-10-chronicle-activity-refusals-plan.md and its -rollback/ folder.

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