-- ✅ APPLIED 3 Nov 2026 as `the_film_policy_catches_up_with_the_function`.
--
-- ⚠️ THE RULE LIVED IN TWO PLACES AND ONLY ONE WAS CORRECTED. `movie_visible` lost
-- its "or a friend rated it" clause on 30 Oct, with a long note about a film belonging to the
-- GROUP it was watched in. `circuit_movies_select` -- the policy that actually decides whether a
-- SELECT returns the row -- still had the same clause written out by hand. The function was
-- fixed; the read path was not.
--
-- ⚠️ AND IT WAS NOT A LIVE LEAK, WHICH ONLY THE MEASUREMENT COULD TELL ME. The
-- EXISTS subquery is evaluated with the CALLER'S privileges, so it needed the viewer to be able
-- to read the vouching rating row -- and `circuit_ratings` has its own RLS. Measured as each of
-- the seven outsiders: 0 rating rows readable, so the old clause opened 0 films. A second layer
-- was holding a door the policy text had left open.
--
-- So this restores defence-in-depth rather than closing a hole. Film counts are identical before
-- and after -- 1,246 rows across 14 members -- and the 7 who still see all 178 are 6 group
-- members plus the admin.

/* ⚠️ THE FUNCTION WAS FIXED AND THE POLICY WAS NOT, which is the whole lesson here.
   `movie_visible` had its "or a friend rated it" clause removed on 30 Oct, with a long note
   explaining that a film belongs to the GROUP it was watched in. `circuit_movies_select` --
   the policy that actually decides whether a SELECT returns the row -- still carried the same
   clause, written out by hand:

       circuit_is_member(group_id)
       OR EXISTS (select 1 from circuit_ratings r
                   where r.movie_id = circuit_movies.id
                     and (r.user_id = auth.uid() OR are_friends(auth.uid(), r.user_id)))
       OR is_admin()

   So the rule lived in two places, one of them was corrected, and the uncorrected one was the
   one in the read path. Routing the policy through the function means there is one copy of the
   rule from here on -- which is the only version of this that stays true.

   `r.user_id = auth.uid()` survives inside `movie_visible` on purpose: somebody who leaves a
   group must keep seeing the ratings they wrote, or their own writing vanishes from their own
   screen.

   ⚠️ NO RECURSION, CHECKED RATHER THAN ASSUMED. `movie_visible` selects from `circuit_movies`,
   which is the table this policy is on. It is SECURITY DEFINER and owned by `postgres`, which
   also owns the table, and `relforcerowsecurity` is false -- so inside the function the owner
   bypasses RLS and the policy is not re-entered. */
drop policy if exists circuit_movies_select on public.circuit_movies;
create policy circuit_movies_select on public.circuit_movies
  for select to authenticated
  using (public.movie_visible(id) or public.is_admin());
