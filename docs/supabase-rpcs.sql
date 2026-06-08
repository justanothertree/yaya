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
  v_total_players int;
  v_max_trophy_place int;
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

  -- Total number of distinct participants in this finalized round
  SELECT COUNT(*) INTO v_total_players FROM tmp_rank;

  -- Trophy thresholds by lobby size:
  -- 1 player   -> no trophies      (place <= 0)
  -- 2 players  -> gold only        (place <= 1)
  -- 3 players  -> gold + silver    (place <= 2)
  -- 4+ players -> gold + silver + bronze (place <= 3)
  IF v_total_players <= 1 THEN
    v_max_trophy_place := 0;
  ELSIF v_total_players = 2 THEN
    v_max_trophy_place := 1;
  ELSIF v_total_players = 3 THEN
    v_max_trophy_place := 2;
  ELSE
    v_max_trophy_place := 3;
  END IF;

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
      created_at = leaderboard.created_at
    RETURNING id INTO v_leaderboard_id;

    -- Award trophies based on placement and lobby size
    IF v_leaderboard_id IS NOT NULL
       AND i.place IS NOT NULL
       AND i.place <= v_max_trophy_place THEN
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


-- =====================================================
-- FINANCE SCHEMA PROXY RPCs (public)
-- =====================================================
-- Why:
--   PostgREST in this project is configured to only expose schemas:
--   - public
--   - graphql_public
--
--   The finance tables live in the `finance` schema, so direct calls like
--   `from('finance.family_accounts')` or `schema('finance')` will fail with:
--     PGRST106: The schema must be one of the following: public, graphql_public
--
-- Security model:
--   - Functions live in `public` so they are reachable via supabase.rpc(...)
--   - All functions enforce auth.uid() (must be signed in)
--   - User-scoped functions also enforce uid == auth.uid()
--   - Finance tables should keep RLS (user_id = auth.uid())
--
-- NOTE ON INSERTS:
--   Avoid jsonb_populate_record(...).* here — it can pass NULLs into columns
--   that would otherwise use DEFAULT values (e.g., created_at), causing NOT NULL
--   violations or unexpected null writes.
-- =====================================================


-- -----------------------------------------------------
-- FAMILY ACCOUNTS
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_family_accounts(uid uuid)
RETURNS SETOF finance.family_accounts
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN QUERY
    SELECT *
    FROM finance.family_accounts
    WHERE user_id = uid;
END;
$function$;


-- NOTE:
--   These insert RPCs derive ownership from auth.uid() internally.
--   The (uid uuid, payload jsonb) overload is kept for frontend compatibility,
--   but uid is NOT used for ownership.

