-- 2026-08-10 — Realtime Authorization for the remaining six channels
--
-- Applied to prod as three migrations (the middle one was a wrong turn, kept here because the
-- reason it was wrong is the useful part):
--   realtime_authorization_remaining_channels
--   realtime_authorization_fix_null_extension
--   realtime_authorization_drop_extension_filter   <- the shipped state
--
-- WHY: these six channels leak nothing. Table RLS already filters what each subscriber
-- receives. But "Allow public access" is a PROJECT-WIDE switch, and while it is on, the voice
-- policies can be bypassed by simply not requesting a private channel. Measured from the
-- browser with only the anon key:
--     private: true  -> "Unauthorized: You do not have permissions to read from this topic"
--     private: false -> SUBSCRIBED
-- Every channel therefore has to work privately before that switch can be thrown.
--
-- ── THE TRAP, measured rather than reasoned about ───────────────────────────────────────────
-- The docs' examples filter on `realtime.messages.extension`, so the first attempt gated the
-- postgres_changes topics on `extension not in ('broadcast','presence')`. Every one of them was
-- refused. Two findings, both from throwaway probe topics on prod:
--
--   1. `extension` is NULL at join time, and `NULL not in (...)` is NULL, which RLS reads as
--      false. Adding coalesce() did not fix it, which led to:
--   2. broadcast channel + policy requiring `extension in ('broadcast','presence')` -> SUBSCRIBED
--      postgres_changes  + policy requiring `extension not in (...)`                -> DENIED
--
-- So when a client joins a private channel, Realtime runs its authorization check as a
-- broadcast/presence READ regardless of what the channel is bound to. `extension` describes the
-- probe, not the subscription, and can never be 'postgres_changes' at join time. A filter on it
-- can only ever produce false denials for postgres_changes topics, so it is gone.
--
-- Had this shipped unnoticed, flipping the switch would have killed the public leaderboard's
-- live updates, the notification bell and the chat list simultaneously, with nothing in the app
-- to explain why.
--
-- SELECT-only, deliberately: joining lets a client LISTEN, while sending a broadcast needs
-- INSERT, which none of these grant. Without that, a fixed topic like 'scores-changes' cannot
-- become a relay for strangers to talk to each other through.

create or replace function public.chat_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  raw text;
begin
  -- `chat:<room uuid>` is a room's live feed; `chat:overview` deliberately does NOT match
  raw := substring(p_topic from '^chat:([0-9a-fA-F-]{36})$');
  if raw is null then
    return false;
  end if;
  return public.chat_room_member(raw::uuid);
end;
$$;

revoke all on function public.chat_topic_member(text) from public, anon;
grant execute on function public.chat_topic_member(text) to authenticated;

-- anon stays allowed here on purpose: the public leaderboard and the public Circuit boards
-- live-update for signed-out visitors, and that must survive the switch being thrown
create policy "public data: signed-out visitors can listen"
on realtime.messages
for select
to anon, authenticated
using ((select realtime.topic()) in ('scores-changes', 'circuit-sync', 'circuit-social'));

create policy "members: bell and conversation list"
on realtime.messages
for select
to authenticated
using ((select realtime.topic()) in ('notif:chat', 'chat:overview'));

create policy "members: a room's live messages"
on realtime.messages
for select
to authenticated
using (public.chat_topic_member((select realtime.topic())));

-- VERIFIED from the browser with only the anon key, after the fix:
--   scores-changes   -> SUBSCRIBED     circuit-sync -> SUBSCRIBED   circuit-social -> SUBSCRIBED
--   notif:chat       -> refused        chat:overview -> refused
--   chat:<uuid>      -> refused        voice:<uuid>  -> refused
-- and the app's real leaderboard channel (its own client, signed out) -> SUBSCRIBED.
--
-- Also verified by simulated JWT: chat_topic_member is true for a member's own room, false for
-- 'chat:overview', a room they aren't in, a voice topic, and a suffix-smuggled topic.
--
-- ── WHAT IS STILL EVAN'S TO DO ──────────────────────────────────────────────────────────────
-- Turn OFF "Allow public access" in Realtime settings. Until then the voice bypass remains
-- open. Everything needed for that switch is now in place; the authenticated live-update paths
-- (bell, chat list, a room's feed) were verified at the predicate level but not through a real
-- signed-in socket, so watch those first after flipping.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- drop policy if exists "public data: signed-out visitors can listen" on realtime.messages;
-- drop policy if exists "members: bell and conversation list" on realtime.messages;
-- drop policy if exists "members: a room's live messages" on realtime.messages;
-- ...and remove `{ config: { private: true } }` from the six channels in src/.
