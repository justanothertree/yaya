-- 2026-08-28 — Presence told a stranger when you were at your desk.
--
-- WHAT WAS WRONG
--
-- presence_audience_ok() decided who may subscribe to your `presence:<uuid>` topic. It admitted
-- anyone with a row in `friendships` — and it never looked at `status`. A row is created by
-- REQUESTING, not by accepting.
--
-- So: send a friend request to any member by username. They never answer. You are now authorized
-- by RLS to join their presence topic and watch them appear and disappear for as long as you
-- like. Nothing tells them, and declining is the only way to end it — which requires them to
-- notice a request they may simply be ignoring.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
--
-- A single online/offline bit reads as trivial. Sampled over days it is not: it is a sleep
-- schedule, a working pattern, and a dependable answer to "is this person at home right now".
-- That is the kind of signal that makes the rest of a profile dangerous rather than friendly,
-- and it was obtainable by anyone who knew a username, with no consent at any point.
--
-- The repo is public, so the exposure was public too: the shape of the check is readable by
-- anyone, and reaching the topic needs no custom client — just a request nobody accepted.
--
-- THE FIX
--
-- are_friends() has always required status = 'accepted'. Calling it here gives "friend" ONE
-- definition instead of two that had quietly drifted apart, which is how they came to disagree.
-- Circuit-mates keep their access: that audience is mutual membership of a group you both
-- joined, which is a relationship both people opted into, unlike an unanswered request.
--
-- VERIFIED
--
-- Of the 9 friendship rows live at the time: the 5 accepted pairs still pass the friend arm, and
-- the 4 pending pairs no longer pass it.
--
-- Worth stating precisely, because it would be easy to overclaim: all 4 of those pending pairs
-- ALSO share a circuit, so every one of them still sees the other through the circuit-mate arm.
-- No live access actually changed in this database. What changed is that the path no longer
-- exists for a stranger — someone with no shared circuit who simply sends a request now gains
-- nothing by it, which was the whole exposure.
--
-- RELATED
--
-- list_member_directory() has the same status-blind shape, and is deliberately LEFT alone: a
-- pending request has to be visible to the person who sent it or it could never be withdrawn,
-- and a name in a directory is not behavioural data. Presence is the one that had to change.

create or replace function public.presence_audience_ok(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    p_owner = auth.uid()
    or public.are_friends(auth.uid(), p_owner)
    or exists (
      select 1
      from public.circuit_group_members mine
      join public.circuit_group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and theirs.user_id = p_owner
    )
  );
$function$;
