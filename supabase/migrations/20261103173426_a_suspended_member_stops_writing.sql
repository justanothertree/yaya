-- ✅ APPLIED 3 Nov 2026 as `a_suspended_member_stops_writing`.
--
-- ⚠️ SUSPENSION STOPPED EIGHT TABLES AND NONE OF THESE TEN FUNCTIONS. October's
-- RESTRICTIVE policies cover the circuit tables, and every function here is SECURITY DEFINER --
-- it runs as the OWNER, so a policy on the table underneath never sees the suspended member.
-- A suspended account could still claim a picture, write its alt text, put a library item, claim
-- a snake handle, save a profile page and curate sharing circles.
--
-- Two deliberate absences, both the same argument. `picture_drop` stays open: suspension is for
-- stopping somebody acting on other people's screens, and deleting your own picture only removes
-- something -- blocking it would trap a suspended member with the very thing they may have been
-- suspended for. `picture_ready(p_id, p_owner)` stays open because it is the service-role path
-- the edge function calls after an upload lands, where `auth.uid()` is NULL by construction; a
-- guard there would refuse every upload. That flow is gated in the edge function instead.
--
-- ⚠️ THE ANCHOR IS A REGEX BECAUSE A LITERAL ONE ASSERTED ITS WAY INTO BEING WRONG.
-- The first attempt used the exact phrase `raise exception 'not authenticated'; end if;` and
-- refused to run, naming `claim_snake_name`: it says "You need to be signed in." instead, and
-- its body uses CRLF with the raise on its own line. A literal anchor would have put the guard
-- INSIDE the null check, where it could never run. The assertion is why that was a message
-- rather than a silent half-guard.
--
-- Measured with a suspended fixture and a not-suspended control, eleven functions:
--   ten of them       refused with "your account is suspended" when suspended,
--                     and passed the guard when not
--   picture_drop      allowed in both states, as decided

do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_pat constant text := $re$(is null then\s*raise exception '[^']*';\s*end if;)$re$;
  v_add constant text := $g$\1
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;$g$;
  v_done int := 0;
begin
  /* ⚠️ SUSPENSION STOPPED EIGHT TABLES AND NONE OF THESE FUNCTIONS. The RESTRICTIVE policies
     added in October cover the circuit tables, but every function below is SECURITY DEFINER and
     runs as the owner, so policies underneath never apply to the caller. A suspended account
     could still claim a picture, write its alt text, put a library item, claim a snake handle,
     save a profile page and curate sharing circles.

     ⚠️ `picture_drop` IS DELIBERATELY ABSENT. Suspension exists to stop somebody acting on other
     people's screens; deleting your own picture only removes something. Blocking it would leave
     a suspended member unable to take down the very thing they may have been suspended for,
     which is punishment pointing the wrong way.

     ⚠️ SO IS `picture_ready(p_id, p_owner)`, the two-argument overload: it is the service-role
     path the edge function calls after an upload lands, where `auth.uid()` is NULL by
     construction. A guard there would refuse every upload. That flow is gated in the edge
     function instead.

     ⚠️ AND THE ANCHOR IS A REGEX RATHER THAN A LITERAL, because the first attempt asserted its
     way into finding out why. `claim_snake_name` says "You need to be signed in." rather than
     "not authenticated", and its body uses CRLF with the raise on its own line -- so a literal
     anchor either missed it or would have inserted the guard INSIDE the null check, where it
     would never run. Matching the whole `is null then ... end if;` block and appending after it
     is correct for both wordings and both line endings. */
  for r in
    select unnest(array[
      'picture_claim', 'picture_alt', 'picture_pending', 'library_put',
      'save_my_profile_blocks', 'visibility_circle_save', 'visibility_circle_delete',
      'visibility_circle_set_member', 'visibility_circle_drop_ex_friends', 'claim_snake_name'
    ]) as fn
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn
       and pg_get_function_identity_arguments(p.oid) <> 'p_id uuid, p_owner uuid';

    if v_src is null then raise exception 'function % not found', r.fn; end if;
    if v_src ~* 'is_suspended' then
      raise exception '% already mentions is_suspended; refusing to double-guard it', r.fn;
    end if;

    v_out := regexp_replace(v_src, v_pat, v_add);
    if v_out = v_src then raise exception 'the auth guard was not found in %', r.fn; end if;
    if (select count(*) from regexp_matches(v_out, 'is_suspended', 'g')) <> 1 then
      raise exception 'expected exactly one guard in %, got %', r.fn,
        (select count(*) from regexp_matches(v_out, 'is_suspended', 'g'));
    end if;

    execute v_out;
    v_done := v_done + 1;
  end loop;

  if v_done <> 10 then raise exception 'expected 10 functions, guarded %', v_done; end if;
end
$mig$;
