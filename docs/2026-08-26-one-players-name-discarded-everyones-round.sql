-- A name in the wrong case threw away the whole round.   2026-08-26
--   migration: finalize_round_rpc_case_insensitive_registry_lookup
--
-- ── the failure ──────────────────────────────────────────────────────────────
-- Reported as "⚠️ Not saved to the leaderboard (rejected-400)" after a 1v1. Reproduced exactly:
--
--   ERROR: null value in column "player_id" of relation "score_history"
--          violates not-null constraint
--   DETAIL: Failing row contains (401, yaya, 6, race, null, null, ...)
--
-- The player is registered as `YAYA`. They played as `yaya`.
--
-- ⚠️ AND IT DISCARDED THE ROUND FOR EVERYONE, not just for them. The write happens inside a
-- loop over all participants, so one unresolvable name raised out of the whole function: no
-- scores, no leaderboard, no trophies and no round_results row for anybody in that game. The
-- other player did nothing wrong and lost their result too.
--
-- ── why the lookup missed ────────────────────────────────────────────────────
-- `player_registry.player_name` carries a CASE-INSENSITIVE collation — that is what the index
-- `ux_player_registry_name_ci` is for — so a plain query really does match:
--
--   select id from player_registry where player_name = 'yaya';   -- => 1, i.e. YAYA
--
-- But inside this function the name arrives from `tmp_items`, a TEMP TABLE whose `name text`
-- column was declared without a collation and therefore carries the database default, which is
-- case-sensitive. Comparing the two columns resolves to that default, so the same comparison
-- that matches from the SQL editor misses here. v_reg_id stays NULL, the guarded insert path
-- believes the name is new, `ON CONFLICT DO NOTHING` swallows the collision with the row that
-- does exist, the re-select misses for the same reason, and NULL reaches a NOT NULL column.
--
-- ⚠️ So the bug was invisible from every angle that looked reasonable: the column IS
-- case-insensitive, the index IS there, and a hand-written query DOES find the row. Only the
-- comparison inside the function behaves differently, because of where one side came from.
--
-- ── the fix ──────────────────────────────────────────────────────────────────
-- 1. lower() on both sides. Deterministic whatever collation either side carries, and it no
--    longer depends on a temp table's declaration matching a real table's.
-- 2. ⚠️ A participant that still cannot be resolved is SKIPPED, not fatal. Their placement is
--    already in the results; what they must never do is take everyone else's round with them.
--    This is the part that matters most: the case bug is one way to reach a null registry id,
--    and this makes sure the next way costs one row instead of the game.
-- 3. The REGISTERED spelling is written to score_history and leaderboard when one exists.
--    Otherwise the leaderboard's `player_name = EXCLUDED.player_name` would rewrite YAYA's board
--    entry to whatever case they happened to type that evening.
--
-- ── verified ─────────────────────────────────────────────────────────────────
-- In rolled-back transactions against production, using the exact round that failed:
--   * before: 'yaya' + 'Player277' raised 23502 and wrote nothing at all
--   * after:  the same round writes both scores, both leaderboard rows and the round row
--   * 'YAYA' in its registered case still behaves exactly as it did
--   * an unresolvable participant no longer aborts the round — the others are still credited
--   * the board keeps the registered spelling rather than the typed one

