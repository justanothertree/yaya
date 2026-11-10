-- ⛔ DRAFT, NOT APPLIED. Readable refusals for a routine's name, and a step's minutes; the plan is
-- docs/2026-11-10-chronicle-routine-refusals-plan.md, and nothing here runs until Evan approves it.
--
-- Two things, both measured in db guards run 42825583418.
-- chronicle_routine_save let the table refuse a name, so an empty or 61-character one came back as
-- 'new row for relation "chronicle_routines" violates check constraint
-- "chronicle_routines_name_check"'. The form checks only that a name is not empty, and the box
-- has no limit. It now says so in words first.
-- And a step's minutes passed '^[0-9]+$' and were cast to int BEFORE least(…, 600), so eleven
-- digits overflowed: 'value "99999999999" is out of range for type integer'. The form rounds
-- what is typed and sends the digits, so that is reachable by typing. The cast now goes through
-- numeric, which takes any run of digits, so a huge number is held at 600 like 601 already was.
--
-- It refuses to run unless the live function is the exact text it was written against (md5
-- 295c8b99…, the text CI builds as production's, which step 1 of the plan reads from
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
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_routine_save';
  if v_src is null then raise exception 'chronicle_routine_save not found'; end if;
  if md5(v_src) <> '295c8b99f86630a6c75c672a7f2d1dc8' then
    raise exception 'chronicle_routine_save is not the text this was written against (md5 %)', md5(v_src);
  end if;

  for r in
    select * from (values
      ($q$raise exception 'your account is suspended';
  end if;
$q$,
       $q$raise exception 'your account is suspended';
  end if;
  /* ⚠️ SAID IN WORDS BEFORE THE TABLE SAYS IT IN ITS OWN: the name check on chronicle_routines
     refused these with the constraint's name, which the room shows as is */
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'a routine needs a name';
  end if;
  if char_length(btrim(p_name)) > 60 then
    raise exception 'that is longer than a name — 60 characters';
  end if;
$q$),
      ($q$least((s->>'mins')::int, 600)$q$,
       $q$least((s->>'mins')::numeric, 600)::int$q$)
    ) as v(old, new)
  loop
    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in chronicle_routine_save, found %', r.old, v_hits;
    end if;
    v_src := replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then raise exception 'expected 2 substitutions, made %', v_done; end if;

  execute v_src;
end $mig$;
