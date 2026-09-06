-- 2026-09-06 — finish the invite backfill: two pairs it deliberately skipped
--
-- WHY: yesterday's script made an invite create a friendship, and backfilled the eight already
-- spent. I predicted three new friendships and it made one. Not a bug — a wrong forecast. I
-- counted "pairs who are not currently friends", but two of them already had a friendships row
-- sitting at 'pending', and the script's `on conflict do nothing` left it alone.
--
-- That skip was right for the case it was written for and wrong for the case that turned up.
-- The reasoning was "never overturn a decline". Neither of these is a decline: both are requests
-- the INVITER sent to somebody who had already joined through their link and simply never got
-- round to pressing accept.
--
-- ⚠️ THE REAL PROBLEM IS THE INCONSISTENCY. From now on, anybody who uses an invite link is
-- friends with the sender the moment they finish signing up — no acceptance step, because using
-- the link is the acceptance. So leaving these two pending means the same relationship resolves
-- two different ways depending only on whether a friend request happens to be sitting there.
-- A rule that applies to everyone from tomorrow should apply to the people it already describes.
--
-- ⚠️ DECLINES ARE STILL UNTOUCHED, and that is the whole of the scoping. `status = 'pending'`
-- only. Somebody who was invited, joined, and then actively refused a friend request has said
-- something, and no amount of "but the invite implies it" makes that a mistake to correct.
--
-- Measured before writing: 8 used invites, 7 accepted friendships, 2 pending pairs (both
-- requested by the inviter), 0 declined. So this settles exactly two rows.

begin;

update public.friendships f
   set status = 'accepted',
       responded_at = now()
 where f.status = 'pending'
   and exists (
     select 1 from public.invites i
      where i.used_by is not null
        and i.created_by is not null
        and i.created_by <> i.used_by
        and least(i.created_by, i.used_by) = f.user_a
        and greatest(i.created_by, i.used_by) = f.user_b
   );

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
--   select count(*) from public.friendships where status='accepted';       -- 7 before, 9 after
--   select count(*) from public.invites i
--    where i.used_by is not null and i.created_by is not null
--      and i.created_by <> i.used_by
--      and not public.are_friends(i.created_by, i.used_by);                -- 0
--
-- No app change and nothing to deploy: the friendship is read by are_friends(), which every
-- friends-scoped surface already goes through.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- There is no clean one — 'pending' and 'accepted' are the same row and the previous value is
-- not kept anywhere. If this turns out to be wrong for a particular pair, the person can remove
-- the friendship from the People page, which is the same control they would have used to
-- decline it.
