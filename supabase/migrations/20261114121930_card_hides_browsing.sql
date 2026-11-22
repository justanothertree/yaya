-- ✅ APPLIED to production 14 Nov 2026 (stamped 20261114121930 in UTC) as migration
-- `card_hides_browsing`, step 2 of the Feed plan (#301), from #312, straight after
-- feed_hides_browsing. Production recorded md5(statements[1]) = 352f2999df5c2a8144f1ae3ae9d3cd97,
-- this file's body byte for byte (supabase/migrations/applied.md5).
--
-- Browsing leaves a profile's Chronicle card for everyone but its owner (get_member_chronicle's
-- totals, top five and "now"), and leaves the owner's Sharing panel (chronicle_sharing_mine). The
-- body is docs/2026-11-14-card-hides-browsing.DRAFT.sql after its leading comment block, which
-- holds the reasoning; its ROLLBACK and read-only checks sit beside it. Before it, check A read
-- `as before the draft` on both functions; after it, `the draft is already applied` with the
-- filter three times and once, and check C showed neither callable by anon. Simulated as one of
-- the owner's friends, the card then named no browsing room, and the owner's panel listed exactly
-- their nine live activities that are not browsing.

do $mig$
declare
  r      record;
  v_src  text;
  v_hits int;
  v_defs int;
  v_done int := 0;
begin
  for r in
    select * from (values
      /* the category totals and the top five: the same two lines open both queries */
      ('get_member_chronicle',
       E'\n     where e.owner = v_target\n       and e.started_at < v_to\n',
       E'\n     where e.owner = v_target\n       and (v_target = v_viewer or not a.auto)\n       and e.started_at < v_to\n', 2),
      /* "now", the sitting running at this moment */
      ('get_member_chronicle',
       E'\n       where e.owner = v_target and e.ended_at is null\n',
       E'\n       where e.owner = v_target and e.ended_at is null\n         and (v_target = v_viewer or not a.auto)\n', 1),
      /* the Sharing panel's list of activities, and so the count built from it */
      ('chronicle_sharing_mine',
       E'\n       where a.owner = auth.uid() and a.archived_at is null), ''[]''::jsonb),\n',
       E'\n       where a.owner = auth.uid() and a.archived_at is null\n         and not a.auto), ''[]''::jsonb),\n', 1)
    ) as v(fn, old, new, want)
  loop
    select count(*) into v_defs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_defs <> 1 then
      raise exception 'expected one definition of %, found %', r.fn, v_defs;
    end if;

    /* read afresh each time round: the second get_member_chronicle row applies to the first's result */
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> r.want then
      raise exception 'expected % of [%] in %, found %', r.want, r.old, r.fn, v_hits;
    end if;

    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 3 then raise exception 'expected 3 substitutions, made %', v_done; end if;

  /* and the result says so: every query over activities in each function carries the filter */
  if (select count(*)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and ((p.proname = 'get_member_chronicle'
               and (length(p.prosrc) - length(replace(p.prosrc, '(v_target = v_viewer or not a.auto)', '')))
                   / length('(v_target = v_viewer or not a.auto)') = 3)
           or (p.proname = 'chronicle_sharing_mine'
               and (length(p.prosrc) - length(replace(p.prosrc, 'and not a.auto', '')))
                   / length('and not a.auto') = 1))) <> 2 then
    raise exception 'the filter is not in both functions as many times as they read activities';
  end if;
end
$mig$;
