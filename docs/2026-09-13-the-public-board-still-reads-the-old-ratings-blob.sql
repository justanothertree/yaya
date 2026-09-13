-- ─────────────────────────────────────────────────────────────────────────────
-- circuit_public() is what a signed-out visitor actually sees in the Circuit and in
-- Ratings. Three things were wrong with it, and only the first was noticed.
--
-- ⚠️ 1. IT NEVER SELECTED `kind`. Reviews have carried a category for months — movie,
-- food, beer, drink, restaurant, game, music, or anything somebody types — and this
-- built each movie from id/title/date/rt only. So every review a visitor sees reads as a
-- film: a game sits under a column headed "Movie", and the category chips never appear
-- because the board only ever sees one kind. The watchlist had it too, which is why every
-- option in the public pool wears the 🎬 emoji.
--
-- ⚠️ 2. IT READS THE DEAD RATINGS BLOB. `m.ratings` is the jsonb column that ratings
-- lived in before they became rows in circuit_ratings — the adapter's rowToMovie has said
-- "EMPTY ON PURPOSE, and the rows are folded in where the board renders" since that move.
-- Nothing has written the blob since. So the public board's scores are frozen at whenever
-- the migration ran, and every rating given since is invisible to visitors no matter how
-- fresh the bundled fallback is.
--
-- The two sources are merged here rather than swapped, in the same order the client uses
-- (see useMoviesWithRatings): the blob is the base and the rows are laid over it with
-- `||`, so a person rated in both places gets their current score and nothing that only
-- ever existed in the blob is lost. If the blob is genuinely redundant this changes
-- nothing; if it is not, nothing disappears. Dropping the column is a separate decision.
--
-- ⚠️ KEYED BY PERSON, NOT ACCOUNT. Ratings rows are keyed by account id; the people in
-- this payload carry circuit_people.id and no owner, so the client's ratersIn falls back
-- to person.id. A payload keyed by account would line up with nobody and silently show an
-- empty board. The join maps each row back through circuit_people.owner_user_id.
--
-- ⚠️ SCORE ONLY. A rating row also carries icons and a review object — sentiment, tags, a
-- written hot-take. That is somebody's writing about films watched with their friends, and
-- an anon-callable function is the last place to start handing it out. The demo needs a
-- number to draw a board with. This matches what the bundled slice ships.
--
-- ⚠️ 3. IT SENT `votes`, WHICH IS ALSO DEAD. Pool votes became rows in pool_votes (see
-- docs/2026-09-05-pools-belong-to-friends.sql) and WatchlistItem has no votes field any
-- more, so the client already ignored it. Dropped rather than left in a public payload.
--
-- Unchanged: who is visible at all. Only people who set their circuit to 'public' appear,
-- only their logs, only their ratings, and a review is included only if a public person
-- has rated it. Same gate, more of the columns it was always meant to return.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.circuit_public()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with pub as (
    select id, owner_user_id from circuit_people where visibility = 'public'
  )
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'color', p.color, 'goal', p.goal,
        'exercises', p.exercises, 'colLabels', p.col_labels) order by p.name)
      from circuit_people p where p.visibility = 'public'), '[]'::jsonb),

    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'personId', l.person_id, 'date', l.date, 'entries', l.entries, 'img', l.img))
      from circuit_logs l where l.person_id in (select id from pub)), '[]'::jsonb),

    'movies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'kind', m.kind, 'date', m.date, 'rt', m.rt,
        'ratings',
          -- the legacy blob, filtered to public people …
          coalesce((
            select jsonb_object_agg(k, m.ratings->k)
            from jsonb_object_keys(m.ratings) k
            where k in (select id from pub)), '{}'::jsonb)
          ||
          -- … with today's rows laid over it, mapped from account back to person id
          coalesce((
            select jsonb_object_agg(p.id, jsonb_build_object('score', r.score))
            from circuit_ratings r
            join pub p on p.owner_user_id = r.user_id
            where r.movie_id = m.id), '{}'::jsonb)
      ))
      from circuit_movies m
      where exists (
              select 1 from jsonb_object_keys(m.ratings) k where k in (select id from pub))
         or exists (
              select 1 from circuit_ratings r
              join pub p on p.owner_user_id = r.user_id
              where r.movie_id = m.id)
    ), '[]'::jsonb),

    'watchlist', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'kind', w.kind, 'rt', w.rt))
      from circuit_watchlist w
    ), '[]'::jsonb)
  );
$function$;

-- Check it took — expect a mix of kinds rather than only 'movie', and a review count that
-- matches what is actually rated today:
--   select jsonb_array_length(circuit_public()->'movies') as reviews,
--          (select jsonb_agg(distinct x->>'kind')
--             from jsonb_array_elements(circuit_public()->'movies') x) as kinds;
