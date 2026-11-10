-- ✅ APPLIED to production 9 Nov 2026 (stamped 20261110030419 in UTC) as migration
-- `chronicle_repeat_marks_profile`, step 8 of the Chronicle release,
-- docs/2026-11-09-chronicle-release-plan.md, after the room deployed (#101). Production recorded
-- md5(statements[1]) = a67fb66b2ba23fd3526ab10dbbc0888b, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- 17d step 3: a friend's view of a profile counts a repeating goal by its current window.
-- The body is docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql after its leading comment
-- block. After it, check E (get_member_chronicle as C7 left it) and check D (nothing open) held.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
  v_now constant text :=
    E'exists (select 1 from public.chronicle_goal_marks mk\n'
    || E'                      where mk.goal = %1$s.id and mk.scope = %1$s.scope\n'
    || E'                        and mk.done_at is not null\n'
    || E'                        and mk.starts_at <= now() and mk.ends_at > now())';
begin
  for r in
    select * from (values
      ('(gl.done_at is not null) as done,',
       '(case when gl.repeat_every is null then gl.done_at is not null'
       || E'\n                  else ' || format(v_now, 'gl') || E' end) as done,'),
      (E'count(*) filter (where g.done_at is not null and g.done_at >= v_from),\n'
       || E'         count(*) filter (where g.done_at is null)',
       E'count(*) filter (where case when g.repeat_every is null\n'
       || E'                                then g.done_at is not null and g.done_at >= v_from\n'
       || E'                                else ' || format(v_now, 'g') || E' end),\n'
       || E'         count(*) filter (where case when g.repeat_every is null\n'
       || E'                                then g.done_at is null\n'
       || E'                                else not ' || format(v_now, 'g') || E' end)')
    ) as v(old, new)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'get_member_chronicle';
    if v_src is null then raise exception 'get_member_chronicle not found'; end if;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in get_member_chronicle, found %', r.old, v_hits;
    end if;

    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then raise exception 'expected 2 substitutions, made %', v_done; end if;
end $mig$;
