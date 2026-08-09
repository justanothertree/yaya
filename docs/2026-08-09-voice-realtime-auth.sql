-- 2026-08-09 — Realtime Authorization for the voice channels
-- Applied to prod as migration `voice_realtime_authorization`. Recorded here for the rollback
-- and because this is the one place in the stack where table RLS was NOT the boundary.
--
-- BEFORE: `realtime.messages` had RLS enabled and ZERO policies. For a *private* channel that
-- means deny-all, but the voice channels were PUBLIC channels, and public channels skip
-- authorization entirely. So `voice:<room>` (signalling) and `vp:<room>` (occupancy) were
-- gated only by the room UUID being unguessable. Concretely: someone removed from a room kept
-- voice access to it forever, while chat correctly denied them.
--
-- AFTER: the two topics are private (`private: true` in the client) and gated on the same
-- membership function chat already trusts.
--
-- MEASURED, from the browser, with only the anon key:
--   private: true  -> "Unauthorized: You do not have permissions to read from this Channel topic"
--   private: false -> SUBSCRIBED
-- which is the residual hole: these policies gate our client, but an attacker who hand-builds
-- one and omits the flag still gets in. Closing that needs "Allow public access" turned OFF in
-- Realtime settings, which requires the other six channels (all postgres_changes) to be
-- converted first — verified that authorization applies to those too, so an `to anon` policy
-- can keep the public leaderboard live-updating for signed-out visitors.

create or replace function public.voice_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  raw text;
begin
  raw := coalesce(
    substring(p_topic from '^voice:([0-9a-fA-F-]{36})$'),
    substring(p_topic from '^vp:([0-9a-fA-F-]{36})$')
  );
  if raw is null then
    return false;
  end if;
  return public.chat_room_member(raw::uuid);
end;
$$;

-- A GRANT is not a REVOKE: new functions are EXECUTE-able by PUBLIC by default, and this one
-- answers "is this person in that room".
revoke all on function public.voice_topic_member(text) from public, anon;
grant execute on function public.voice_topic_member(text) to authenticated;

create policy "voice: members can listen"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.voice_topic_member((select realtime.topic()))
);

create policy "voice: members can send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.voice_topic_member((select realtime.topic()))
);

-- Verified with a rolled-back simulated JWT (nothing written, no real account touched):
--   member  + voice:<their room>          -> true
--   member  + vp:<their room>             -> true
--   member  + chat:<their room>           -> false   (not a voice topic)
--   member  + voice:<a room they're not in> -> false
--   member  + xvoice:<room> / voice:<room>:extra / bare uuid / malformed -> false
--   a signed-in NON-member + both topics  -> false
--   anon has no EXECUTE on the helper at all

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- If real members are wrongly refused (they'd see "You don't have access to this call"), this
-- restores the previous behaviour immediately. Reverting `private: true` in the client does the
-- same thing without a deploy being blocked on SQL.
--
-- drop policy if exists "voice: members can listen" on realtime.messages;
-- drop policy if exists "voice: members can send" on realtime.messages;
