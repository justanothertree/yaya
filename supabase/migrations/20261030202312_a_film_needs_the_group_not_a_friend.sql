-- ✅ APPLIED 30 Oct 2026 as `a_film_needs_the_group_not_a_friend`.
--
-- ⚠️ SEVEN MEMBERS COULD EACH SEE 83 OF A PRIVATE GROUP'S 163 FILMS, AND NONE OF THEM HAD EVER
-- BEEN IN IT. `movie_visible` ended `or are_friends(auth.uid(), r.user_id)` — a film reached you
-- because somebody you know rated it. Measured before removing it: five of the seven are in no
-- circuit group at all, and the other two are in a group that holds no films. The chain was one
-- person: Evan is friends with everyone and rated 83, so his friendships were republishing The
-- Crew's catalogue to people who were never invited to it.
--
-- It is the same mistake `circuit_public()` had on the signed-out board, one layer in: a film
-- belongs to the GROUP it was watched in, not to whoever happened to rate it. Fixing the public
-- board and leaving this alone would have closed the door and left the window.
--
-- ⚠️ AND THE INSERT POLICY IS WHY IT COMPOUNDED RATHER THAN SAT STILL. `circuit_ratings_insert`
-- checks `movie_visible` too, so a non-member could not merely SEE a group's film — they could
-- RATE it, and their rating then carried it to their own friends by the same clause. Both
-- policies route through this one function, so both are fixed by this one change; neither
-- policy needed editing.
--
-- ⚠️ `r.user_id = auth.uid()` STAYS. Somebody who leaves a group, or whose person is removed
-- from it, must keep seeing the ratings they wrote — otherwise their own writing vanishes from
-- their own screen. Nobody relies on it today, which is exactly when it is cheap to get right,
-- and it was proved rather than assumed: with a rating inserted for a member who has none, the
-- films he can see go 0 → 1 and he can read that rating back.
--
-- Measured across all 14 members, before → after:
--   the 7 in The Crew          163 → 163   (unchanged)
--   the other 7                 83 →   0
--
-- Those seven now see an empty Ratings room. That is the honest answer — none of them has rated
-- anything, and none of them is in a group with films — and the way to give them one is a group
-- of their own or an invitation to this one, not a clause that leaks somebody else's.

create or replace function public.movie_visible(p_movie text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  /* ⚠️ A FILM NEEDS THE GROUP, NOT A FRIEND. This used to end
         or are_friends(auth.uid(), r.user_id)
     so a film reached you because somebody you know rated it -- even if you had never been in
     the group that watched it. Measured before removing it: SEVEN members could each see 83 of
     The Crew's 163 films that way. Five of them are in no circuit group at all; the other two
     are in a group that holds no films. The chain was one person: Evan is friends with everyone
     and rated 83, so his friendships were quietly republishing a private group's catalogue to
     people who had never been invited to it.

     It is the same mistake `circuit_public()` had on the signed-out board, one layer in: a film
     belongs to the GROUP it was watched in, not to whoever happened to rate it.

     ⚠️ AND THE INSERT POLICY IS WHY THIS MATTERED MORE THAN A READ. `circuit_ratings_insert`
     checks `movie_visible` too, so a non-member could not merely SEE a group's film, they could
     RATE it -- and their rating then carried it on to their own friends by the same clause. The
     leak compounded rather than sat still. Both policies route through this one function, so
     both are fixed here.

     ⚠️ `r.user_id = auth.uid()` STAYS, and it is not decoration. Somebody who leaves a group, or
     whose person is removed from it, must keep seeing the ratings they wrote -- otherwise their
     own writing disappears from their own screen. Nobody is relying on it today (all seven of
     the affected members have rated nothing), which is exactly when it is cheap to get right. */
  select exists (
    select 1 from public.circuit_movies m
    where m.id = p_movie
      and (
        public.circuit_is_member(m.group_id)
        or exists (
          select 1 from public.circuit_ratings r
          where r.movie_id = m.id and r.user_id = auth.uid())
      )
  );
$function$;
