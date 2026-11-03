-- ✅ APPLIED 3 Nov 2026 as `certain_friends_get_a_list_per_item`.
--
-- Phase 5 / Part 3: the storage behind Certain friends, and the door that reads it.
--
-- Evan's decision: each item carries its OWN list of chosen friends. Circles are saved shortcuts
-- that pre-fill the picker; editing a circle later never changes who can see an item already
-- shared. Losing the friendship loses the access. An empty list means Only me.
--
-- ⚠️ IT GRANTS NOTHING YET. No reader calls `can_see_item`, so `certain` still
-- reaches nobody but the owner -- the same safe state the circles layer shipped in. The readers
-- come next.
--
-- ⚠️ A SEPARATE `can_see_item` RATHER THAN A WIDER `can_see`, and the alternative is
-- worth recording because it looks tidier and is not. The two-argument `can_see` is called by 12
-- functions and reached by 6 RLS policies through circuit_can_see_person / circuit_can_see_log.
-- Adding defaulted arguments to it makes every existing 2-argument call ambiguous -- Postgres
-- answers "function is not unique" and the site stops -- and dropping it to recreate it breaks
-- those policies for the length of the migration. The old function is untouched and still fails
-- closed on `certain`.
--
-- Measured, the whole matrix, in a rolled-back transaction:
--   the owner                                 true
--   a friend ON the list                      true
--   the same friend, a DIFFERENT item         false   <- per item, not per person
--   the same friend, tier `friends`           true    (control: other tiers still delegate)
--   a non-friend member                       false
--   an EX-friend still on the list            false   <- friendship checked at read time

/* ── where a Certain list lives ──────────────────────────────────────────────────────────────
   One join table for every kind of item, rather than a column on each.

   ⚠️ `item_id` IS TEXT BECAUSE THE ITEM KEYS DISAGREE. circuit_people.id is text,
   player_registry.id is bigint, profile_blocks / chronicle_activities / chronicle_goals are
   uuid, and `profiles.activity_visibility` is keyed on a user_id. A uuid column would have fit
   three of the five and quietly excluded the rest.

   ⚠️ ON DELETE CASCADE REACHES THE PEOPLE AND NOT THE ITEMS. `owner` and `friend` are real
   foreign keys to auth.users, so deleting an account takes its rows with it. `item_id` cannot be
   a foreign key to five different tables, so deleting an ITEM leaves its list behind -- that is
   what the AFTER DELETE triggers below are for. Without them a deleted block's uuid could in
   principle be reused by a later row and inherit a list nobody chose. */
create table if not exists public.visibility_certain (
  owner     uuid not null references auth.users(id) on delete cascade,
  item_kind text not null,
  item_id   text not null,
  friend    uuid not null references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (item_kind, item_id, friend),
  constraint visibility_certain_kind_known check (item_kind in (
    'profile_block', 'chronicle_activity', 'chronicle_goal',
    'circuit_person', 'player_registry', 'profile_activity'
  ))
);

create index if not exists ix_visibility_certain_owner on public.visibility_certain (owner);
create index if not exists ix_visibility_certain_friend on public.visibility_certain (friend);

/* the house pattern: RLS on, zero policies, no grants -- reached only through definer RPCs */
alter table public.visibility_certain enable row level security;
revoke all on table public.visibility_certain from public, anon, authenticated;

/**
 * Does this account own that item?
 *
 * ⚠️ THE ONE PLACE THAT KNOWS WHICH COLUMN HOLDS THE OWNER, and every writer and reader of a
 * Certain list asks it rather than carrying its own copy. Five tables name the owner five ways
 * (`user_id`, `owner`, `owner_user_id`, and `profiles` keys on the user itself), which is exactly
 * the sort of thing that ends up subtly different in the sixth caller.
 *
 * Unknown kind answers false. There is no sensible default for "an item I have never heard of",
 * and false means a list cannot be written against it.
 */
create or replace function public.owns_item(p_kind text, p_id text, p_owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_owner is null or p_id is null then return false; end if;
  case p_kind
    when 'profile_block' then
      return exists (select 1 from public.profile_blocks b
                      where b.id::text = p_id and b.user_id = p_owner);
    when 'chronicle_activity' then
      return exists (select 1 from public.chronicle_activities a
                      where a.id::text = p_id and a.owner = p_owner);
    when 'chronicle_goal' then
      return exists (select 1 from public.chronicle_goals g
                      where g.id::text = p_id and g.owner = p_owner);
    when 'circuit_person' then
      return exists (select 1 from public.circuit_people c
                      where c.id = p_id and c.owner_user_id = p_owner);
    when 'player_registry' then
      return exists (select 1 from public.player_registry r
                      where r.id::text = p_id and r.user_id = p_owner);
    when 'profile_activity' then
      /* the "item" is the member's own activity stream, so the id IS the owner */
      return p_id = p_owner::text;
    else
      return false;
  end case;
exception when others then
  /* a malformed id (a non-uuid where a uuid is expected) is not an ownership claim */
  return false;
end $function$;

revoke all on function public.owns_item(text, text, uuid) from public, anon, authenticated;

/**
 * Can this caller see an item served at `p_tier`?
 *
 * ⚠️ A SEPARATE NAME RATHER THAN A WIDER `can_see`. The two-argument `can_see` is called by 12
 * functions and reached by 6 RLS policies through circuit_can_see_person / circuit_can_see_log.
 * Adding defaulted arguments to it would make every existing 2-argument call ambiguous --
 * Postgres answers "function is not unique" and the site stops -- and dropping and recreating it
 * would break those policies for as long as the migration ran. This leaves that function exactly
 * as it is, still failing closed on `certain`, and adds the item-aware door beside it.
 *
 * ⚠️ `certain` REQUIRES BOTH MEMBERSHIP AND A LIVE FRIENDSHIP. `certain` sits BELOW `friends` on
 * the ladder, so it must never reach somebody `friends` would not. A list row left behind when a
 * friendship ended grants nothing, which is why removing those rows is tidying rather than
 * security -- and why an empty list means Only me, with no special case for it.
 */
create or replace function public.can_see_item(
  p_owner uuid, p_tier public.visibility_tier, p_item_kind text, p_item_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_tier is distinct from 'certain'::public.visibility_tier
      then public.can_see(p_owner, p_tier)
    when auth.uid() is null or p_owner is null then false
    when p_owner = auth.uid() then true
    when p_item_kind is null or p_item_id is null then false
    else coalesce(public.are_friends(auth.uid(), p_owner), false)
         and exists (
           select 1 from public.visibility_certain vc
            where vc.item_kind = p_item_kind
              and vc.item_id = p_item_id
              and vc.friend = auth.uid()
              and vc.owner = p_owner
         )
  end;
$function$;

revoke all on function public.can_see_item(uuid, public.visibility_tier, text, text)
  from public, anon;
grant execute on function public.can_see_item(uuid, public.visibility_tier, text, text)
  to authenticated;
