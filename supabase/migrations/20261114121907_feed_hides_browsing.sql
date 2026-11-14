-- ✅ APPLIED to production 14 Nov 2026 (stamped 20261114121907 in UTC) as migration
-- `feed_hides_browsing`, step 1 of the Feed plan (#301), from #304. Production recorded
-- md5(statements[1]) = db6571d09c4a563798985cfd3805a607, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- Browsing, the `auto` activities chronicle_visit keeps for each room of the site, never reaches
-- the Feed or a friend's Chronicle Friends tab: chronicle_friends_log and feed_recent's
-- own-sittings branch gain `and not a.auto`. The body is
-- docs/2026-11-13-feed-hides-browsing.DRAFT.sql after its leading comment block, which holds the
-- reasoning; its ROLLBACK and read-only checks sit beside it. Before it, check A read `as before
-- the draft` on both functions; after it, `the draft is already applied` with the filter once in
-- each, and check C showed neither callable by anon.

do $mig$
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
       E'\n         and public.can_see_item(e.owner, a.visibility,\n',
       E'\n         and not a.auto\n         and public.can_see_item(e.owner, a.visibility,\n', 1),
      ('feed_recent',
       E'\n       and public.item_reaches_anyone(v_me, a.visibility,\n',
       E'\n       and not a.auto\n       and public.item_reaches_anyone(v_me, a.visibility,\n', 1)
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

  /* and the result says so: each reader now carries the filter exactly once */
  if (select count(*)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and p.proname in ('chronicle_friends_log', 'feed_recent')
         and (length(p.prosrc) - length(replace(p.prosrc, 'and not a.auto', '')))
             / length('and not a.auto') = 1) <> 2 then
    raise exception 'the filter is not in both readers exactly once';
  end if;
end
$mig$;
