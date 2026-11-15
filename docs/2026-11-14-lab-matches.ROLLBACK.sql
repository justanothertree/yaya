-- ROLLBACK for docs/2026-11-14-lab-matches.DRAFT.sql, which IS applied (15 Nov 2026, migration
-- 20261115002456_lab_matches_and_results). ⛔ This rollback has not been run against production;
-- it was tested on the throwaway stack only.
--
-- In the reverse order of the draft: the functions first (they read the tables), then the tables,
-- lab_results before the matches its rows point at.
--
-- ⚠️ DROPPING THE TABLES DELETES EVERY MATCH, EVERY MOVE AND EVERY CHECKED RESULT. Before the first
-- match is played that is nothing; afterwards it is members' games and wins, and CLAUDE.md §4 asks
-- for the owner's say before any of it is deleted. Run check B5 of
-- docs/2026-11-14-lab-matches.checks.sql first: if it is not 0, 0, 0, stop and decide what to keep.
--
-- Afterwards, check A1 of the checks file should return no rows again.

begin;

drop function if exists public.lab_match_commit(uuid, int, uuid, jsonb, jsonb, smallint, jsonb, jsonb);
drop function if exists public.lab_match_begin(uuid, uuid, jsonb, smallint, jsonb);
drop function if exists public.lab_match_load(uuid);
drop function if exists public.lab_my_turns();
drop function if exists public.lab_match_claim(uuid);
drop function if exists public.lab_match_resign(uuid);
drop function if exists public.lab_match_get(uuid);
drop function if exists public.lab_match_list();
drop function if exists public.lab_match_decline(uuid);
drop function if exists public.lab_match_challenge(uuid, text, text, jsonb, uuid);
drop function if exists public.lab_match_record(public.lab_matches);
drop function if exists public.lab_match_mine(uuid);
drop function if exists public.lab_match_json(public.lab_matches, uuid, boolean);
drop function if exists public.lab_match_suspended(uuid);
drop function if exists public.lab_pair_friends(uuid, uuid);
drop function if exists public.lab_match_timeout();
drop function if exists public.lab_match_playable(text);

drop table if exists public.lab_results;
drop table if exists public.lab_match_moves;
drop table if exists public.lab_matches;

commit;
