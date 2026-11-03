-- ✅ APPLIED 3 Nov 2026 as `pictures_log_their_orphans_and_count_their_uses`.
--
-- ⚠️ "REPORTED, SO A SWEEP CAN FIND IT LATER" WAS NOT TRUE, AND THE ROW ORDER IS WHY.
-- `picture_drop` deletes the `member_pictures` row and RETURNS its two keys, and the edge
-- function then asks R2 to remove them. That order is right: the row's answer is the only place
-- the keys live, and a delete that failed in R2 is not a failed delete from the person's point of
-- view -- raising it would invite them to press again on a row that no longer exists.
--
-- What the comment claimed, though, was that the leftover object was reported. The only report
-- was `orphaned: true` in a response nobody keeps, and by then those two keys had gone from
-- Postgres: the object was unreachable, uncountable and billed, with nothing left to sweep by.
-- `picture_orphans` is where they are written down now -- deny-all, no grants at all, reached
-- only through `picture_orphan_log` granted to `service_role` and nothing else, which is the
-- shape `picture_ready` already uses for the same caller.
--
-- ⚠️ NO FOREIGN KEY ON `owner`, DELIBERATELY, and it is the only table here without one.
-- `member_pictures.owner` cascades from `profiles`, which is right -- delete the account and the
-- pictures go. An orphan record has to OUTLIVE that, because the objects in R2 do: a deleted
-- account whose last delete failed is exactly the case a sweep must still be able to find. A
-- cascade would tidy away the evidence of the thing it is evidence of.
--
-- ⚠️ AND ONE ROW PER KEY WHILE IT IS UNSWEPT. A flaky connection retrying the same
-- failed delete would otherwise write the same unreachable object five times, and the admin card
-- would report five objects that are one.
--
-- Also here, the admin's site totals and each picture's uses:
--
-- `admin_picture_totals()` answers "am I about to be charged, and is anything stuck" without
-- naming a single member, key, alt text or id. Phase 3 deliberately removed the admin's standing
-- bypass of the ladder -- "Only me means no one else, owner included" -- so a card needing
-- per-member rows would re-open a door that was closed on purpose. `members_near_cap` is a COUNT
-- of accounts past 80% of either ceiling, which is what turns "raise the cap" into a decision
-- somebody can make before a refusal arrives.
--
-- `pictures_mine` now carries `in_ratings`, `in_logs` and `in_sittings`. All three foreign keys
-- are `on delete set null`, so deleting a picture leaves the rating, the workout day or the
-- sitting there WITHOUT a photograph -- which is why the room asks before deleting one that is in
-- use and deletes an unused one in a single press. In `pictures_mine` rather than a
-- `picture_uses(uuid)` of its own, for the reason written beside `seenPictures`: the room draws a
-- grid, so a per-picture RPC is five hundred round trips at the ceiling.
--
-- Measured, as the admin, as a member and as `anon` with the ROLE actually set (a `set_config` of
-- the JWT claims alone changes `auth.uid()` and not the database role -- the first run of this
-- check reported ALLOWED for a member because of exactly that):
--   admin, site totals                31 pictures, 7,404,794 bytes, 1 account, 0 orphans
--   member, site totals               refused -- "not allowed"
--   signed out, site totals           refused -- "not allowed"
--   member, picture_orphan_log        refused -- permission denied for function
--   member, select picture_orphans    refused -- permission denied for table
--   member, TRUNCATE picture_orphans  refused -- permission denied for table
--   anon, both                        refused -- permission denied
--   pictures_mine before/after hanging one on a sitting   0 -> 1
--   the same key logged twice         1 row

