-- =====================================================
-- supabase-triggers.sql
-- =====================================================
-- Trigger functions and trigger bindings.
-- Prevents leaderboard score regression.
-- =====================================================


-- -----------------------------------------------------
-- FUNCTION: enforce_best_score() RETURNS trigger
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_best_score()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  SET search_path = public;

  IF NEW.score < OLD.score THEN
    NEW.score := OLD.score;
  END IF;

  RETURN NEW;
END;
$function$;


-- -----------------------------------------------------
-- FUNCTION: enforce_best_score(p_player_id, p_game_mode)
-- -----------------------------------------------------
-- Manual safety utility (RPC-compatible)
CREATE OR REPLACE FUNCTION public.enforce_best_score(
  p_player_id integer,
  p_game_mode text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  SET search_path = public;

  UPDATE leaderboard
  SET score = GREATEST(
    score,
    (
      SELECT MAX(score)
      FROM score_history
      WHERE player_id = p_player_id
        AND game_mode = COALESCE(p_game_mode, 'survival')
    )
  )
  WHERE player_id = p_player_id
    AND game_mode = COALESCE(p_game_mode, 'survival');
END;
$function$;


-- -----------------------------------------------------
-- TRIGGER: leaderboard_best_score
-- -----------------------------------------------------
-- BEFORE UPDATE ON leaderboard
-- Enforces monotonic score increases
CREATE TRIGGER leaderboard_best_score
BEFORE UPDATE ON public.leaderboard
FOR EACH ROW
EXECUTE FUNCTION enforce_best_score();
