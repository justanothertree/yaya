-- ✅ APPLIED 3 Nov 2026 as `suspension_reaches_the_rest_of_the_writers`.
--
-- ⚠️ THE FIRST SWEEP WAS A LIST, AND A LIST IS WHAT MISSED THESE. Ten functions were
-- guarded earlier the same day by naming them. These seven were not on the paper: a guestbook
-- note, two chronicle notes, a whole chronicle restore, and all three visibility setters -- so a
-- suspended member could still write on somebody else's page and rearrange who sees what.
--
-- ⚠️ AND THERE IS NO STANDING CHECK FOR THIS, which is worth saying rather than
-- hiding. `visibility-guards.sql` can ask the catalogue which functions write a tier without
-- clamping, because that is a question about SQL text. "Which functions are writes that need a
-- suspension guard" is not a question the catalogue answers, so this list is maintained by hand
-- and will go stale again.
--
-- Measured with a suspended fixture and a not-suspended control: all seven refuse with "your
-- account is suspended" when suspended, and pass the guard when not.

do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_pat constant text := $re$(is null then\s*raise exception '[^']*';\s*end if;)$re$;
  v_add constant text := $g$\1
  /* suspension reaches SECURITY DEFINER functions only here -- see the 3 Nov migration that
     guarded the first ten. These seven were missed because they are not pictures, library or
     circles: a guestbook note, two chronicle notes, a whole chronicle restore, and the three
     visibility setters. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;$g$;
  v_done int := 0;
begin
  /* ⚠️ THE FIRST SWEEP WAS A LIST, AND A LIST IS WHAT MISSED THESE. Ten functions were guarded
     on 3 Nov by naming them; these seven were not on the piece of paper. Two of them are the
     loudest writers on the site -- `post_profile_note` puts your words on somebody else's page,
     and `chronicle_import` writes a whole chronicle -- and three are the visibility setters,
     where a suspended member could still have been rearranging who sees what.

     The standing check in visibility-guards.sql asks the schema which functions write a tier
     without clamping; there is no equivalent asking which writers lack a suspension guard,
     because "is this a write" is not a question the catalogue answers. That is worth knowing
     rather than papering over: this list is maintained by hand and will go stale again. */
  for r in
    select unnest(array[
      'post_profile_note', 'chronicle_note_add', 'chronicle_note_edit', 'chronicle_import',
      'set_my_activity_visibility', 'set_my_snake_visibility', 'set_person_visibility'
    ]) as fn
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;

    if v_src is null then raise exception 'function % not found', r.fn; end if;
    if v_src ~* 'is_suspended' then
      raise exception '% already mentions is_suspended; refusing to double-guard it', r.fn;
    end if;

    v_out := regexp_replace(v_src, v_pat, v_add);
    if v_out = v_src then raise exception 'the auth guard was not found in %', r.fn; end if;
    if (select count(*) from regexp_matches(v_out, 'is_suspended', 'g')) <> 1 then
      raise exception 'expected exactly one guard in %, got %', r.fn,
        (select count(*) from regexp_matches(v_out, 'is_suspended', 'g'));
    end if;

    execute v_out;
    v_done := v_done + 1;
  end loop;

  if v_done <> 7 then raise exception 'expected 7 functions, guarded %', v_done; end if;
end
$mig$;
