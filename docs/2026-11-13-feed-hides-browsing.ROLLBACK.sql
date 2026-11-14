-- ROLLBACK for docs/2026-11-13-feed-hides-browsing.DRAFT.sql — only after that draft is applied.
--
-- It removes `and not a.auto` from the same two readers, by the same two substitutions in reverse,
-- so each function's text returns to exactly what it was. Nothing else was changed by the draft,
-- so nothing else needs undoing: no table, row or grant.
--
-- After it runs, browsing on an auto activity somebody has shared reaches the Feed and the Friends
-- tab again, as it does today. Check C in docs/2026-11-13-feed-hides-browsing.checks.sql confirms
-- each function's md5 is back to its value before the draft.
--
-- Like the draft, it raises and changes nothing unless each anchor is found exactly once in a
-- function with exactly one definition.

do $rollback$
declare
  r      record;
  v_src  text;
  v_out  text;
  v_hits int;
  v_defs int;
  v_done int := 0;
begin
  for r in
    select * from (values
      ('chronicle_friends_log',
       E'\n         and not a.auto\n         and public.can_see_item(e.owner, a.visibility,\n',
       E'\n         and public.can_see_item(e.owner, a.visibility,\n', 1),
      ('feed_recent',
       E'\n       and not a.auto\n       and public.item_reaches_anyone(v_me, a.visibility,\n',
       E'\n       and public.item_reaches_anyone(v_me, a.visibility,\n', 1)
    ) as v(fn, old, new, want)
  loop
    select count(*) into v_defs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_defs <> 1 then
      raise exception 'expected one definition of %, found %', r.fn, v_defs;
    end if;

    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> r.want then
      raise exception 'expected % of [%] in %, found %', r.want, r.old, r.fn, v_hits;
    end if;

    v_out := replace(v_src, r.old, r.new);
    execute v_out;
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then raise exception 'expected 2 substitutions, made %', v_done; end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('chronicle_friends_log', 'feed_recent')
       and p.prosrc like '%and not a.auto%'
  ) then
    raise exception 'the filter is still in a reader';
  end if;
end
$rollback$;
