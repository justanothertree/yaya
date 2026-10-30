-- ✅ APPLIED 30 Oct 2026 as `the_ceiling_does_not_answer_to_members`.
--
-- The Phase 1 helpers answered questions about other people.
--
-- ⚠️ `visibility_ceiling(someone_else)` IS A DISCLOSURE. It returns `public` for an admin,
-- `members` for an established adult and `friends` for everybody else — so pointed at another
-- member it says whether they are an administrator and whether their age has been established.
-- Measured as Cam, with literal uuids: evan came back `public` / admin true, Josh came back
-- `friends` / admin false. Getting somebody's uuid is not the obstacle either; `friendships` is
-- readable by members and is full of them.
--
-- ⚠️ A "ONLY ANSWER FOR THE CALLER" GUARD WOULD HAVE BROKEN PHASE 2, which is why the fix is a
-- revoke rather than a check. `can_see(owner, tier)` runs with `auth.uid()` as the VIEWER while
-- asking about the OWNER's ceiling, so a self-only guard inside `visibility_ceiling` would refuse
-- the single most important call in the ladder. The useful boundary is the GRANT, not the body.
--
-- ⚠️ AND REVOKING COSTS PHASE 2 NOTHING, because a SECURITY DEFINER function runs as its owner
-- and so may call what its caller may not. Proved incidentally by the new `my_visibility_ceiling`:
-- a member who is refused `visibility_ceiling(uuid)` outright gets a correct answer through the
-- DEFINER wrapper in the same session.
--
-- The self-only forms exist because Phase 5's picker will need to ask "what may I choose?" — and
-- they take no argument, so they cannot be pointed at anybody.
--
-- Verified as a member: all three uuid forms answer `permission denied for function …`, while
-- `my_visibility_ceiling()` returns `friends` and `may_i_publish_a_page()` returns false.

revoke execute on function public.visibility_ceiling(uuid) from authenticated;
revoke execute on function public.clamp_visibility(uuid, public.visibility_tier) from authenticated;
revoke execute on function public.may_publish_a_page(uuid) from authenticated;

create or replace function public.my_visibility_ceiling()
returns public.visibility_tier
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.visibility_ceiling(auth.uid());
$function$;

create or replace function public.may_i_publish_a_page()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.may_publish_a_page(auth.uid());
$function$;

comment on function public.my_visibility_ceiling() is
  'The widest level the CALLER may choose. The (uuid) form is not callable by members: asked about somebody else it answers whether they are an admin and whether their age has been established, which is nobody else''s business. This form takes no argument and so cannot be pointed at anybody.';
comment on function public.may_i_publish_a_page() is
  'Whether the CALLER may publish a page. Same reasoning as my_visibility_ceiling.';

revoke all on function public.my_visibility_ceiling() from public, anon;
revoke all on function public.may_i_publish_a_page() from public, anon;
grant execute on function public.my_visibility_ceiling() to authenticated;
grant execute on function public.may_i_publish_a_page() to authenticated;
