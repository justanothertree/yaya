-- 2026-09-09 — one person, one row: merge "Tin" and "Ramtin"
--
-- WHY: tIN has TWO rows in circuit_people, both carrying his account
-- (c9a73833-ba45-45fc-82df-cd5dbfd5b208):
--
--     id                                      name    logs   groups
--     6                                       Tin       46   The Crew
--     6993cc46-bc11-462b-9f44-6cd202949672    Ramtin     0   The Crew
--
-- Ratings are keyed by ACCOUNT now, so both rows resolve to the same rater — which is what put
-- two identical columns on the ratings board, made his column refuse to hide, and multiplied it
-- when toggled. The board is deduped in code as well (see ratersIn), so this is not load-bearing
-- for that fix; it is the underlying data being wrong, and worth fixing on its own terms.
--
-- ⚠️ ROW 6 SURVIVES, RENAMED — not the one already called Ramtin.
--
-- It is tempting to keep the row that has the right name and delete the other. That would throw
-- away 46 workout logs, because they hang off person_id and every one of them points at row 6.
-- Renaming is one column; re-pointing history is a migration with something to get wrong. He
-- wants to be Ramtin, and Ramtin is who row 6 becomes.
--
-- Nothing here touches circuit_ratings: those are keyed by user_id, and his 17 ratings are
-- already correct and already his.

begin;

-- 1. the surviving row takes the name he chose
update public.circuit_people
   set name = 'Ramtin'
 where id = '6'
   and owner_user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';

-- 2. drop the empty duplicate's circuit membership, then the row itself.
--    Row 6 is already in The Crew, so nothing is lost by removing this one.
delete from public.circuit_person_groups
 where person_id = '6993cc46-bc11-462b-9f44-6cd202949672';

delete from public.circuit_people
 where id = '6993cc46-bc11-462b-9f44-6cd202949672'
   and owner_user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
-- One row, named Ramtin, still holding all 46 logs and still in The Crew:
--
--   select p.id, p.name, p.owner_user_id,
--          (select count(*) from public.circuit_logs l where l.person_id = p.id) as logs,
--          (select count(*) from public.circuit_person_groups g where g.person_id = p.id) as groups
--     from public.circuit_people p
--    where p.owner_user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';
--
-- Expect exactly one row: id 6, Ramtin, 46 logs, 1 group.
--
-- And nobody else shares an account — this should return no rows, now and in future:
--
--   select owner_user_id, count(*) from public.circuit_people
--    where owner_user_id is not null group by 1 having count(*) > 1;
