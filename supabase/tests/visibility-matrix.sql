-- Phase 0's matrix: what every member can see of every other member, as one hash.
--
-- ⚠️ THIS SHOULD HAVE EXISTED SINCE PHASE 0 AND DID NOT. The plan said "store the matrix", and
-- what actually happened is that it was recomputed by hand before and after each phase and the
-- hash quoted in commit messages and migration headers. That is evidence somebody has to go
-- hunting for, in prose, which is exactly the shape CLAUDE.md §11 says not to rely on. It is a
-- file now, so "did it change?" is a command rather than an archaeology exercise.
--
-- HOW TO RUN: paste into the SQL editor or hand to execute_sql. Read-only, no transaction needed,
-- but it is wrapped anyway so a stray session setting cannot escape.
--
-- WHAT IT IS: 14 viewers × 14 owners = 196 cells, each the count of profile blocks, activity
-- events and trophies that viewer can see of that owner. It walks `can_see` through the three
-- functions members actually read each other through, so a change to the ladder shows up here
-- whether it was made in `can_see`, in `visibility_ceiling`, or in a policy underneath them.
--
-- ⚠️ IT IS A MEMBER-TO-MEMBER MATRIX AND SAYS NOTHING ABOUT ANONYMOUS VISITORS. Phase 2 was a
-- no-op here and still removed a person from the signed-out board; the public surface has to be
-- checked separately (get_public_profile / get_public_activity / circuit_public as `anon`).
-- A clean matrix is not a clean site.

begin;

create or replace function pg_temp.visibility_matrix()
returns table(viewer text, owner text, blocks int, acts int, tros int)
language plpgsql as $$
declare v record; o record;
begin
  for v in select user_id, username::text as u from public.profiles
            where coalesce(suspended,false)=false order by username loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v.user_id::text, 'role','authenticated')::text, true);
    for o in select username::text as u from public.profiles
              where coalesce(suspended,false)=false order by username loop
      viewer := v.u; owner := o.u;
      blocks := coalesce(jsonb_array_length(public.get_profile_blocks(o.u)), 0);
      acts   := coalesce(jsonb_array_length(public.get_member_activity(o.u, 200)), 0);
      tros   := coalesce(jsonb_array_length(public.get_member_trophies(o.u)), 0);
      return next;
    end loop;
  end loop;
end $$;

select count(*)   as cells,
       sum(blocks) as blocks_visible,
       sum(acts)   as activity_visible,
       sum(tros)   as trophies_visible,
       md5(string_agg(viewer||'>'||owner||':'||blocks||'/'||acts||'/'||tros,
                      '|' order by viewer, owner)) as matrix_md5
from pg_temp.visibility_matrix();

rollback;

-- ── the record ────────────────────────────────────────────────────────────────────
--
-- 30 Oct 2026, current:
--
--   cells 196 · blocks 539 · activity 7,118 · trophies 130
--   md5   8e163d91a6925025e270416c6d387718
--
-- Earlier, from Phase 2 through Phase 3:
--
--   cells 196 · blocks 539 · activity 8,175 · trophies 130
--   md5   35acf6cf835765ff7c914b00e7a3c935
--
--   Phase 2 (ceiling applied on read)      unchanged — every member already sees the members tier
--   Phase 3 (admin read bypasses removed)  unchanged — the admin is friends with 12 of 13
--   movie_visible (group required)         **CHANGED: 8,175 → 7,118**
--
-- ⚠️ THAT LAST LINE IS HERE BECAUSE THIS FILE FIRST SHIPPED SAYING "unchanged", AND RUNNING IT
-- IS WHAT CAUGHT THAT. The number was copied from the Phase 3 measurement and written down
-- without re-measuring after the film change — a recorded figure going stale between the
-- measurement and the sentence, inside the very file whose job is to stop that.
--
-- The cause is worth more than the correction: get_member_activity has a RATING branch, and
-- that branch calls movie_visible. So requiring group membership for a film removed 1,057
-- rating events from this matrix. It was never true that "this matrix does not cover
-- circuit_movies" — it does not count films, but it counts ratings OF them, and a rule about
-- films reaches it through a door one function away.
--
-- ⚠️ AND THE WARNING STILL STANDS IN THE OTHER DIRECTION. This is a member-to-member matrix: it
-- says nothing about anonymous visitors. Phase 2 was a no-op here and still removed a person
-- from the signed-out board. A clean matrix is not a clean site; the public surface
-- (get_public_profile / get_public_activity / circuit_public as anon) is checked separately.
