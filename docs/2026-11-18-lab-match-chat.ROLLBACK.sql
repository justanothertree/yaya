-- ROLLBACK for docs/2026-11-18-lab-match-chat.DRAFT.sql: the two functions and the table, and every
-- line in it. ⚠️ THAT LAST PART IS A DELETE OF WHAT PLAYERS WROTE — once the draft has been live,
-- ask before running this, or keep the table and drop only the functions (the first two lines).
drop function if exists public.lab_match_say(uuid, text);
drop function if exists public.lab_match_lines(uuid, bigint);
drop table if exists public.lab_match_chat;