create or replace function public.finalize_round_rpc(
  p_room_id text, p_round_id text, p_game_mode text, p_items jsonb, p_players jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  existing jsonb;
  results_items jsonb := '[]'::jsonb;
  i record;
  v_reg_id bigint;
  v_owner uuid;
  v_name text;
  v_claimed_by_someone_else boolean;
  v_leaderboard_id bigint;
  v_total_players int;
  v_max_trophy_place int;
  v_max_score constant int := 1000000;
BEGIN
  SELECT results INTO existing
  FROM round_results
  WHERE room_id = p_room_id AND round_id = p_round_id;

  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  DROP TABLE IF EXISTS tmp_items;
  DROP TABLE IF EXISTS tmp_claims;
  DROP TABLE IF EXISTS tmp_rank;

  CREATE TEMP TABLE tmp_items (id text, name text, score int, finish_idx int) ON COMMIT DROP;

  INSERT INTO tmp_items(id, name, score, finish_idx)
  SELECT
    (elem->>'id')::text,
    trim(coalesce(elem->>'name', 'Player')),
    least(coalesce((elem->>'score')::int, 0), v_max_score),
    coalesce((elem->>'finishIdx')::int, 9999)
  FROM jsonb_array_elements(p_items) AS elem;

  DELETE FROM tmp_items WHERE score < 0;

  CREATE TEMP TABLE tmp_claims (id text, user_id uuid) ON COMMIT DROP;
  INSERT INTO tmp_claims(id, user_id)
  SELECT (elem->>'id')::text,
         CASE WHEN (elem->>'userId') ~ '^[0-9a-fA-F-]{36}$' THEN (elem->>'userId')::uuid END
  FROM jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) AS elem;

  CREATE TEMP TABLE tmp_rank ON COMMIT DROP AS
  WITH base AS (
    SELECT id, name, score, finish_idx FROM tmp_items ORDER BY score DESC, finish_idx ASC
  ),
  ranked AS (
    SELECT id, name, score, finish_idx, dense_rank() OVER (ORDER BY score DESC) AS place FROM base
  )
  SELECT * FROM ranked;

  SELECT COUNT(*) INTO v_total_players FROM tmp_rank;

  IF v_total_players <= 1 THEN v_max_trophy_place := 0;
  ELSIF v_total_players = 2 THEN v_max_trophy_place := 1;
  ELSIF v_total_players = 3 THEN v_max_trophy_place := 2;
  ELSE v_max_trophy_place := 3;
  END IF;

  FOR i IN (SELECT * FROM tmp_rank) LOOP

    -- ⚠️ lower() on BOTH sides. player_registry.player_name is case-insensitive by collation;
    -- tmp_items.name is not, and comparing them resolved to the case-sensitive default, so
    -- `yaya` failed to find `YAYA` and the round died on a NOT NULL violation.
    SELECT r.id, r.user_id, r.player_name INTO v_reg_id, v_owner, v_name
    FROM player_registry r WHERE lower(r.player_name) = lower(i.name);

    -- an account is behind this name and nobody vouched for the player using it
    v_claimed_by_someone_else := v_owner IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tmp_claims c WHERE c.id = i.id AND c.user_id = v_owner);

    IF v_claimed_by_someone_else THEN
      CONTINUE;  -- placement still counts; nothing is written against their account
    END IF;

    IF v_reg_id IS NULL THEN
      INSERT INTO player_registry(player_name) VALUES (i.name)
      ON CONFLICT (player_name) DO NOTHING;
      SELECT r.id, r.player_name INTO v_reg_id, v_name
      FROM player_registry r WHERE lower(r.player_name) = lower(i.name);
    END IF;

    -- ⚠️ Skip, never raise. A participant whose registry row cannot be resolved must not take
    -- the whole round down with them: everyone else's scores, trophies and the round_results
    -- row all live inside this loop. Their placement is already in the returned results.
    IF v_reg_id IS NULL THEN
      CONTINUE;
    END IF;

    -- the registered spelling, so the board is not renamed to whatever case was typed tonight
    v_name := coalesce(v_name, i.name);

    INSERT INTO score_history(player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
    VALUES (v_reg_id, v_name, i.score, COALESCE(p_game_mode, 'survival'), NULL, NULL, NOW());

    INSERT INTO leaderboard(player_id, player_name, score, game_mode, created_at)
    VALUES (v_reg_id, v_name, i.score, COALESCE(p_game_mode, 'survival'), NOW())
    ON CONFLICT (player_id, game_mode)
    DO UPDATE SET
      score = GREATEST(leaderboard.score, EXCLUDED.score),
      player_name = EXCLUDED.player_name,
      created_at = leaderboard.created_at
    RETURNING id INTO v_leaderboard_id;

    IF v_leaderboard_id IS NOT NULL AND i.place IS NOT NULL AND i.place <= v_max_trophy_place THEN
      INSERT INTO trophies(leaderboard_id, trophy_name)
      VALUES (v_leaderboard_id,
        CASE WHEN i.place = 1 THEN 'gold' WHEN i.place = 2 THEN 'silver' ELSE 'bronze' END);
    END IF;

  END LOOP;

  results_items := (
    SELECT jsonb_agg(j) FROM (
      SELECT jsonb_build_object('id', id, 'name', name, 'score', score, 'place', place) AS j
      FROM tmp_rank ORDER BY place ASC, score DESC, finish_idx ASC
    ) sub
  );

  INSERT INTO round_results(room_id, round_id, game_mode, results)
  VALUES (p_room_id, p_round_id, COALESCE(p_game_mode, 'survival'), results_items);

  RETURN results_items;
END;
$function$;
