-- ✅ APPLIED to production 14 Nov 2026 as supabase/migrations/20261114121930_card_hides_browsing.sql.
-- That file is the record of what ran. The lines below are this draft's history, true when they
-- were written.
--
-- ⛔ DRAFT — NOT APPLIED. Nothing in this file has run against production.
--
-- Step 2 of docs/2026-11-13-feed-meaningful-moments.md: browsing stays private in its owner's own
-- Chronicle, on the profile card as well as in the Feed. Step 1 is
-- docs/2026-11-13-feed-hides-browsing.DRAFT.sql (#304); this touches none of the functions that
-- does, so the two apply in either order.
--
-- WHAT BROWSING IS. `chronicle_visit` makes one `auto` activity per room of the site and stretches
-- a sitting on it every beat while the room is open. The day log marks those "on the site".
--
-- WHAT IS WRONG. `get_member_chronicle`, the Chronicle card on a profile, never asks whether an
-- activity is `auto`, and it does not consult an activity's sharing level at all -- the card's own
-- level is its only gate. So anybody who can see someone's card is shown their browsing: in the
-- category totals (an auto activity is Free Time), in the top five by name ("Chronicle 3h"), and in
-- "now" if one is running. That is not a leak through sharing; it is every card, whatever the
-- activity is set to.
--
-- WHAT CHANGES. Two functions:
--   get_member_chronicle    each of its three queries over sittings gains
--                           `and (v_target = v_viewer or not a.auto)`: anybody else's view of the
--                           card leaves browsing out, and the owner's own view is as it was
--   chronicle_sharing_mine  the Sharing panel's list of activities gains `and not a.auto`, because
--                           after this and step 1 nothing reads an auto activity's sharing level
--                           any more: a row that offers a choice which changes nothing is a control
--                           that lies. Its "friends can see N" count is built from the same list,
--                           so it stops counting them too.
--
-- WHAT DOES NOT. No table, column or row. An auto activity's stored level is left exactly as it is
-- -- nothing reads it once step 1 and this are applied -- so no data is rewritten and the rollback
-- has nothing to restore but the two functions. Every visit stays in chronicle_entries and in its
-- owner's own readers, and the owner's own card still shows it. Grants survive
-- `create or replace`. `chronicle_activity_set_visibility` still accepts an auto activity, so a
-- file restored by `chronicle_import` and an old tab keep working; what it stores is inert.
--
-- THE READERS, COUNTED RATHER THAN REMEMBERED. Every function that reads chronicle_entries or
-- chronicle_activities was listed from the dump and from every migration since, on 14 Nov. Three
-- answer about somebody other than the caller: chronicle_friends_log and feed_recent (step 1) and
-- get_member_chronicle (this). The rest are scoped to auth.uid(), or are writers.
--
-- ⚠️ BY SUBSTITUTION INTO pg_get_functiondef, the house pattern for a narrow change to a long
-- function, rather than retyping either body. Each anchor must appear exactly as often as it says
-- in a function that has exactly one definition, or the whole migration raises and changes nothing.
-- `get_member_chronicle` has moved since the 4 Nov dump -- 20261110030419_chronicle_repeat_marks_
-- profile rewrote its goal lines -- and these anchors are its sitting lines, which that did not
-- touch. Check A in docs/2026-11-14-card-hides-browsing.checks.sql compares production first.
--
-- ROLLBACK: docs/2026-11-14-card-hides-browsing.ROLLBACK.sql, the same substitutions reversed.
-- TEST:     supabase/tests/card-hides-browsing.sql, on CI's throwaway database (it rolls back), and
--           scripts/card-hides-browsing.test.mjs, which runs the substitutions on the dump's text.

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
