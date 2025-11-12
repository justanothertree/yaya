-- Current Supabase schema summary (for Copilot context)

-- Player registry (each unique visitor)
CREATE TABLE player_registry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leaderboard (best score per player)
CREATE TABLE leaderboard (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id BIGINT REFERENCES player_registry(id),
  player_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  game_mode TEXT,
  apples_eaten INTEGER,
  time_elapsed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure one best row per player per mode
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_player_mode_uniq
  ON leaderboard(player_id, game_mode);

-- Score history (all plays, not just best)
CREATE TABLE score_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id BIGINT REFERENCES player_registry(id),
  player_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  game_mode TEXT,
  apples_eaten INTEGER,
  time_elapsed INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trophies (earned awards)
CREATE TABLE trophies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leaderboard_id BIGINT REFERENCES leaderboard(id),
  trophy_name TEXT,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- View (optional)
CREATE OR REPLACE VIEW leaderboard_with_trophies AS
SELECT
  l.id,
  l.player_name,
  l.score,
  l.created_at,
  COALESCE(t.trophy_name, '') AS trophies
FROM leaderboard l
LEFT JOIN trophies t ON t.leaderboard_id = l.id;
