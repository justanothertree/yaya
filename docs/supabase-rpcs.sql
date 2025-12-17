-- =====================================================
-- supabase-rpcs.sql
-- =====================================================
-- Authoritative definitions of public RPC functions.
-- Used by client + ws-server integration.
--
-- ❗ DO NOT EXECUTE AUTOMATICALLY
-- ❗ Reference-only snapshot
--
-- Schema: public
-- =====================================================


-- -----------------------------------------------------
-- FUNCTION: finalize_round_rpc
-- -----------------------------------------------------
-- Purpose:
--   Canonically finalizes a multiplayer round.
--   Idempotent per (room_id, round_id).
--
-- Inputs:
--   p_room_id   TEXT
--   p_round_id  TEXT
--   p_game_mode TEXT
--   p_items     JSONB  -- [{ id, name, score, finishIdx }]
--   p_players   JSONB  -- optional (currently unused)
--
-- Returns:
--   JSONB array of ordered results:
--   [{ id, name, score, place }, ...]
--
-- Guarantees:
--   - Exactly one row in round_results per round
--   - Leaderboard best-score enforcement
--   - Score history append-only
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_round_rpc(
  p_room_id text,
  p_round_id text,
  p_game_mode text,
  p_items jsonb,
  p_players jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  existing jsonb;
  rec record;
  results_items jsonb := '[]'::jsonb;
  i record;
  v_leaderboard_id bigint;
BEGIN
  SET search_path = public;

  -- Idempotency check
  SELECT results INTO existing
  FROM round_results
  WHERE room_id = p_room_id
    AND round_id = p_round_id;

  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  CREATE TEMP TABLE tmp_items (
    id text,
    name text,
    score int,
    finish_idx int
  ) ON COMMIT DROP;

  INSERT INTO tmp_items(id, name, score, finish_idx)
  SELECT
    (elem->>'id')::text,
    trim(coalesce(elem->>'name', 'Player')),
    coalesce((elem->>'score')::int, 0),
    coalesce((elem->>'finishIdx')::int, 9999)
  FROM jsonb_array_elements(p_items) AS elem;

  DELETE FROM tmp_items WHERE score < 0;

  CREATE TEMP TABLE tmp_rank AS
  WITH base AS (
    SELECT id, name, score, finish_idx
    FROM tmp_items
    ORDER BY score DESC, finish_idx ASC
  ),
  ranked AS (
    SELECT
      id, name, score, finish_idx,
      dense_rank() OVER (ORDER BY score DESC) AS place
    FROM base
  )
  SELECT * FROM ranked;

  FOR i IN (SELECT * FROM tmp_rank) LOOP

    INSERT INTO player_registry(player_name)
    VALUES (i.name)
    ON CONFLICT (player_name) DO NOTHING;

    SELECT id INTO rec
    FROM player_registry
    WHERE player_name = i.name;

    INSERT INTO score_history(
      player_id, player_name, score, game_mode,
      apples_eaten, time_elapsed, created_at
    )
    VALUES (
      rec.id, i.name, i.score,
      COALESCE(p_game_mode, 'survival'),
      NULL, NULL, NOW()
    );

    INSERT INTO leaderboard(
      player_id, player_name, score, game_mode, created_at
    )
    VALUES (
      rec.id, i.name, i.score,
      COALESCE(p_game_mode, 'survival'),
      NOW()
    )
    ON CONFLICT (player_id, game_mode)
    DO UPDATE SET
      score = GREATEST(leaderboard.score, EXCLUDED.score),
      player_name = EXCLUDED.player_name,
      created_at = leaderboard.created_at;

    -- Resolve leaderboard row id for trophy linkage
    SELECT id
    INTO v_leaderboard_id
    FROM leaderboard
    WHERE player_id = rec.id
      AND game_mode = COALESCE(p_game_mode, 'survival')
    ORDER BY score DESC, created_at ASC
    LIMIT 1;

    -- Award trophies for top 3 placements in this finalized round
    IF v_leaderboard_id IS NOT NULL AND i.place IS NOT NULL AND i.place <= 3 THEN
      INSERT INTO trophies(leaderboard_id, trophy_name)
      VALUES (
        v_leaderboard_id,
        CASE
          WHEN i.place = 1 THEN 'gold'
          WHEN i.place = 2 THEN 'silver'
          ELSE 'bronze'
        END
      );
    END IF;

  END LOOP;

  results_items := (
    SELECT jsonb_agg(j)
    FROM (
      SELECT jsonb_build_object(
        'id', id,
        'name', name,
        'score', score,
        'place', place
      ) AS j
      FROM tmp_rank
      ORDER BY place ASC, score DESC, finish_idx ASC
    ) sub
  );

  INSERT INTO round_results(room_id, round_id, game_mode, results)
  VALUES (
    p_room_id,
    p_round_id,
    COALESCE(p_game_mode, 'survival'),
    results_items
  );

  RETURN results_items;
END;
$function$;
