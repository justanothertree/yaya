-- ✅ APPLIED 3 Nov 2026 as `snake_activity_honours_the_handle_tier`.
--
-- ⚠️ `player_registry.visibility` HAD ONE READER AND NEEDED THREE, and the setting
-- said the opposite of what happened. `snake_friend_names` asks
-- `can_see(r.user_id, r.visibility)` before putting a member's name beside a handle. The two
-- snake branches of `get_member_activity` join the same table by `r.user_id = v_target` and
-- never looked at the column -- so a member set to `private` ("your scores show under the handle
-- you typed, and nobody learns it's you") had those scores on their profile under their name,
-- and carried into the feed.
--
-- THE MATRIX MOVES, and this is the change that moves it:
--
--   before   196 cells / 539 blocks / 7,118 activity / 130 trophies
--            md5 8e163d91a6925025e270416c6d387718
--   after    196 cells / 539 blocks / 6,945 activity / 130 trophies
--            md5 b89fc62c856482e4e5b248651da62fa0
--
-- -173 activity events. Five members have snake events and a `friends` handle tier (8, 5, 4, 2
-- and 1 events each); those are now hidden from the 12 viewers who are not their friends.
--
-- ⚠️ THE ARITHMETIC SAYS 240 AND THE ANSWER IS 173, which is the 200-per-cell cap
-- doing exactly what `visibility-matrix.sql` warns it does. 28 of the 49 non-empty cells sit at
-- the cap, so hiding a snake event there simply lets another event take its place and the
-- visible count does not move. The totals are a floor, not a census.
--
-- Trophies are unchanged at 130 because `get_member_trophies` is a different function; only the
-- trophy branch INSIDE get_member_activity was gated.

do $mig$
declare v_src text; v_out text; v_hits int;
begin
  /* ⚠️ `player_registry.visibility` HAD ONE READER AND NEEDED THREE. `snake_friend_names` asks
     `can_see(r.user_id, r.visibility)` before putting a member's name beside a handle, which is
     exactly right. The two snake branches of `get_member_activity` join the same table by
     `r.user_id = v_target` and never look at the column at all -- so a member whose snake
     visibility is `private` ("your scores show under the handle you typed, and nobody learns
     it's you") still had those scores listed on their profile, under their name, and carried
     into the feed by `feed_recent`.

     The setting was not merely ignored; it said the opposite of what happened. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'get_member_activity';
  if v_src is null then raise exception 'get_member_activity not found'; end if;

  v_out := replace(v_src,
    'from public.score_history sh
          join public.player_registry r on r.id = sh.player_id
          where r.user_id = v_target',
    'from public.score_history sh
          join public.player_registry r on r.id = sh.player_id
          where r.user_id = v_target
            and public.can_see(r.user_id, r.visibility)');
  if v_out = v_src then raise exception 'the snake_score branch was not found'; end if;
  v_src := v_out;

  v_out := replace(v_src,
    'join public.player_registry r on r.id = lb.player_id
          where r.user_id = v_target',
    'join public.player_registry r on r.id = lb.player_id
          where r.user_id = v_target
            and public.can_see(r.user_id, r.visibility)');
  if v_out = v_src then raise exception 'the snake_trophy branch was not found'; end if;

  v_hits := (select count(*) from regexp_matches(v_out, 'can_see\(r\.user_id, r\.visibility\)', 'g'));
  if v_hits <> 2 then raise exception 'expected the tier check twice, found %', v_hits; end if;

  execute v_out;
end
$mig$;

/* and the straggler: every other definer function here names pg_temp */
alter function public.snake_friend_names() set search_path to 'public', 'pg_temp';
alter function public.snake_display_name(uuid) set search_path to 'public', 'pg_temp';
