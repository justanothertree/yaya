-- ROLLBACK for docs/2026-11-16-feed-finished-matches.DRAFT.sql: takes the match branch back out of
-- feed_recent, by the same surgery the other way round. Nothing is stored by the draft, so nothing
-- is lost: finished matches simply stop appearing in the Feed.
do $mig$
declare
  v_old  constant text := $old$
          ) ev
          join public.profiles p on p.user_id = ev.actor
$old$;
  v_new  constant text := $new$
            union all
            /* ⚠️ A MATCH BY TURNS, FINISHED -- docs/2026-11-16-feed-finished-matches.DRAFT.sql.
               The winner's row (the challenger's for a draw, or for a win together), never a
               loss. The other player is named only to somebody who can see both of them: one of
               the two, or a friend of both. Anybody else reads "a friend". */
            select a.actor,
                   jsonb_build_object('kind', 'match', 'id', m.id::text,
                                      'at', m.finished_at, 'detail', m.demo_id, 'score', null,
                                      'outcome', case when m.result->>'winner' = 'draw' then 'drew'
                                                      when m.mode = 'together' then 'together'
                                                      else 'won' end,
                                      'how', m.result->>'how',
                                      'result', m.result->>'score',
                                      'other', case when a.named
                                                    then coalesce(o.first_name, o.username::text) end,
                                      'other_who', case when a.named then o.username::text end,
                                      'other_mine', o.user_id = v_me)
              from public.lab_matches m
              join public.lab_demos d on d.id = m.demo_id
              cross join lateral (
                select w.actor,
                       case when w.actor = m.player_a then m.player_b else m.player_a end as other
                  from (select case when m.mode = 'versus' and m.result->>'winner' = '1'
                                    then m.player_b else m.player_a end as actor) w
              ) w
              join public.profiles o on o.user_id = w.other
              cross join lateral (
                select w.actor,
                       coalesce(o.suspended, false) = false
                       and (v_me in (m.player_a, m.player_b)
                            or (coalesce(public.are_friends(v_me, m.player_a), false)
                                and coalesce(public.are_friends(v_me, m.player_b), false)))
                         as named
              ) a
             where m.status = 'finished'
               and m.finished_at >= v_from and m.finished_at < v_to
               and not d.hidden
               -- a win or a draw; together, only the two of them beating the computer
               and (m.result->>'winner' = 'draw'
                    or (m.mode = 'versus' and m.result->>'winner' in ('0', '1'))
                    or (m.mode = 'together' and m.result->>'winner' = '0'))
          ) ev
          join public.profiles p on p.user_id = ev.actor
$new$;
  v_src  text;
  v_hits int;
  v_defs int;
begin
  select count(*) into v_defs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';
  if v_defs <> 1 then raise exception 'expected one definition of feed_recent, found %', v_defs; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

  v_hits := (length(v_src) - length(replace(v_src, v_new, ''))) / length(v_new);
  if v_hits <> 1 then raise exception 'expected 1 of the match branch in feed_recent, found %', v_hits; end if;

  execute replace(v_src, v_new, v_old);

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent'
         and p.prosrc like '%A MATCH BY TURNS, FINISHED%') <> 0 then
    raise exception 'feed_recent still carries the match branch';
  end if;
end
$mig$;
