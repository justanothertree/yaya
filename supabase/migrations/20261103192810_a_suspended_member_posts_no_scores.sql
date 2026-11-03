-- ✅ APPLIED 3 Nov 2026 as `a_suspended_member_posts_no_scores`.
--
-- ⚠️ THE ONE THE SWEEP COULD NOT REACH WAS THE ONE THAT MATTERED MOST. `submit_score`
-- has no `auth.uid() is null` guard to anchor to, because it is deliberately ANON-callable: a
-- signed-out player posting to the public leaderboard is the normal case. So the rule-based
-- sweep skipped it -- and a suspended member could keep putting their name on the board
-- everybody reads, which is precisely what suspension is for.
--
-- `coalesce(is_suspended(auth.uid()), false)` is what keeps anon working: `auth.uid()` is null
-- for a signed-out player, `is_suspended(null)` answers null, and null coalesces to false.
--
-- Measured:
--   anon posts a score                 allowed
--   a member in good standing          allowed
--   the same member, suspended         refused -- "your account is suspended"

do $mig$
declare v_src text; v_out text;
begin
  /* ⚠️ `submit_score` WAS THE ONE THE SWEEP COULD NOT REACH AND THE ONE THAT MATTERED MOST.
     It has no `auth.uid() is null` guard to anchor to, because it is deliberately ANON-callable:
     a signed-out player posting to the public leaderboard is the normal case. So the rule-based
     sweep skipped it, and a suspended member could keep putting scores on the board everybody
     reads -- which is exactly the sort of appearing-on-other-people's-screens that suspension
     is for.

     `coalesce(is_suspended(auth.uid()), false)` is what keeps anon working: `auth.uid()` is null
     for a signed-out player, `is_suspended(null)` answers null, and null coalesces to false. A
     suspended member asks about themselves, gets true, and is refused.

     It RAISES rather than returning null, which is this function's idiom for a rejected score.
     "Your account is suspended" is something a person can act on; a silent null looks like the
     game losing your run. The three other writers the sweep could not reach --
     close_park_room, close_profile_room and link_snake_names_to_accounts -- are left alone:
     the first two only close a room of your own, which is a narrowing action like a delete. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'submit_score';
  if v_src is null then raise exception 'submit_score not found'; end if;
  if v_src ~* 'is_suspended' then raise exception 'submit_score is already guarded'; end if;

  v_out := replace(v_src,
    'begin
  if v_name = '''' or p_score is null or p_score <= 0 then',
    'begin
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception ''your account is suspended'';
  end if;

  if v_name = '''' or p_score is null or p_score <= 0 then');
  if v_out = v_src then raise exception 'the opening guard block was not found'; end if;
  if (select count(*) from regexp_matches(v_out, 'is_suspended', 'g')) <> 1 then
    raise exception 'expected exactly one guard';
  end if;
  execute v_out;
end
$mig$;
