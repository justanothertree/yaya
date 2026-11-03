-- ✅ APPLIED 3 Nov 2026 as `a_pool_option_belongs_to_whoever_added_it`.
--
-- ⚠️ A READ TEST WAS STANDING IN FOR A WRITE PERMISSION. `circuit_watchlist_delete`
-- was `pool_visible(pool_id)` -- so in a pool shared with friends, any of them could delete the
-- options the others had added, and the person who added one had no more claim on it than
-- anybody else.
--
-- ⚠️ AND THE TABLE DID NOT RECORD WHO ADDED ANYTHING. There was no `added_by`; a row
-- carried a title, a pool and some votes. "Only the adder" was not a rule the schema could
-- express, which is why this is a column before it is a policy.
--
-- Stamped by a trigger, never by the client: the browser writes these rows directly through the
-- adapter's upsert, so a client-supplied `added_by` would be a claim rather than a fact. The
-- trigger also pins it on UPDATE, or editing a title would be a way to take ownership of
-- somebody else's option.
--
-- A legacy row has no adder and falls to the pool's owner or an admin. That is the fail-closed
-- reading of null; treating "unknown adder" as "anybody may delete" is the behaviour being
-- removed.
--
-- Measured in a rolled-back transaction:
--   added_by stamped by the trigger        true
--   another member deletes the option      refused, the row survives
--   the adder deletes it                   deleted            (control)

/* ⚠️ ANYBODY WHO COULD SEE A POOL COULD DELETE ANYTHING IN IT. `circuit_watchlist_delete` was
   `pool_visible(pool_id)`, which is a READ test standing in for a write permission -- so in a
   pool shared with friends, any one of them could remove the options the others had added, and
   the person who added one had no more claim on it than anybody else.

   ⚠️ AND THE TABLE DID NOT RECORD WHO ADDED ANYTHING, which is why this is a column and not just
   a policy. There was no `added_by`; the row carried a title, a pool and some votes. "Only the
   adder" was not a rule the schema could express.

   Stamped by a TRIGGER rather than by the client. The browser writes these rows directly through
   the adapter's upsert, so a client-supplied `added_by` would be a claim rather than a fact --
   the same reasoning the relay's auth note gives about never taking a userId from a message. */
alter table public.circuit_watchlist
  add column if not exists added_by uuid references auth.users(id) on delete set null;

create or replace function public.watchlist_stamp_adder()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  /* on INSERT it is always the caller; on UPDATE it is never allowed to move, or editing a
     title would be a way to take ownership of somebody else's option */
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
  else
    new.added_by := old.added_by;
  end if;
  return new;
end $function$;

revoke all on function public.watchlist_stamp_adder() from public, anon, authenticated;

drop trigger if exists circuit_watchlist_stamp_adder on public.circuit_watchlist;
create trigger circuit_watchlist_stamp_adder
  before insert or update on public.circuit_watchlist
  for each row execute function public.watchlist_stamp_adder();

/* ⚠️ A LEGACY ROW HAS NO ADDER, AND FALLS TO THE POOL'S OWNER. Every row that existed before
   this migration has `added_by` null, and null is not a match for anybody -- so those options
   can be removed by the pool's owner or an admin and nobody else. That is the fail-closed
   reading: the alternative, treating "unknown adder" as "anybody may delete", is the behaviour
   this migration exists to remove.

   The non-pool branch is unchanged. An option with no pool belongs to a circuit group, and group
   membership is that model's own rule; Evan's instruction was about pools. */
drop policy if exists circuit_watchlist_delete on public.circuit_watchlist;
create policy circuit_watchlist_delete on public.circuit_watchlist
  for delete to authenticated
  using (
    added_by = auth.uid()
    or (pool_id is not null and exists (
          select 1 from public.pools p
           where p.id = circuit_watchlist.pool_id and p.owner_user_id = auth.uid()))
    or (pool_id is null and public.circuit_is_member(group_id))
    or public.is_admin()
  );
