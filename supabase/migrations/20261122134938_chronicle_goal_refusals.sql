-- ✅ APPLIED to production 22 Nov 2026 at 8:49 AM EST as migration `chronicle_goal_refusals`,
-- version 20261122134938, with Evan's approval of #145 that morning. Production recorded
-- md5(statements[1]) = ce8acebb030dcbdf2b888dfcc618795d, this file's body byte for byte.
-- Check A before it: chronicle_goal_save 4fadbf34…, the text this was written against.
-- Check B after: 86dc70b2…, anon refused, members allowed. Live, as a member and rolled back:
-- "a goal needs a title", "that is longer than a title — 120 characters", "a target is more than
-- 0 and at most a billion" (for 1,000,000,001 and for 0), "that is longer than a unit — 16
-- characters" and "that is longer than a note — 2000 characters".
-- Why, and the rollback: docs/applied/2026-11-10-chronicle-goal-refusals.DRAFT.sql,
-- docs/2026-11-10-chronicle-goal-refusals-plan.md and its -rollback/ folder.

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