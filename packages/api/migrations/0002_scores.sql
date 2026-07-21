-- Game leaderboard scores (public read, admin write)
CREATE TABLE scores (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  ms INTEGER NOT NULL CHECK (ms > 0),
  player_name TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_scores_game_ms ON scores(game, ms);
CREATE INDEX idx_scores_game_created ON scores(game, created_at DESC);
