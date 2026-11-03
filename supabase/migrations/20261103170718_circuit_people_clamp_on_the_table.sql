-- ✅ APPLIED 3 Nov 2026 as `circuit_people_clamp_on_the_table`.
--
-- ⚠️ THE RPC WAS NEVER THE ONLY WAY IN. `set_person_visibility` clamps, and
-- `authenticated` holds INSERT and UPDATE on `circuit_people` with the `visibility` column
-- included and no trigger -- so a hand-sent PATCH wrote the tier directly and skipped the clamp
-- entirely. `circuit_people` was the ONLY tier table in that state; every other one is deny-all,
-- which is why months of looking at FUNCTIONS never found it.
--
-- Proved before it was closed, with a control, because a clamp that refuses everything looks the
-- same as one that works:
--
--   through set_person_visibility, asking `public`   stored `members`   (the ceiling)
--   a direct UPDATE, as a PATCH would                stored `public`    (above the ceiling)
--
-- And after, on an account whose ceiling is `members`:
--
--   direct UPDATE asking `public`         -> members    the hole is closed
--   direct UPDATE asking `friends`        -> friends    (control: not clamping everything)
--   the RPC asking `members`              -> members    (control: still works)
--   an ADMIN-owned row asking `public`    -> public     (control: the ceiling is per owner)
--   that row then un-claimed              -> private
--
-- ⚠️ THAT LAST LINE IS WHY `owner_user_id` IS IN THE TRIGGER'S COLUMN LIST and not
-- just `visibility`. `visibility_ceiling(null)` is `private` by design, and `can_see` answers
-- TRUE unconditionally for tier `public` when the owner is null -- so a row un-claimed WITHOUT
-- its tier being touched would go from owned-and-public to ownerless-and-world-readable. One
-- unclaimed row exists today and is already private, so the clamp is a no-op on current data.

create or replace function public.circuit_person_tier_clamp()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  /* The clamp lives on the TABLE because `set_person_visibility` is not the only way in:
     `authenticated` holds INSERT and UPDATE on circuit_people, column `visibility` included, so
     a hand-sent PATCH writes the tier directly and never meets the RPC. Measured before this
     existed: through the RPC, asking for `public` stored `members`; a direct UPDATE stored
     `public` on an account whose ceiling is `members`.

     SECURITY DEFINER is required rather than tidy. A plain trigger function runs as the CALLING
     role, and `clamp_visibility` is deliberately revoked from `authenticated` (visibility-guards
     check A asserts it), so an invoker-rights trigger would fail with "permission denied for
     function clamp_visibility" on every member write. */
  new.visibility := public.clamp_visibility(new.owner_user_id, new.visibility);
  return new;
end $function$;

revoke all on function public.circuit_person_tier_clamp() from public, anon, authenticated;

/* ⚠️ `owner_user_id` IS IN THE COLUMN LIST, not only `visibility`, and leaving it out would
   leave the hole half open. `visibility_ceiling(null)` is `private` by design, and `can_see`
   answers TRUE unconditionally for tier `public` when the owner is null -- so a row that is
   un-claimed without its tier being touched would go from owned-and-public to ownerless-and-
   public, which is world-readable. Firing on either column closes that. */
drop trigger if exists circuit_people_tier_clamp on public.circuit_people;
create trigger circuit_people_tier_clamp
  before insert or update of visibility, owner_user_id on public.circuit_people
  for each row execute function public.circuit_person_tier_clamp();