CREATE OR REPLACE FUNCTION public.insert_family_account(payload jsonb)
RETURNS finance.family_accounts
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v jsonb := COALESCE(payload, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_display_name text;
  out_row finance.family_accounts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_display_name := NULLIF(BTRIM(v->>'display_name'), '');
  IF v_display_name IS NULL THEN
    RAISE EXCEPTION 'display_name is required';
  END IF;

  INSERT INTO finance.family_accounts (user_id, display_name, created_at)
  VALUES (v_uid, v_display_name, now())
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.insert_family_account(uid uuid, payload jsonb)
RETURNS finance.family_accounts
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Kept only to catch accidental misuse; ownership comes from auth.uid().
  IF uid IS NOT NULL AND uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN public.insert_family_account(payload);
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_family_account(uid uuid, account_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  DELETE FROM finance.family_accounts
  WHERE user_id = uid AND id = account_id;
END;
$function$;


-- -----------------------------------------------------
-- EXECUTED TRADES
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_executed_trades(uid uuid)
RETURNS SETOF finance.executed_trades
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN QUERY
    SELECT *
    FROM finance.executed_trades
    WHERE user_id = uid;
END;
$function$;


CREATE OR REPLACE FUNCTION public.insert_executed_trade(payload jsonb)
RETURNS finance.executed_trades
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v jsonb := COALESCE(payload, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_asset_symbol text;
  v_asset_type text;
  v_platform text;
  v_execution_time timestamptz;
  v_dollar_amount numeric;
  v_price numeric;
  v_units_acquired numeric;
  v_fee numeric;
  out_row finance.executed_trades;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_asset_symbol := NULLIF(BTRIM(v->>'asset_symbol'), '');
  IF v_asset_symbol IS NULL THEN
    RAISE EXCEPTION 'asset_symbol is required';
  END IF;

  v_asset_type := NULLIF(BTRIM(v->>'asset_type'), '');
  v_platform := NULLIF(BTRIM(v->>'platform'), '');
  v_execution_time := COALESCE(NULLIF(v->>'execution_time', '')::timestamptz, now());

  v_price := NULLIF(v->>'price', '')::numeric;
  v_units_acquired := NULLIF(v->>'units_acquired', '')::numeric;
  v_fee := COALESCE(NULLIF(v->>'fee', '')::numeric, 0);

  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'price must be > 0';
  END IF;
  IF v_units_acquired IS NULL OR v_units_acquired <= 0 THEN
    RAISE EXCEPTION 'units_acquired must be > 0';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'fee must be >= 0';
  END IF;

  -- If dollar_amount is omitted, compute a reasonable default.
  v_dollar_amount := COALESCE(NULLIF(v->>'dollar_amount', '')::numeric, (v_price * v_units_acquired) + v_fee);
  IF v_dollar_amount <= 0 THEN
    RAISE EXCEPTION 'dollar_amount must be > 0';
  END IF;

  INSERT INTO finance.executed_trades (
    user_id,
    asset_symbol,
    asset_type,
    platform,
    execution_time,
    dollar_amount,
    price,
    units_acquired,
    fee,
    created_at
  )
  VALUES (
    v_uid,
    v_asset_symbol,
    v_asset_type,
    v_platform,
    v_execution_time,
    v_dollar_amount,
    v_price,
    v_units_acquired,
    v_fee,
    now()
  )
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.insert_trade_even_split(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v jsonb := COALESCE(payload, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_asset_symbol text;
  v_asset_type text;
  v_platform text;
  v_execution_time timestamptz;
  v_dollar_amount numeric;
  v_price numeric;
  v_units_acquired numeric;
  v_fee numeric;
  v_account_count int;
  v_per_account_units numeric;
  v_inserted_allocations int := 0;
  v_running_allocated_units numeric := 0;
  v_units_for_row numeric;
  v_trade finance.executed_trades;
  r_account record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_asset_symbol := NULLIF(BTRIM(v->>'asset_symbol'), '');
  IF v_asset_symbol IS NULL THEN
    RAISE EXCEPTION 'asset_symbol is required';
  END IF;

  v_asset_type := NULLIF(BTRIM(v->>'asset_type'), '');
  v_platform := NULLIF(BTRIM(v->>'platform'), '');
  v_execution_time := COALESCE(NULLIF(v->>'execution_time', '')::timestamptz, now());

  v_price := NULLIF(v->>'price', '')::numeric;
  v_units_acquired := NULLIF(v->>'units_acquired', '')::numeric;
  v_fee := COALESCE(NULLIF(v->>'fee', '')::numeric, 0);

  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'price must be > 0';
  END IF;
  IF v_units_acquired IS NULL OR v_units_acquired <= 0 THEN
    RAISE EXCEPTION 'units_acquired must be > 0';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'fee must be >= 0';
  END IF;

  v_dollar_amount := COALESCE(NULLIF(v->>'dollar_amount', '')::numeric, (v_price * v_units_acquired) + v_fee);
  IF v_dollar_amount <= 0 THEN
    RAISE EXCEPTION 'dollar_amount must be > 0';
  END IF;

  SELECT COUNT(*)
  INTO v_account_count
  FROM finance.family_accounts
  WHERE user_id = v_uid;

  IF v_account_count <= 0 THEN
    RAISE EXCEPTION 'No family accounts found for this user';
  END IF;

  INSERT INTO finance.executed_trades (
    user_id,
    asset_symbol,
    asset_type,
    platform,
    execution_time,
    dollar_amount,
    price,
    units_acquired,
    fee,
    created_at
  )
  VALUES (
    v_uid,
    v_asset_symbol,
    v_asset_type,
    v_platform,
    v_execution_time,
    v_dollar_amount,
    v_price,
    v_units_acquired,
    v_fee,
    now()
  )
  RETURNING * INTO v_trade;

  v_per_account_units := v_units_acquired / v_account_count::numeric;

  FOR r_account IN
    SELECT id
    FROM finance.family_accounts
    WHERE user_id = v_uid
    ORDER BY created_at ASC, id ASC
  LOOP
    IF v_inserted_allocations = v_account_count - 1 THEN
      -- Keep exact equality with the original trade units on the last row.
      v_units_for_row := v_units_acquired - v_running_allocated_units;
    ELSE
      v_units_for_row := v_per_account_units;
    END IF;

    IF v_units_for_row <= 0 THEN
      RAISE EXCEPTION 'Computed per-account units must be > 0';
    END IF;

    INSERT INTO finance.allocations (user_id, family_account_id, executed_trade_id, units_allocated, created_at)
    VALUES (v_uid, r_account.id, v_trade.id, v_units_for_row, now());

    v_inserted_allocations := v_inserted_allocations + 1;
    v_running_allocated_units := v_running_allocated_units + v_units_for_row;
  END LOOP;

  RETURN jsonb_build_object(
    'trade_id', v_trade.id,
    'asset_symbol', v_trade.asset_symbol,
    'execution_time', v_trade.execution_time,
    'units_acquired', v_trade.units_acquired,
    'dollar_amount', v_trade.dollar_amount,
    'account_count', v_account_count,
    'units_per_account', v_per_account_units,
    'allocation_count', v_inserted_allocations
  );
END;
$function$;


CREATE TABLE IF NOT EXISTS finance.scheduled_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  payload jsonb NOT NULL,
  schedule_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  executed_trade_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT scheduled_trades_status_check CHECK (status IN ('pending', 'processing', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_trades_user ON finance.scheduled_trades (user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_trades_pending_time
  ON finance.scheduled_trades (status, schedule_at);


CREATE OR REPLACE FUNCTION public.schedule_trade_even_split(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v jsonb := COALESCE(payload, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_schedule_at timestamptz;
  v_row finance.scheduled_trades;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_schedule_at := NULLIF(v->>'schedule_at', '')::timestamptz;
  IF v_schedule_at IS NULL THEN
    RAISE EXCEPTION 'schedule_at is required';
  END IF;

  -- Reuse existing validation rules by requiring these keys up-front.
  IF NULLIF(BTRIM(v->>'asset_symbol'), '') IS NULL THEN
    RAISE EXCEPTION 'asset_symbol is required';
  END IF;
  IF NULLIF(v->>'price', '')::numeric IS NULL OR NULLIF(v->>'price', '')::numeric <= 0 THEN
    RAISE EXCEPTION 'price must be > 0';
  END IF;
  IF NULLIF(v->>'units_acquired', '')::numeric IS NULL OR NULLIF(v->>'units_acquired', '')::numeric <= 0 THEN
    RAISE EXCEPTION 'units_acquired must be > 0';
  END IF;

  INSERT INTO finance.scheduled_trades (user_id, payload, schedule_at, status, created_at, updated_at)
  VALUES (v_uid, v - 'schedule_at', v_schedule_at, 'pending', now(), now())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'user_id', v_row.user_id,
    'schedule_at', v_row.schedule_at,
    'status', v_row.status,
    'created_at', v_row.created_at
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.run_due_scheduled_trades(limit_count int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  r record;
  v_processed int := 0;
  v_done int := 0;
  v_failed int := 0;
  v_trade_result jsonb;
  v_trade_id uuid;
BEGIN
  FOR r IN
    SELECT st.*
    FROM finance.scheduled_trades st
    WHERE st.status = 'pending'
      AND st.schedule_at <= now()
    ORDER BY st.schedule_at ASC
    LIMIT GREATEST(1, COALESCE(limit_count, 100))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    UPDATE finance.scheduled_trades
    SET status = 'processing',
        attempts = attempts + 1,
        updated_at = now(),
        last_error = NULL
    WHERE id = r.id;

    BEGIN
      -- Execute in the scheduled trade owner's context safely via direct insert logic.
      PERFORM 1
      FROM finance.family_accounts fa
      WHERE fa.user_id = r.user_id
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No family accounts found for scheduled trade user';
      END IF;

      -- Use same behavior as insert_trade_even_split but with explicit user ownership.
      WITH inserted_trade AS (
        INSERT INTO finance.executed_trades (
          user_id,
          asset_symbol,
          asset_type,
          platform,
          execution_time,
          dollar_amount,
          price,
          units_acquired,
          fee,
          created_at
        )
        VALUES (
          r.user_id,
          NULLIF(BTRIM(r.payload->>'asset_symbol'), ''),
          NULLIF(BTRIM(r.payload->>'asset_type'), ''),
          NULLIF(BTRIM(r.payload->>'platform'), ''),
          COALESCE(NULLIF(r.payload->>'execution_time', '')::timestamptz, r.schedule_at),
          COALESCE(
            NULLIF(r.payload->>'dollar_amount', '')::numeric,
            (NULLIF(r.payload->>'price', '')::numeric * NULLIF(r.payload->>'units_acquired', '')::numeric)
            + COALESCE(NULLIF(r.payload->>'fee', '')::numeric, 0)
          ),
          NULLIF(r.payload->>'price', '')::numeric,
          NULLIF(r.payload->>'units_acquired', '')::numeric,
          COALESCE(NULLIF(r.payload->>'fee', '')::numeric, 0),
          now()
        )
        RETURNING id, user_id, units_acquired
      ),
      account_list AS (
        SELECT fa.id, row_number() OVER (ORDER BY fa.created_at ASC, fa.id ASC) AS rn, count(*) OVER () AS cnt
        FROM finance.family_accounts fa
        JOIN inserted_trade it ON it.user_id = fa.user_id
      ),
      alloc_base AS (
        SELECT
          al.id AS family_account_id,
          it.id AS executed_trade_id,
          it.user_id,
          it.units_acquired,
          al.rn,
          al.cnt,
          (it.units_acquired / al.cnt::numeric) AS per_units
        FROM account_list al
        CROSS JOIN inserted_trade it
      ),
      allocations_insert AS (
        INSERT INTO finance.allocations (user_id, family_account_id, executed_trade_id, units_allocated, created_at)
        SELECT
          ab.user_id,
          ab.family_account_id,
          ab.executed_trade_id,
          CASE
            WHEN ab.rn = ab.cnt THEN ab.units_acquired - (ab.per_units * (ab.cnt - 1))
            ELSE ab.per_units
          END,
          now()
        FROM alloc_base ab
      )
      SELECT jsonb_build_object('trade_id', it.id)
      INTO v_trade_result
      FROM inserted_trade it;

      v_trade_id := NULLIF(v_trade_result->>'trade_id', '')::uuid;

      UPDATE finance.scheduled_trades
      SET status = 'done',
          executed_at = now(),
          updated_at = now(),
          executed_trade_id = v_trade_id,
          last_error = NULL
      WHERE id = r.id;

      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE finance.scheduled_trades
      SET status = 'failed',
          updated_at = now(),
          last_error = SQLERRM
      WHERE id = r.id;

      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'done', v_done,
    'failed', v_failed
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.insert_executed_trade(uid uuid, payload jsonb)
RETURNS finance.executed_trades
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NOT NULL AND uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN public.insert_executed_trade(payload);
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_executed_trade(uid uuid, trade_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  DELETE FROM finance.executed_trades
  WHERE user_id = uid AND id = trade_id;
END;
$function$;


-- -----------------------------------------------------
-- ALLOCATIONS
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_allocations(uid uuid)
RETURNS SETOF finance.allocations
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN QUERY
    SELECT *
    FROM finance.allocations
    WHERE user_id = uid;
END;
$function$;


CREATE OR REPLACE FUNCTION public.insert_allocation(payload jsonb)
RETURNS finance.allocations
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v jsonb := COALESCE(payload, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_family_account_id uuid;
  v_executed_trade_id uuid;
  v_units_allocated numeric;
  out_row finance.allocations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_family_account_id := NULLIF(v->>'family_account_id', '')::uuid;
  v_executed_trade_id := NULLIF(v->>'executed_trade_id', '')::uuid;
  v_units_allocated := NULLIF(v->>'units_allocated', '')::numeric;

  IF v_family_account_id IS NULL THEN
    RAISE EXCEPTION 'family_account_id is required';
  END IF;
  IF v_executed_trade_id IS NULL THEN
    RAISE EXCEPTION 'executed_trade_id is required';
  END IF;
  IF v_units_allocated IS NULL OR v_units_allocated <= 0 THEN
    RAISE EXCEPTION 'units_allocated must be > 0';
  END IF;

  -- Ownership check: the family account must belong to this user.
  -- Prevents a caller from attaching allocations to another user's account.
  IF NOT EXISTS (
    SELECT 1 FROM finance.family_accounts
    WHERE id = v_family_account_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'family_account_id not found or does not belong to you';
  END IF;

  -- Ownership check: the executed trade must belong to this user.
  -- Prevents a caller from pointing allocations at another user's trade record.
  IF NOT EXISTS (
    SELECT 1 FROM finance.executed_trades
    WHERE id = v_executed_trade_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'executed_trade_id not found or does not belong to you';
  END IF;

  INSERT INTO finance.allocations (user_id, family_account_id, executed_trade_id, units_allocated, created_at)
  VALUES (v_uid, v_family_account_id, v_executed_trade_id, v_units_allocated, now())
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.insert_allocation(uid uuid, payload jsonb)
RETURNS finance.allocations
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NOT NULL AND uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  RETURN public.insert_allocation(payload);
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_allocation(uid uuid, allocation_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF uid IS NULL OR uid <> auth.uid() THEN
    RAISE EXCEPTION 'uid mismatch';
  END IF;

  DELETE FROM finance.allocations
  WHERE user_id = uid AND id = allocation_id;
END;
$function$;


-- =====================================================
-- ADMIN CONTROLS
-- =====================================================
-- Goal:
--   Allow admins to manage family accounts for other users securely.
--
-- Role source of truth:
--   This implementation expects a table:
--     public.users(id uuid primary key references auth.users(id), is_admin boolean)
--
-- If you already have a different table/column, adapt public.is_admin().
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE((SELECT u.is_admin FROM public.users u WHERE u.id = auth.uid()), false);
$$;


CREATE OR REPLACE FUNCTION public.admin_get_family_accounts(target_uid uuid)
RETURNS SETOF finance.family_accounts
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'target_uid is required';
  END IF;

  RETURN QUERY
    SELECT *
    FROM finance.family_accounts
    WHERE user_id = target_uid;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_insert_family_account(target_uid uuid, payload jsonb)
RETURNS finance.family_accounts
LANGUAGE plpgsql
VOLATILE
AS $function$
DECLARE
  v jsonb := COALESCE(payload, '{}'::jsonb);
  v_account_name text;
  v_balances jsonb;
  out_row finance.family_accounts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'target_uid is required';
  END IF;

  v_account_name := NULLIF(BTRIM(COALESCE(v->>'account_name', v->>'name')), '');
  IF v_account_name IS NULL THEN
    RAISE EXCEPTION 'account_name is required';
  END IF;

  v_balances := COALESCE(v->'balances', v->'balance');

  INSERT INTO finance.family_accounts (user_id, account_name, balances)
  VALUES (target_uid, v_account_name, v_balances)
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.admin_delete_family_account(target_uid uuid, account_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'target_uid is required';
  END IF;

  DELETE FROM finance.family_accounts
  WHERE user_id = target_uid AND id = account_id;
END;
$function$;


-- -----------------------------------------------------
-- Permissions (finance + admin)
-- -----------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.get_family_accounts(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_family_account(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_family_account(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_family_account(uuid, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_executed_trades(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_executed_trade(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_executed_trade(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_trade_even_split(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.schedule_trade_even_split(jsonb) FROM PUBLIC;
-- run_due_scheduled_trades must NOT be callable by regular authenticated users.
-- It executes queued trades for ALL users and must only be invoked by the
-- server-side scheduler using the service role key.
REVOKE EXECUTE ON FUNCTION public.run_due_scheduled_trades(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_due_scheduled_trades(int) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_executed_trade(uuid, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_allocations(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_allocation(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_allocation(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_allocation(uuid, uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_family_accounts(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_insert_family_account(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_family_account(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_family_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_family_account(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_family_account(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_family_account(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_executed_trades(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_executed_trade(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_executed_trade(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_trade_even_split(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_trade_even_split(jsonb) TO authenticated;
-- run_due_scheduled_trades is intentionally NOT granted to authenticated.
-- The server-side scheduler calls it via the service role key, which bypasses
-- this grant check. No browser client should ever call this directly.
GRANT EXECUTE ON FUNCTION public.delete_executed_trade(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_allocations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_allocation(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_allocation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_allocation(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_family_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_insert_family_account(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_family_account(uuid, uuid) TO authenticated;


-- =====================================================
-- REQUIRED TABLES / RLS (ADMIN)
-- =====================================================
-- The admin RPCs above intentionally run as SECURITY INVOKER so that RLS remains
-- the enforcing mechanism.
--
-- 1) Role source-of-truth table (public.users)
--
-- CREATE TABLE IF NOT EXISTS public.users (
--   id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
--   is_admin boolean NOT NULL DEFAULT false,
--   created_at timestamptz NOT NULL DEFAULT now()
-- );
--
-- ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--
-- -- Users can read their own admin flag (nothing else)
-- CREATE POLICY "users_read_own_row" ON public.users
-- FOR SELECT TO authenticated
-- USING (id = auth.uid());
--
-- 2) Finance admin policies (keep existing per-user policies too)
--
-- -- Allow admins to manage any family account rows
-- CREATE POLICY "admin_select_family_accounts" ON finance.family_accounts
-- FOR SELECT TO authenticated
-- USING (public.is_admin());
--
-- CREATE POLICY "admin_insert_family_accounts" ON finance.family_accounts
-- FOR INSERT TO authenticated
-- WITH CHECK (public.is_admin());
--
-- CREATE POLICY "admin_delete_family_accounts" ON finance.family_accounts
-- FOR DELETE TO authenticated
-- USING (public.is_admin());
--
-- Once you set your own user row to is_admin=true, the Investments Admin UI will appear.