/* ⚠️ A FAILED R2 DELETE LEAVES AN OBJECT NOBODY CAN EVER NAME AGAIN, BECAUSE THE ROW GOES FIRST.
   `picture_drop` deletes the `member_pictures` row and RETURNS its two keys, which is what the
   edge function then asks R2 to remove. That order is right -- the row's answer is the only place
   the keys live, and a delete that failed in R2 is not a failed delete from the person's point of
   view, so it must not be raised at them. But when `orphaned: true` comes back, the keys have
   already gone from Postgres: the object is unreachable, uncountable and billed.

   So the keys are written down before they can be lost. Deny-all with no grants at all -- the
   house pattern from §3 -- and reached only through a definer RPC granted to `service_role`,
   which is the same shape `picture_ready` already uses for the same caller (the edge function's
   `asService` client). A member cannot write here, cannot read here, and does not need to: an
   orphan is the operator's problem and shows up in the admin Usage card.

   ⚠️ NO FOREIGN KEY ON `owner`, deliberately, and it is the one place in this schema without one.
   `member_pictures.owner` cascades from `profiles`, which is right: delete the account and the
   pictures go. An orphan record has to OUTLIVE that, because the objects in R2 do -- a deleted
   account whose last upload failed to delete is exactly the case a sweep must still be able to
   find. A cascade here would quietly tidy away the evidence of the thing it is evidence of. */
create table if not exists public.picture_orphans (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null,
  key text not null,
  thumb_key text,
  /* which of the two actually failed, so a sweep knows what to look for rather than trying both */
  which text not null default 'both',
  at timestamptz not null default now(),
  swept_at timestamptz
);

alter table public.picture_orphans enable row level security;
revoke all on table public.picture_orphans from public, anon, authenticated;

create index if not exists picture_orphans_unswept
  on public.picture_orphans (at) where swept_at is null;

/* ⚠️ THE SAME KEY TWICE IS ONE ORPHAN, NOT TWO. A delete that fails is a delete somebody may well
   press again -- the row is gone, so the second press raises "no such picture", but the FIRST
   press can itself be retried by a flaky connection at the function level. Without this a
   stuttering network writes the same unreachable object into the log five times and the admin
   card reports five objects that are one. */
create unique index if not exists picture_orphans_one_per_key
  on public.picture_orphans (key) where swept_at is null;

