-- ✅ APPLIED 3 Nov 2026 as `correct_what_an_invite_could_overwrite`.
--
-- A one-sentence correction to the comment inside `complete_member_signup`, applied as a
-- substitution so nothing else about the function can move.
--
-- ⚠️ IT SAID AN ADMIN COULD BE DEMOTED BY CLICKING A LINK. Checked afterwards rather
-- than before, which is the mistake: `is_admin()` reads `admin_users`, and `user_roles` holds
-- only 'family' and 'friend', so adminhood was never reachable through an invite at all. The bug
-- the sentence was attached to is real and the fix is unchanged -- `username`, `first_name` and
-- the family/friend class were all overwritten -- but a reader who believed the comment would go
-- hunting for a privilege-escalation path that does not exist.
--
-- A comment that overstates is a false claim like any other. It is cheaper to correct than to
-- leave, and the cost of leaving it is somebody's afternoon.

do $mig$
declare
  v_src text;
  v_out text;
  v_old constant text := 'For an admin opening a `member` invite that is a demotion, performed by clicking a link.';
  v_new constant text := 'Checked rather than assumed: `is_admin()` reads `admin_users`, not `user_roles`, so adminhood survived -- what did not was your name and your class.';
begin
  /* A COMMENT THAT OVERSTATES IS STILL A FALSE CLAIM, and this one was mine, written an hour
     ago. It said an admin opening a `member` invite would be demoted by clicking a link.
     `is_admin()` reads `admin_users` and `user_roles` holds only 'family' and 'friend', so
     adminhood was never reachable that way. The bug the sentence was attached to is real --
     `username`, `first_name` and the family/friend class were all overwritten from the form and
     the invite -- and the fix is unchanged. Only the severity was wrong, and a reader who
     believed it would go looking for a privilege-escalation path that does not exist. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'complete_member_signup';
  if v_src is null then raise exception 'complete_member_signup not found'; end if;
  if position(v_old in v_src) = 0 then raise exception 'the sentence to correct is not there'; end if;
  v_out := replace(v_src, v_old, v_new);
  if v_out = v_src then raise exception 'substitution did not apply'; end if;
  execute v_out;
end
$mig$;
