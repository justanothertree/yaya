-- The claim an unready picture was reserved under, so the edge function can compare it against
-- what actually landed in R2. Read-only and additive: nothing calls it until the `ready` op does.
--
-- ⚠️ WHY IT EXISTS. `picture_claim` applies every ceiling — 2 MB a picture, 256 KB a thumbnail,
-- 500 pictures, 50 MB an account — to numbers the browser sends, and the presigned PUT it hands
-- back is signed with `signQuery`, which binds the method, the key and an expiry and NOT a
-- content length. So R2 accepts an object of any size at that key and `picture_ready` flips the
-- row ready without asking the store anything.
--
-- Measured on this database, 28 Oct 2026, inside a rolled-back transaction: a claim of
-- `bytes: 1, thumb_bytes: 1` was accepted and the row went on counting 2 bytes against a
-- 52,428,800-byte ceiling.
--
-- ⚠️ `pictures_mine` could not answer this: it returns READY rows only, and the whole point is
-- the window before a row is ready.
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
           'bytes', bytes, 'thumb_bytes', thumb_bytes, 'ready', ready)
    into v
    from public.member_pictures
   where id = p_id and owner = auth.uid();
  if v is null then raise exception 'no such picture'; end if;
  return v;
end $function$;

-- ⚠️ `revoke … from public` does NOT cover `anon` here — anon holds execute directly.
revoke all on function public.picture_pending(uuid) from public, anon;
grant execute on function public.picture_pending(uuid) to authenticated, service_role;