create or replace function public.picture_orphan_log(
  p_owner uuid,
  p_key text,
  p_thumb_key text,
  p_which text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_owner is null or nullif(btrim(coalesce(p_key, '')), '') is null then
    raise exception 'an orphan needs an owner and a key';
  end if;
  insert into public.picture_orphans (owner, key, thumb_key, which)
  values (p_owner,
          btrim(p_key),
          nullif(btrim(coalesce(p_thumb_key, '')), ''),
          case when p_which in ('full', 'thumb', 'both') then p_which else 'both' end)
  /* see the unique index: one unswept record per key */
  on conflict do nothing;
end
$$;

/* ⚠️ `service_role` ONLY, which is the `picture_ready` pattern exactly: `postgres=X |
   service_role=X` and nothing else. The caller is the edge function's `asService` client, and
   nothing a member does should be able to write a record here -- an orphan log a member can
   append to is a log that can be made to say anything. */
revoke all on function public.picture_orphan_log(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.picture_orphan_log(uuid, text, text, text) to service_role;

/* ── what the operator needs to know, and nothing else ──────────────────────────────────────── */

/* ⚠️ SITE TOTALS, NOT A LIST. Evan's instruction, and the shape matters more than the numbers:
   this answers "am I about to be charged, and is anything stuck" without naming a single member,
   key, alt text or id. The admin view of this project deliberately stopped bypassing the ladder
   in Phase 3 -- "Only me means no one else, owner included" -- so a card that needed per-member
   rows would be re-opening a door that was closed on purpose.

   `members_near_cap` is a COUNT of accounts over 80% of either ceiling. It is the one figure here
   that is about people rather than bytes, and it is the one worth having: the ceilings refuse at
   500 pictures or 50 MB with a message, and knowing somebody is about to meet one is the
   difference between raising the cap and hearing about it afterwards. A count says "look at the
   caps"; a list would say who, which is not needed to make that decision. */
create or replace function public.admin_picture_totals()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  select jsonb_build_object(
    'count',   count(*),
    'ready',   count(*) filter (where ready),
    'pending', count(*) filter (where not ready),
    /* ⚠️ STALE IS AN HOUR, BECAUSE THAT IS WHAT `picture_claim` SWEEPS AT. A claim older than an
       hour is one the sweep will delete the next time its owner keeps anything -- so this counts
       quota held by pictures that do not exist, and the figure is only alarming if it stays. */
    'stale',   count(*) filter (where not ready and created_at < now() - interval '1 hour'),
    'bytes',   coalesce(sum(bytes + thumb_bytes), 0),
    'members', count(distinct owner)
  ) into v
  from public.member_pictures;

  return v
    || jsonb_build_object(
      /* over 80% of EITHER ceiling, which is `picture_claim`'s own pair: 500 rows or 50 MB */
      'members_near_cap', (
        select count(*) from (
          select owner, count(*) as n, coalesce(sum(bytes + thumb_bytes), 0) as b
            from public.member_pictures group by owner
        ) z where z.n >= 400 or z.b >= 41943040
      ),
      'orphans', (select count(*) from public.picture_orphans where swept_at is null),
      'orphans_oldest', (select min(at) from public.picture_orphans where swept_at is null)
    );
end
$$;

revoke all on function public.admin_picture_totals() from public, anon, authenticated;
grant execute on function public.admin_picture_totals() to authenticated;

/* ── where each of your own pictures is used ────────────────────────────────────────────────── */

/* ⚠️ IN `pictures_mine` RATHER THAN A `picture_uses(uuid)` OF ITS OWN, and the reason is the one
   written beside `seenPictures`: the room draws a grid, so a per-picture RPC is one round trip
   per thumbnail and at the 500-picture ceiling that is five hundred. The counts come back with
   the list that was already being fetched.

   ⚠️ AND THEY ARE THE CALLER'S OWN ROWS ONLY. A picture of yours can hang on a rating of yours,
   a workout day of yours or a sitting of yours -- all three FKs are `on delete set null`, so
   deleting the picture does not delete the thing it was attached to, it just stops having a
   photograph. That is what the confirm step in the room is about, and the number has to be the
   number of places that would lose it. Counting ANYBODY's rows would be both wrong (a picture
   cannot reach somebody else's rating) and a leak. */
do $mig$
declare
  v_src text;
  v_out text;
  v_old constant text := E'    from (select id, key, thumb_key, mime, bytes, thumb_bytes, w, h, alt, created_at\n'
    || E'            from public.member_pictures\n'
    || E'           where owner = auth.uid() and ready) x;\n';
  v_new constant text := E'    from (select p.id, p.key, p.thumb_key, p.mime, p.bytes, p.thumb_bytes,\n'
    || E'                 p.w, p.h, p.alt, p.created_at,\n'
    || E'                 /* where this one is used -- the caller''s own rows, which is every row\n'
    || E'                    that could be holding it: all three FKs are on delete set null */\n'
    || E'                 (select count(*) from public.circuit_ratings r\n'
    || E'                   where r.picture = p.id and r.user_id = auth.uid()) as in_ratings,\n'
    || E'                 (select count(*) from public.circuit_logs l\n'
    || E'                    join public.circuit_people cp on cp.id = l.person_id\n'
    || E'                   where l.picture = p.id and cp.owner_user_id = auth.uid()) as in_logs,\n'
    || E'                 (select count(*) from public.chronicle_entries e\n'
    || E'                   where e.picture = p.id and e.owner = auth.uid()) as in_sittings\n'
    || E'            from public.member_pictures p\n'
    || E'           where p.owner = auth.uid() and p.ready) x;\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'pictures_mine';
  if v_src is null then raise exception 'pictures_mine not found'; end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'the pictures_mine body is not where this migration expects it';
  end if;
  v_out := replace(v_src, v_old, v_new);
  execute v_out;
end
$mig$;
