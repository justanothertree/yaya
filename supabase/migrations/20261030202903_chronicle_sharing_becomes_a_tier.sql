-- ✅ APPLIED 30 Oct 2026 as `chronicle_sharing_becomes_a_tier`.
--
-- Phase 4 of docs/2026-10-30-one-visibility-ladder-plan.md, additive half.
--
-- ⚠️ ELEVEN FUNCTIONS READ OR WRITE `shared`, AND NONE OF THEM IS TOUCHED HERE. Four write it
-- (`chronicle_activity_save`, `chronicle_activity_share`, `chronicle_goal_share`,
-- `chronicle_import`) and seven read it (`chronicle_activities_mine`, `chronicle_export`,
-- `chronicle_friends_log`, `chronicle_goals_mine`, `chronicle_sharing_mine`, `feed_recent`,
-- `get_member_chronicle`). Reproducing eleven function bodies to swap one column is a lot of
-- transcription risk for no behaviour, so the database keeps the two in step instead: a BEFORE
-- trigger derives whichever side was not moved, and a CHECK makes disagreement impossible.
--
-- That is deliberately the opposite of the usual advice about two sources of truth. Two columns
-- that can drift are a bug; two columns that CANNOT are a migration in progress. The CHECK is
-- what makes the difference, and it is why this is safe to leave in place until Phase 5.
--
-- ⚠️ `certain` SETS `shared = false`, WHICH IS THE WHOLE SAFETY PROPERTY. It is narrower than
-- friends and has no circles wired to it yet, so an activity moved to Certain friends becomes
-- invisible to the seven readers still using the boolean rather than visible to everyone. An
-- unwired level failing closed is what lets this ship before Phase 5 does.
--
-- ⚠️ AND THE USEFUL RANGE HERE IS private | certain | friends, NOT the whole ladder. A
-- sitting-by-sitting timeline is friends-only by design — `profile_blocks`' own editor says so
-- in writing, and refuses to let the card's wider tiers carry it. Nothing here widens that; what
-- the tier adds is the ability to go NARROWER than "all my friends", which is the thing members
-- could not say before.
--
-- Verified in a rolled-back transaction:
--   rows where shared and visibility disagree        0 activities, 0 goals
--   all 27 activities                                private  (so the backfill is a no-op)
--   set shared = true                                -> visibility friends
--   set visibility = private                         -> shared false
--   set visibility = certain                         -> shared false
--   write an inconsistent pair with the trigger off  -> refused by the CHECK
-- and behaviourally: chronicle_activity_share still drives both directions, while
-- chronicle_sharing_mine (22), feed_recent (18 events), chronicle_friends_log (0 sittings) and
-- chronicle_activities_mine (23) all answer exactly as before.
--
-- ⚠️ WHAT PHASE 5 STILL OWES, named here because it is the half a round trip would lose:
-- `chronicle_export` carries `shared` and `chronicle_import` writes it, so exporting and
-- re-importing a chronicle would turn a `certain` activity into a plain private one. It cannot
-- happen today — nothing can set `certain` yet — which is exactly why it has to be written down
-- now rather than discovered by the first person who uses the feature.

alter table public.chronicle_activities
  add column if not exists visibility public.visibility_tier not null default 'private';
alter table public.chronicle_goals
  add column if not exists visibility public.visibility_tier not null default 'private';

update public.chronicle_activities
   set visibility = (case when shared then 'friends' else 'private' end)::public.visibility_tier
 where visibility is distinct from (case when shared then 'friends' else 'private' end)::public.visibility_tier;
update public.chronicle_goals
   set visibility = (case when shared then 'friends' else 'private' end)::public.visibility_tier
 where visibility is distinct from (case when shared then 'friends' else 'private' end)::public.visibility_tier;

create or replace function public.chronicle_tier_sync()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  /* Whichever side the caller moved decides the other. On insert, a visibility that is not the
     default is taken as the intent; otherwise the boolean is. Written this way so that none of
     the eleven functions that read or write `shared` has to change: the database keeps the two
     in step, rather than eleven call sites each remembering to. */
  if tg_op = 'INSERT' then
    if new.visibility is distinct from 'private'::public.visibility_tier then
      new.shared := new.visibility in ('friends','members','public');
    else
      new.visibility := (case when new.shared then 'friends' else 'private' end)::public.visibility_tier;
    end if;
  else
    if new.visibility is distinct from old.visibility then
      new.shared := new.visibility in ('friends','members','public');
    elsif new.shared is distinct from old.shared then
      new.visibility := (case when new.shared then 'friends' else 'private' end)::public.visibility_tier;
    end if;
  end if;
  return new;
end $function$;

revoke all on function public.chronicle_tier_sync() from public, anon, authenticated;

drop trigger if exists chronicle_activities_tier_sync on public.chronicle_activities;
create trigger chronicle_activities_tier_sync
  before insert or update of shared, visibility on public.chronicle_activities
  for each row execute function public.chronicle_tier_sync();

drop trigger if exists chronicle_goals_tier_sync on public.chronicle_goals;
create trigger chronicle_goals_tier_sync
  before insert or update of shared, visibility on public.chronicle_goals
  for each row execute function public.chronicle_tier_sync();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chronicle_activities_tier_agrees') then
    alter table public.chronicle_activities
      add constraint chronicle_activities_tier_agrees
      check (shared = (visibility in ('friends','members','public')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chronicle_goals_tier_agrees') then
    alter table public.chronicle_goals
      add constraint chronicle_goals_tier_agrees
      check (shared = (visibility in ('friends','members','public')));
  end if;
end $$;

comment on column public.chronicle_activities.visibility is
  'The ladder level for this activity''s sittings. `shared` is the old boolean and is kept in lockstep by chronicle_tier_sync + a CHECK, so the eleven functions still reading it keep working. The useful range here is private | certain | friends: a sitting-by-sitting timeline is friends-only by design and no level above that widens it.';
comment on column public.chronicle_goals.visibility is
  'The ladder level for this goal. Same lockstep arrangement as chronicle_activities.visibility.';
