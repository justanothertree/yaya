-- ⛔ DRAFT — NOT APPLIED. The nudge on an open match: step 12 of the Lab multiplayer plan, second
-- half (docs/2026-11-14-lab-async-matches-plan.md, "How you know it's your move").
--
-- While both players have a match open, whoever acts sends `{ seq }` on the match's own private
-- Realtime topic, `labmatch:<match id>`, and the other page looks again at once instead of at its
-- next look (every 20 s while waiting, and on focus). The message carries the seq and nothing
-- else: never a move, never a board. The page re-reads the match through lab_match_get, so what it
-- shows is still only what the server says (src/lab/matches/nudge.ts).
--
-- WHAT THIS ADDS, and nothing else: one helper and two policies on realtime.messages, the same
-- shape as the voice channels' (docs/2026-08-09-voice-realtime-auth.sql). No table, no column, no
-- change to any lab_match function.
--
--   lab_match_topic_member(topic)   true only for `labmatch:<uuid>` naming a match the caller is a
--                                   player in. The uuid is matched in full by its own shape before
--                                   it is cast, so a malformed topic is a plain no rather than a
--                                   cast error raised inside a policy.
--   "lab matches: players can listen"   SELECT on realtime.messages, broadcast/presence only
--   "lab matches: players can nudge"    INSERT on realtime.messages, broadcast/presence only
--
-- ⚠️ THE RESIDUAL HOLE IS THE ONE THE VOICE NOTE NAMES, UNCHANGED: these policies gate a PRIVATE
-- join. A hand-built client that joins `labmatch:<id>` publicly skips them, while "Allow public
-- access" is on in Realtime's settings. What it could then hear is that a move happened in a
-- match whose uuid it already knows, as a number. That is all the topic ever carries.
--
-- NOTHING DEPENDS ON IT. Until this is applied the client's private join is refused, quietly,
-- and the page looks again on focus and every 20 s as it does today.
--
-- ROLLBACK: docs/2026-11-16-lab-match-nudge.ROLLBACK.sql. CHECKS: …checks.sql beside it.

create or replace function public.lab_match_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  raw text;
begin
  raw := substring(
    p_topic
    from '^labmatch:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
  );
  if raw is null or auth.uid() is null then
    return false;
  end if;
  return exists (
    select 1
    from public.lab_matches m
    where m.id = raw::uuid
      and auth.uid() in (m.player_a, m.player_b)
  );
end;
$$;

-- a grant is not a revoke: a new function is executable by PUBLIC, and anon holds execute here
revoke all on function public.lab_match_topic_member(text) from public, anon;
grant execute on function public.lab_match_topic_member(text) to authenticated;

create policy "lab matches: players can listen"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.lab_match_topic_member((select realtime.topic()))
);

create policy "lab matches: players can nudge"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.lab_match_topic_member((select realtime.topic()))
);
