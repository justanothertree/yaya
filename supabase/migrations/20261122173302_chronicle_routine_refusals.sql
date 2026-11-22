-- ✅ APPLIED to production 22 Nov 2026 at 12:33 PM EST as migration `chronicle_routine_refusals`,
-- version 20261122173302, with Evan's approval of #146 that morning. Production recorded
-- md5(statements[1]) = 8ccde95e681fe0e13808ddd18d8dd4a5, this file's body byte for byte.
-- Check A before it: chronicle_routine_save 295c8b99…, the text this was written against.
-- Check B after: f8a12a73…, anon refused, members allowed. Live, as a member and rolled back,
-- before and after: a step of 99,999,999,999 minutes went from "value … is out of range for
-- type integer" with nothing saved to a saved routine with that step held at 600; a blank name
-- now says "a routine needs a name" and 61 characters "that is longer than a name — 60
-- characters".
-- Why, and the rollback: docs/applied/2026-11-10-chronicle-routine-refusals.DRAFT.sql,
-- docs/2026-11-10-chronicle-routine-refusals-plan.md and its -rollback/ folder.

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