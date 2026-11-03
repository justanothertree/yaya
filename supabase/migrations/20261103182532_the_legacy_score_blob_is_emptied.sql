-- ✅ APPLIED 3 Nov 2026 as `the_legacy_score_blob_is_emptied`.
--
-- Evan's instruction: clear the legacy per-person scores that still rode inside each film row.
--
-- ⚠️ CHECKED BEFORE DELETING, BECAUSE A DELETE IS NOT RECOVERABLE. 469 entries across
-- 154 of 178 films, keyed by circuit_people.id from before ratings became rows. All 469 of 469
-- already have a matching row in `circuit_ratings` for the same film and the same account. This
-- is a duplicate, not a last copy.
--
-- Nothing read it: `supabaseAdapter` fetches the row with `select('*')` and then sets
-- `ratings: {}` with a comment saying the blob survives only so a cached older tab keeps
-- working. So it was being handed to every member who could see a film and ignored on arrival.
--
-- After: 0 films carry scores, 494 rating rows intact. The column stays for the cached-tab
-- reason the adapter gives; dropping it is a later step.

/* ── the per-person scores that still rode inside each film row ──────────────────────────────
   `circuit_movies.ratings` is a jsonb map of circuit_people.id -> score, from before ratings
   became rows. Nothing reads it any more: `supabaseAdapter` fetches the row with `select('*')`
   and then sets `ratings: {}` on purpose, with a comment saying the blob still exists only so a
   cached older tab keeps working. So every member who could see a film was also being handed
   everybody's scores for it, in a column the app ignores.

   ⚠️ MEASURED BEFORE EMPTYING, BECAUSE THIS IS A DELETE AND DELETES ARE NOT RECOVERABLE.
   469 entries across 154 of 178 films. Every one of them -- 469 of 469 -- already has a matching
   row in `circuit_ratings` for the same film and the same account, reached by
   circuit_people.id -> owner_user_id. Nothing here is the only copy of anything.

   The column is left in place rather than dropped: a tab cached before this still asks for it,
   and `{}` is the answer that tab already knows how to handle. Dropping it is a later step, the
   same reasoning the adapter's own comment gives. */
update public.circuit_movies
   set ratings = '{}'::jsonb
 where ratings is not null and ratings <> '{}'::jsonb;
