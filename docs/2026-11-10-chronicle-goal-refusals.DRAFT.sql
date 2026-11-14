-- ⛔ DRAFT, NOT APPLIED. Readable refusals for a goal's title, target, unit and note; the plan is
-- docs/2026-11-10-chronicle-goal-refusals-plan.md, and nothing here runs until Evan approves it.
--
-- chronicle_goal_save let the table refuse a title, a target, a unit or a note, so the room
-- showed the constraint's own words: a 121-character title came back as 'new row for relation
-- "chronicle_goals" violates check constraint "chronicle_goals_title_check"', and the same
-- sentence for a target above a billion (chronicle_goals_target_check), a 17-character unit
-- (chronicle_goals_unit_check) and a 2001-character note (chronicle_goals_note_check). Measured
-- in db guards run 42825583418. The goal form checks only that a title is not empty and a target
-- is above 0, and none of these boxes has a limit, so all four are reachable by typing. The
-- function now says each in words first. A note it was not sent is still left alone.
--
-- It refuses to run unless the live function is the exact text it was written against (md5
-- 4fadbf34…, the text CI builds as production's, which step 1 of the plan reads from
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
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_goal_save';
  if v_src is null then raise exception 'chronicle_goal_save not found'; end if;
  if md5(v_src) <> '4fadbf346a514f9f36de5fd3d52d823e' then
    raise exception 'chronicle_goal_save is not the text this was written against (md5 %)', md5(v_src);
  end if;

  for r in
    select * from (values
      ($q$raise exception 'your account is suspended';
  end if;
$q$,
       $q$raise exception 'your account is suspended';
  end if;
  /* ⚠️ SAID IN WORDS BEFORE THE TABLE SAYS IT IN ITS OWN: the title, target, unit and note
     checks on chronicle_goals refused these with the constraint's name, which the room shows as
     is. A null note is "leave it alone", so only a note that was sent is measured. */
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'a goal needs a title';
  end if;
  if char_length(btrim(p_title)) > 120 then
    raise exception 'that is longer than a title — 120 characters';
  end if;
  if p_target is not null and (p_target <= 0 or p_target > 1e9) then
    raise exception 'a target is more than 0 and at most a billion';
  end if;
  if char_length(btrim(p_unit)) > 16 then
    raise exception 'that is longer than a unit — 16 characters';
  end if;
  if char_length(btrim(p_note)) > 2000 then
    raise exception 'that is longer than a note — 2000 characters';
  end if;
$q$)
    ) as v(old, new)
  loop
    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in chronicle_goal_save, found %', r.old, v_hits;
    end if;
    v_src := replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 1 then raise exception 'expected 1 substitutions, made %', v_done; end if;

  execute v_src;
end $mig$;
