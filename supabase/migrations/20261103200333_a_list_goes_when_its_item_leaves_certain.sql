-- ✅ APPLIED 3 Nov 2026 as `a_list_goes_when_its_item_leaves_certain`.
--
-- ⚠️ THIS FILE NO LONGER md5-MATCHES `schema_migrations`, ON PURPOSE.
-- Six `drop trigger if exists` lines were added on 4 Nov, one above each `create trigger`, so the
-- file can be replayed onto a database that already has them — which is what `supabase db reset`
-- does in CI once a schema baseline exists, and what `docs/ci/db-guards.yml` is for. A bare
-- `create trigger` against an existing trigger is an error rather than a no-op, and these six
-- were the only unguarded statements left in the whole directory.
--
-- What ran in production is the version WITHOUT those six lines:
--   version 20261103200333 · md5 fcc233bc07d4e735cd2f15353c0b833c · 4,212 characters
-- The added lines are drops of triggers this same file then creates, so replaying the new text
-- against production would end in exactly the state the old text left. Nothing else changed.
--
-- ⚠️ CORRECTED 4 Nov: "and alone among the 79" is what this line said, and it was wrong when it
-- was written. The md5 check built the next day measured ELEVEN divergent files — three with
-- re-run guards added after the fact, including this one, and eight from before the body-md5
-- protocol existed. `supabase/migrations/applied.md5` has the list and pins each one. The
-- convention is the rule in CLAUDE.md §4, not a claim about this directory's history.
--
-- Editing these header lines is itself the demonstration: the body rule strips the contiguous
-- `--` lines at the top, so this correction does not move the md5 this file is pinned at.
--
-- ⚠️ A LIST LEFT BEHIND IS AN AUDIENCE THAT LETS ITSELF BACK IN. The delete triggers
-- clear an item's list when the ROW goes, which was the whole rule while nothing could change
-- tier. It can now: move an activity Certain -> Friends and the list sits there granting nothing,
-- until the day its owner picks Certain again and three people chosen weeks ago are let back in
-- without anybody choosing them.
--
-- `save_my_profile_blocks` already refuses to keep a list on a block that is not `certain` --
-- Evan's rule from 3 Nov -- and this generalises it to the five kinds whose tier moves by UPDATE
-- rather than by delete-and-reinsert. Fail-closed is the deliberate half: the owner who goes
-- Certain -> Friends -> Certain has to pick again, which is a small cost against a silent grant.
--
-- Six triggers, and the migration asserts there are eleven in all (five for a row going, six for
-- a tier leaving) rather than trusting that the list below is complete.
--
-- Measured, with two null controls:
--   activity at certain, one on the list       1 row
--   set to certain AGAIN                       1 row    <- null control
--   renamed, tier untouched                    1 row    <- null control
--   certain -> friends                         0
--   circuit person, certain -> private         0
--   profiles.activity_visibility -> members    0
--   the row deleted outright                   0        (the older trigger, still doing its job)

/* ⚠️ A LIST LEFT BEHIND IS AN AUDIENCE THAT COMES BACK ON ITS OWN. `visibility_certain_forget`
   clears an item's list when the ROW goes, which was the whole rule while nothing could change
   tier. It can now: move an activity from Certain to Friends and the list sits there, granting
   nothing -- until the day the owner picks Certain again, at which point three people who were
   chosen weeks ago are let back in without anybody choosing them.

   `save_my_profile_blocks` already refuses to keep a list on a block that is not `certain`, which
   is the rule Evan asked for on 3 Nov. This generalises it to the other five kinds, where the
   tier moves by UPDATE rather than by delete-and-reinsert.

   Fail-closed is the deliberate half of this. The owner who goes Certain -> Friends -> Certain
   has to pick again, which is a small cost; the alternative is a silent grant, which is the thing
   the whole ladder exists to prevent. */
create or replace function public.visibility_certain_forget_on_leaving()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /* The kind, the id column and the tier column come in as arguments, because `profiles` keys its
     list on `user_id` and calls the tier `activity_visibility` while the other four use `id` and
     `visibility`. `to_jsonb(new) ->> name` is how a trigger reads a column it is told about
     rather than one it was compiled against. */
  if (to_jsonb(new) ->> coalesce(tg_argv[2], 'visibility'))
       is distinct from 'certain' then
    delete from public.visibility_certain
     where item_kind = tg_argv[0]
       and item_id = to_jsonb(new) ->> coalesce(tg_argv[1], 'id');
  end if;
  return null;
end
$$;

revoke all on function public.visibility_certain_forget_on_leaving() from public, anon, authenticated;

drop trigger if exists chronicle_activities_drop_certain on public.chronicle_activities;
create trigger chronicle_activities_drop_certain
  after update of visibility on public.chronicle_activities
  for each row execute function
  public.visibility_certain_forget_on_leaving('chronicle_activity', 'id', 'visibility');

drop trigger if exists chronicle_goals_drop_certain on public.chronicle_goals;
create trigger chronicle_goals_drop_certain
  after update of visibility on public.chronicle_goals
  for each row execute function
  public.visibility_certain_forget_on_leaving('chronicle_goal', 'id', 'visibility');

drop trigger if exists circuit_people_drop_certain on public.circuit_people;
create trigger circuit_people_drop_certain
  after update of visibility on public.circuit_people
  for each row execute function
  public.visibility_certain_forget_on_leaving('circuit_person', 'id', 'visibility');

drop trigger if exists player_registry_drop_certain on public.player_registry;
create trigger player_registry_drop_certain
  after update of visibility on public.player_registry
  for each row execute function
  public.visibility_certain_forget_on_leaving('player_registry', 'id', 'visibility');

/* profile_blocks never UPDATEs its tier today -- every save deletes the page and re-inserts it,
   which is why the rule had to live inside `save_my_profile_blocks` in the first place. The
   trigger is here anyway, because "no caller does that" is the kind of claim that stops being
   true without anybody noticing, and a direct PATCH is a caller. */
drop trigger if exists profile_blocks_drop_certain on public.profile_blocks;
create trigger profile_blocks_drop_certain
  after update of visibility on public.profile_blocks
  for each row execute function
  public.visibility_certain_forget_on_leaving('profile_block', 'id', 'visibility');

drop trigger if exists profiles_drop_certain_activity on public.profiles;
create trigger profiles_drop_certain_activity
  after update of activity_visibility on public.profiles
  for each row execute function
  public.visibility_certain_forget_on_leaving('profile_activity', 'user_id', 'activity_visibility');

/* the enumeration, asserted rather than trusted: every kind `owns_item` knows about must have
   both triggers -- one for the row going, one for the tier leaving. `profile_activity` lives on
   `profiles`, whose list rows also go with the account through the owner FK. */
do $check$
declare n int;
begin
  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and not t.tgisinternal
     and pg_get_triggerdef(t.oid) ~ 'visibility_certain_forget';
  if n <> 11 then
    raise exception 'expected 11 certain-pruning triggers (5 delete + 6 update), found %', n;
  end if;
end
$check$;
