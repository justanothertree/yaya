-- ⛔ DRAFT — NOT APPLIED. Nothing in this file has run against production.
--
-- Step 1 of docs/2026-11-13-feed-meaningful-moments.md, as Evan answered it on 13 Nov 2026:
-- browsing stays private in its owner's own Chronicle, and never reaches the Feed or a friend's
-- Chronicle Friends tab.
--
-- WHAT BROWSING IS. `chronicle_visit` makes one `auto` activity per room of the site, named after
-- the room, and stretches a sitting on it every beat while the room is open. The activity starts
-- at Only me. But neither reader that shows sittings to other people asks whether an activity is
-- `auto`, and the sharing panel lists auto activities beside real ones -- so once one is shared,
-- every visit to that room reaches friends' Feeds, their Friends tabs and the owner's own Feed.
--
-- WHAT CHANGES. Two readers gain `and not a.auto`, in front of the sharing check each already has:
--   chronicle_friends_log  friends' sittings: Chronicle's Friends tab, and the friends' half of
--                          the Feed, which reads this function
--   feed_recent            its own-sittings branch: your sittings in your own Feed
--
-- WHAT DOES NOT. No table, column or row; no stored sharing level. Every visit stays in
-- chronicle_entries and in its owner's own readers -- the day log's "on the site" list among them.
-- Grants survive `create or replace`. `get_member_chronicle`, the profile card, also shows minutes
-- per activity, auto ones included, to whoever can see the card; it is not step 1 and is untouched.
--
-- BROWSING ALREADY IN THE FEED goes the moment this applies: both readers assemble their answer on
-- every call from the entries themselves, and nothing stores a copy.
--
-- ⚠️ BY SUBSTITUTION INTO pg_get_functiondef, the house pattern for a narrow change to a long
-- function, rather than retyping either body. Each anchor must appear exactly once in a function
-- that has exactly one definition, or the whole migration raises and changes nothing. So it cannot
-- quietly apply to a function that has moved on since the 4 Nov dump CI builds from; check A in
-- docs/2026-11-13-feed-hides-browsing.checks.sql compares production with that dump first.
--
-- ROLLBACK: docs/2026-11-13-feed-hides-browsing.ROLLBACK.sql, the same two substitutions reversed.
-- TEST:     supabase/tests/feed-hides-browsing.sql, on CI's throwaway database (it rolls back), and
--           scripts/feed-hides-browsing.test.mjs, which runs the substitutions on the dump's text.

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
