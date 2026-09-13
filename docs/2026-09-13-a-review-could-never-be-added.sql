-- ─────────────────────────────────────────────────────────────────────────────
-- Adding a review has been impossible since the friends work. Here is why.
--
-- The symptom: type a title, press save, watch it appear and vanish, and get
-- "Not saved". Postgres says, every time:
--
--     42501: new row violates row-level security policy for table "circuit_movies"
--
-- ⚠️ IT IS THE *SELECT* POLICY THAT REFUSES THE INSERT, which is why it took so long
-- to see. The insert policy is fine and the row is fine:
--
--     circuit_movies_insert  WITH CHECK (circuit_is_member(group_id) OR is_admin())
--
-- Measured against the live database, for the account that reported it: is_admin()
-- true, member of both circuits, not suspended, circuit_is_member(<either group>)
-- true, and circuit_is_member(null) true as well. Every part of that check passes.
--
-- ⚠️ THE DECIDING DIFFERENCE IS `ON CONFLICT`. The same row, same account, same group:
--
--     INSERT ... VALUES (...)                            -> succeeds
--     INSERT ... VALUES (...) ON CONFLICT DO UPDATE ...  -> 42501
--
-- and PostgREST always sends the second form, because supabase-js `.upsert()` asks for
-- `Prefer: resolution=merge-duplicates`. A statement that might update has to satisfy
-- the SELECT policy too — and this table's SELECT policy is:
--
--     circuit_movies_select  USING (movie_visible(id))
--
-- ⚠️ movie_visible LOOKS THE ROW UP IN THE TABLE IT IS GUARDING:
--
--     select exists (select 1 from circuit_movies m where m.id = p_movie and (...))
--
-- For a row that already exists that is merely redundant — id is the primary key, so
-- it re-finds the very row being tested. For a row being INSERTED it is fatal: the row
-- is not there to be found, `exists` is false, and the policy refuses a write that every
-- other rule allowed. No amount of being an admin, a member, or unsuspended can help,
-- because the predicate never gets as far as asking.
--
-- That self-reference arrived with the friends work — movie_visible exists so that
-- somebody can see a film a FRIEND rated, outside any shared circuit — and reviews have
-- not been addable since. It went unnoticed because nothing else takes this path:
-- ratings, logs, pools and watchlist items are all guarded by plain predicates.
--
-- ⚠️ THE FIX CHANGES NO ONE'S VISIBILITY. Inlined below is movie_visible's own body with
-- the self-lookup removed. Because `id` is the primary key, `m.id = p_movie` selected
-- exactly this row, so for every row already in the table the two expressions are the
-- same predicate and return the same answer. They differ only for a row that is not in
-- the table yet — where the old one says "no such row, therefore no" and this one reads
-- the row's own columns, which is the question that was meant to be asked.
--
-- ⚠️ movie_visible ITSELF IS LEFT ALONE. circuit_ratings uses it as
-- `movie_visible(movie_id)`, which is a genuine cross-table lookup and correct. Only the
-- policy that pointed the function back at its own table changes.
--
-- Verified on the live database inside a transaction that was rolled back: with this
-- policy in place the exact upsert PostgREST sends succeeds, the new row is visible
-- afterwards (154 rows -> 155), and nothing was left behind.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists circuit_movies_select on public.circuit_movies;

create policy circuit_movies_select on public.circuit_movies
for select using (
  -- your circuit's reviews
  public.circuit_is_member(group_id)
  -- or one you, or a friend of yours, has rated — the friends case movie_visible exists for
  or exists (
    select 1
    from public.circuit_ratings r
    where r.movie_id = circuit_movies.id
      and (r.user_id = auth.uid() or public.are_friends(auth.uid(), r.user_id))
  )
  or public.is_admin()
);

-- Check it took: adding a review should work again, and this should still return only
-- what you could already see.
--   select count(*) from public.circuit_movies;
