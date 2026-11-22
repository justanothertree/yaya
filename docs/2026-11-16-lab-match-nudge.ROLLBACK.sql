-- ROLLBACK for docs/applied/2026-11-16-lab-match-nudge.DRAFT.sql: the two policies, then the helper they
-- call. The client needs nothing undone: a refused private join is what it already expects.
drop policy if exists "lab matches: players can nudge" on realtime.messages;
drop policy if exists "lab matches: players can listen" on realtime.messages;
drop function if exists public.lab_match_topic_member(text);
