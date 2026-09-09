-- 2026-09-09 — one person, one row, one name: Tin becomes Ramtin
--
-- Two separate problems, both his, both fixed here.
--
--
-- PART 1 — TWO PEOPLE ROWS FOR ONE ACCOUNT
--
-- tIN has TWO rows in circuit_people, both carrying his account
-- (c9a73833-ba45-45fc-82df-cd5dbfd5b208):
--
--     id                                      name    logs   groups
--     6                                       Tin       46   The Crew
--     6993cc46-bc11-462b-9f44-6cd202949672    Ramtin     0   The Crew
--
-- Ratings are keyed by ACCOUNT now, so both rows resolve to the same rater — which is what put
-- two identical columns on the ratings board, made his column refuse to hide, and multiplied it
-- when toggled. The board is deduped in code as well (see ratersIn), so this is not load-bearing
-- for that fix; it is the underlying data being wrong.
--
-- ⚠️ ROW 6 SURVIVES, RENAMED — not the one already called Ramtin. That row holds all 46 of his
-- workout logs, which hang off person_id. Renaming is one column; re-pointing history is a
-- migration with something to get wrong.
--
--
-- PART 2 — THE HANDLE
--
-- ⚠️ profiles.username IS A FOREIGN KEY to player_registry(player_name), and it was ON UPDATE NO
-- ACTION — so renaming a handle was simply impossible: updating the registry row breaks the
-- reference from profiles, and updating profiles first has nothing to point at. That is also why
-- there is no "change your handle" anywhere in the app.
--
-- Everything else about a player hangs off player_registry.id — leaderboard and score_history
-- both reference the id, never the name — so the name is free to change as long as the one
-- reference to it follows. ON UPDATE CASCADE is what that means, and it is the correct constraint
-- whether or not anybody ever builds the settings field: a unique display name that can never be
-- corrected is a bug waiting for its first typo.
--
-- Checked before writing this: 'Ramtin' is not taken, and his registry row has zero scores and
-- zero trophies, so nothing of his Snake history rides on the old name.
--
-- ⚠️ NOTHING HERE TOUCHES LOGIN. Sign-in is auth.users; this is a display name and a circuit
-- roster row. His account, his 17 ratings (keyed by user_id) and his profile all survive intact.

begin;

-- ── PART 1: merge the duplicate person ──────────────────────────────────────────────────────

update public.circuit_people
   set name = 'Ramtin'
 where id = '6'
   and owner_user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';

-- row 6 is already in The Crew, so nothing is lost by dropping this membership
delete from public.circuit_person_groups
 where person_id = '6993cc46-bc11-462b-9f44-6cd202949672';

delete from public.circuit_people
 where id = '6993cc46-bc11-462b-9f44-6cd202949672'
   and owner_user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';

-- ── PART 2: let a handle be renamed at all, then rename his ─────────────────────────────────

alter table public.profiles drop constraint profiles_username_fkey;
alter table public.profiles
  add constraint profiles_username_fkey
  foreign key (username) references public.player_registry(player_name)
  on update cascade;

-- one statement now — profiles.username follows automatically
update public.player_registry
   set player_name = 'Ramtin'
 where player_name = 'tIN'
   and user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
-- One person row, named Ramtin, still holding all 46 logs and still in The Crew:
--
--   select p.id, p.name,
--          (select count(*) from public.circuit_logs l where l.person_id = p.id) as logs,
--          (select count(*) from public.circuit_person_groups g where g.person_id = p.id) as groups
--     from public.circuit_people p
--    where p.owner_user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';
--
-- Expect exactly one: id 6, Ramtin, 46 logs, 1 group.
--
-- The handle followed the registry, and his ratings are untouched:
--
--   select pr.username, reg.player_name,
--          (select count(*) from public.circuit_ratings r where r.user_id = pr.user_id) as ratings
--     from public.profiles pr
--     join public.player_registry reg on reg.user_id = pr.user_id
--    where pr.user_id = 'c9a73833-ba45-45fc-82df-cd5dbfd5b208';
--
-- Expect: Ramtin, Ramtin, 17.
--
-- And nobody shares an account — no rows, now or in future:
--
--   select owner_user_id, count(*) from public.circuit_people
--    where owner_user_id is not null group by 1 having count(*) > 1;
