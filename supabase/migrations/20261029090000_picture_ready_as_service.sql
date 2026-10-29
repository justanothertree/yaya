-- ✅ APPLIED 29 Oct 2026 as `picture_ready_as_service`.
--
-- Step one of two for Part A8's last step. This file is ADDITIVE ON PURPOSE: with it applied the
-- `pictures` function at v13 keeps working unchanged, so there is no window in which an upload is
-- broken. The revoke that closes the hole is a separate file, applied after the new code is live
-- and read back — see 20261029091000_picture_ready_revoke.sql.
--
-- WHAT THE HOLE IS. `picture_ready(uuid)` sets `ready = true` and asks the store nothing, and it
-- is granted to `authenticated`. Every ceiling in `picture_claim` — 2 MB a picture, 256 KB a
-- thumbnail, 50 MB an account — is applied to `p_bytes` sent from the page, and `signQuery` binds
-- the method, the key and an expiry but NOT a content length, so R2 accepts an object of any size
-- at that key. Measured on this database in a rolled-back transaction: a claim of 1 byte + 1 byte
-- was accepted, the row read `bytes=1 thumb_bytes=1 ready=true`, and the 50 MB ceiling counted
-- two bytes for it.
--
-- `pictures` v13 closed that for the site's own path — it HEADs both objects and compares what
-- arrived against what was claimed (docs/2026-10-28-picture-size-is-measured.md) — but anybody
-- writing RPC calls by hand could still skip it. The lock is to take `picture_ready` away from
-- `authenticated` entirely, which means the edge function has to stop calling it as the caller.
--
-- ⚠️ AND THAT IS WHY THE OWNER BECOMES AN ARGUMENT RATHER THAN A LOOKUP. Under `service_role`
-- there is no `auth.uid()`, so the 1-arg function cannot be reused as it stands. The owner is
-- taken from the row `picture_pending` already returned — which proved `owner = auth.uid()` in
-- Postgres before the edge function saw it — so ownership is still decided by the database and
-- not by the file holding the service key. CLAUDE.md §3: what may be written stays one question
-- answered in one place.

-- ─── 1. `picture_pending` also says who owns it ────────────────────────────────────────────
--
-- Additive: five keys become six. It is already gated on `owner = auth.uid()`, so this echoes the
-- caller's own id back to them and widens nothing.
--
-- Baseline before this ran, in a simulated session for a real picture:
--   md5  ece9a19874df8a504fa40fa556d38992
--   keys key, bytes, ready, thumb_key, thumb_bytes
create or replace function public.picture_pending(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* ⚠️ ONE SENTENCE FOR BOTH REFUSALS. A picture somebody else owns and a picture that was never
     minted must answer identically, or the id space becomes a way to ask whether a given picture
     exists — the same property get_public_profile and sendPasswordReset are built around. */
  select jsonb_build_object(
           'key', key, 'thumb_key', thumb_key,
           'bytes', bytes, 'thumb_bytes', thumb_bytes, 'ready', ready,
           /* the owner, so the finishing call can be made as service_role without a session */
           'owner', owner)
    into v
    from public.member_pictures
   where id = p_id and owner = auth.uid();
  if v is null then raise exception 'no such picture'; end if;
  return v;
end $function$;

-- ─── 2. A finishing call that does not need a session ──────────────────────────────────────
create or replace function public.picture_ready(p_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  /* ⚠️ NOT A DEFAULT AND NOT A COALESCE. A null owner here would widen the update to "any picture
     with this id", which is every picture with this id — the one thing the 1-arg version's
     `owner = auth.uid()` was doing. A missing owner is a bug in the caller, so it says so. */
  if p_owner is null then raise exception 'no owner given'; end if;
  update public.member_pictures set ready = true where id = p_id and owner = p_owner;
  /* the same sentence as every other refusal in this family: see picture_pending's note */
  if not found then raise exception 'no such picture'; end if;
end $function$;

-- §3: a new function is EXECUTE to PUBLIC until told otherwise, and `revoke … from public` does
-- not cover `anon` in this project — `anon` holds execute directly on most of these. Both named.
revoke all on function public.picture_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.picture_ready(uuid, uuid) to service_role;

do $$
declare v_authed boolean; v_anon boolean; v_service boolean;
begin
  select has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    into v_authed, v_anon, v_service
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'picture_ready'
     and pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_owner uuid';
  /* ⚠️ ASSERTED RATHER THAN ASSUMED. A grant aimed at a role that does not hold what you think
     it holds succeeds silently, which is how `anon` kept execute on 13 things for a month. */
  if v_authed or v_anon or not v_service then
    raise exception 'picture_ready(uuid,uuid) grants are wrong: authed=% anon=% service=%',
      v_authed, v_anon, v_service;
  end if;
end $$;
