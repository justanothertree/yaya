-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `feed_finished_matches`, version 20261117004841:
-- md5(statements[1]) = 52e283bb614266093bf587d725a45056, this file's body. The record is
-- supabase/migrations/20261117004841_feed_finished_matches.sql.
--
-- (as drafted) A finished Lab match in the Feed: step 6 of
-- docs/2026-11-14-lab-async-matches-plan.md, and decision 2 of Evan's answers (14 Nov).
--
-- WHAT IT ADDS: one more source in feed_recent's "things made, and comments" block, so a match
-- gets every rule that block already applies to its rows. The person must not be suspended, and
-- feed_may_show (their sharing switch) must be on. The scope must reach them (you and friends,
-- or all members). And there is a cap per person per kind.
--
--   * One row per finished match, and only for a win or a draw: the winner's row in versus (the
--     challenger's for a draw), the challenger's when the two of them beat the computer together.
--     A loss is never posted, and neither is a move, an invitation or a decline.
--   * ⚠️ THE OTHER PLAYER IS NAMED ONLY TO SOMEBODY WHO CAN SEE BOTH: one of the two of them, or a
--     friend of both. Anybody else gets `other` null and the client reads "a friend". A friend of
--     Ann's who is not Bo's would otherwise learn what Bo did, and Bo may not be their friend.
--   * A retired toy (lab_demos.hidden) posts nothing, as a note on it does not.
--
-- NOT in get_member_activity: that one also feeds public pages, which signed-out visitors load,
-- and a match is a thing between friends.
--
-- HOW: the same surgery as 20261114161206_feed_made_and_comments. It reads feed_recent's live
-- definition, asserts the anchor occurs exactly once, inserts the new branch in front of it, and
-- asserts the result carries the branch. A function changed since that migration stops this
-- with an error rather than being edited blind. Privileges are untouched by `create or replace`.
--
-- ROLLBACK: docs/2026-11-16-feed-finished-matches.ROLLBACK.sql. CHECKS: …checks.sql beside it.
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

  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  if v_hits <> 1 then raise exception 'expected 1 of the anchor in feed_recent, found %', v_hits; end if;

  execute replace(v_src, v_old, v_new);

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent'
         and p.prosrc like '%A MATCH BY TURNS, FINISHED%') <> 1 then
    raise exception 'feed_recent does not carry the new branch';
  end if;
end
$mig$;
