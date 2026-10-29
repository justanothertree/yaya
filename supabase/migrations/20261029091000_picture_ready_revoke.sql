-- ✅ APPLIED 29 Oct 2026 as `picture_ready_revoke`.
--
-- Step two of two, and the one that must not run early. Part A8's last step: `picture_ready(uuid)`
-- flipped a row ready and asked the store nothing, and `authenticated` held EXECUTE on it — so
-- every ceiling on the picture feature was applied to a number the browser chose, and anybody
-- writing RPC calls by hand could skip the measurement entirely.
--
-- ⚠️ WHAT MADE THIS DANGEROUS TO APPLY ALONE. The `pictures` edge function builds its Supabase
-- client from the CALLER's Authorization header, deliberately, so `auth.uid()` inside every RPC is
-- the person at the browser. That means it called `picture_ready` as `authenticated` too, and this
-- revoke would have taken the new measured path down along with the old unmeasured one — every
-- upload on the site, including the one that works properly.
--
-- THE ORDER THIS WAS ACTUALLY DONE IN, each step measured rather than assumed:
--
--   1. `SUPABASE_SERVICE_ROLE_KEY` is set on the project. Not readable from a tool session, so it
--      was established from its effect: `refresh-prices` builds its only client from that secret
--      and writes through `upsert_prices`, and `finance.price_cache` holds 179 rows updated inside
--      48 hours. A missing or wrong key cannot produce that — supabase-js throws on an undefined
--      key and the RPC 401s on a bad one.
--
--   2. 20261029090000_picture_ready_as_service.sql — ADDITIVE, so v13 kept working while it
--      landed: `picture_pending` also returns the owner, and a 2-arg `picture_ready(uuid, uuid)`
--      exists, granted to `service_role` and revoked from public, anon and authenticated.
--      Verified: the baseline md5 of `picture_pending` for a real picture is unchanged once the
--      new `owner` key is removed; the 2-arg call as `service_role` flipped a planted unready row
--      to ready, where the same transaction WITHOUT that call read false; a wrong owner raises
--      'no such picture' and a null owner 'no owner given'.
--
--   3. `pictures` deployed as v14, and proved to be the file on disk rather than trusted. An edge
--      deploy sends the whole file inline with no diff to look at, which is how v10 of this very
--      function went live with the literal string PLACEHOLDER as its body. So the deployed module
--      was read back and written out: md5 3af47673c643f633760d31b363123d9b, 23,877 bytes, byte
--      for byte the repository's copy. And it runs: a preflight carrying
--      `Access-Control-Request-Headers: x-yaya-echo-probe-v14-7c1e` came back 204 with that exact
--      string echoed, which is what this file's `corsFor` does and no gateway invents.
--
--   4. The live bundle does not call this function. Checked rather than reasoned about: all 42
--      chunks of evancook.dev were fetched and `picture_ready` appears in NONE of them, while
--      `op:"ready"` appears in the entry chunk. So the site reaches the measured path only, and
--      this revoke cannot break it. What is left is a tab opened before that deploy — 14 members,
--      one of whom has ever kept a picture.
--
-- ⚠️ AND THIS ONE LINE IS THE WHOLE UNDO, which is what bounds the risk of being wrong about any
-- of the above: `grant execute on function public.picture_ready(uuid) to authenticated;` restores
-- the old path in a second. That is not true of the other migrations applied today.

revoke all on function public.picture_ready(uuid) from public, anon, authenticated;

-- Proved afterwards. `picture_ready` reads anon=false authed=false service=true; every other
-- picture function keeps authed=true, because those are the ones a member is supposed to call.
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--     has_function_privilege('anon', p.oid, 'execute') as anon,
--     has_function_privilege('authenticated', p.oid, 'execute') as authed,
--     has_function_privilege('service_role', p.oid, 'execute') as service
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'picture%' order by 1, 2;
do $$
declare v_authed boolean;
begin
  select has_function_privilege('authenticated', p.oid, 'execute') into v_authed
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'picture_ready'
     and pg_get_function_identity_arguments(p.oid) = 'p_id uuid';
  /* ⚠️ `revoke … from public` DOES NOT COVER `anon` IN THIS PROJECT — anon holds execute directly
     on most of this family — and a revoke aimed at a role that does not hold the privilege
     succeeds silently either way. So it is asserted, not assumed. */
  if v_authed is null then raise exception 'picture_ready(uuid) is gone — expected it to exist'; end if;
  if v_authed then raise exception 'picture_ready(uuid) is still callable by authenticated'; end if;
end $$;
