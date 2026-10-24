-- Where each game happens. Everything starts on the terrace.
ALTER TABLE games ADD COLUMN location TEXT NOT NULL DEFAULT 'Terrace';

-- Who is playing a game (the roster organisers build when a game starts)
CREATE TABLE game_players (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id),
  added_at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX idx_game_players_user ON game_players(user_id);

-- Alerts shown to a person in the app (and as phone alerts while the app is open)
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, id);
