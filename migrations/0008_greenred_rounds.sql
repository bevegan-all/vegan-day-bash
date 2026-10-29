-- Green Light – Red Light becomes an individual game, with either one round or several heats and a final.
-- Round kinds: 'heat' (a qualifying round) and 'final'. Single-round mode is just one 'final'.
UPDATE games SET kind = 'individual', sort = 100, description = 'Race from point A to point B. Move only while the host is not facing you.',
  rules = 'Race from point A to point B. The host faces away or turns back at random, and you may only move while the host is not facing you. The fastest finishers win. Organisers run it as one round, or as heats where the top 3 of each heat go to the final.' WHERE type = 'greenred';

CREATE TABLE gr_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('heat', 'final')),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'live', 'done')),
  UNIQUE (game_id, ord)
);

-- A person in a round, with their finish time once it is recorded.
-- via: 'manual' (added by an organiser) or 'qualified' (moved up from a heat).
CREATE TABLE gr_entries (
  round_id INTEGER NOT NULL REFERENCES gr_rounds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seconds REAL,
  added_by INTEGER REFERENCES users(id),
  added_at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  via TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX idx_gr_entries_user ON gr_entries(user_id);

INSERT INTO settings (key, value) VALUES ('greenred_points', '[3,2,1]');

-- Practice data from the old layout is kept: it becomes a single-round game
INSERT INTO gr_rounds (game_id, ord, kind, status)
  SELECT id, 1, 'final', 'live' FROM games
   WHERE type = 'greenred'
     AND (EXISTS (SELECT 1 FROM game_players WHERE game_id = games.id)
          OR EXISTS (SELECT 1 FROM results WHERE game_id = games.id AND voided_at IS NULL));
UPDATE games SET config = '{"mode":"single","heats":0}' WHERE type = 'greenred' AND EXISTS (SELECT 1 FROM gr_rounds WHERE game_id = games.id);
INSERT OR IGNORE INTO gr_entries (round_id, user_id, seconds, added_by, added_at, notified, via)
  SELECT r.id, gp.user_id,
         (SELECT x.value FROM results x WHERE x.game_id = gp.game_id AND x.user_id = gp.user_id AND x.voided_at IS NULL ORDER BY x.id DESC LIMIT 1),
         gp.added_by, gp.added_at, 1, 'manual'
    FROM game_players gp JOIN gr_rounds r ON r.game_id = gp.game_id;
INSERT OR IGNORE INTO gr_entries (round_id, user_id, seconds, added_by, added_at, notified, via)
  SELECT r.id, x.user_id, x.value, x.created_by, x.created_at, 1, 'manual'
    FROM results x JOIN gr_rounds r ON r.game_id = x.game_id WHERE x.voided_at IS NULL;
