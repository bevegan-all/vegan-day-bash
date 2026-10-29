-- Hook Step Challenge: rounds of 10 hook steps, each marked pass or fail by an organiser.
-- Players come from game_players (the shared list); a cap on that list lives in games.config.
UPDATE games SET type = 'hookstep', config = '{}', sort = 160,
  description = 'Ten hook steps per round. An organiser watches you and marks every step pass or fail.',
  rules = 'Each round you perform 10 hook steps while an organiser watches and marks each one pass or fail. After all the rounds, the player with the most correct steps wins. If several players are level at the top they go to a final round, and anyone still level at the end wins together.'
 WHERE slug = 'hook-step-challenge';

CREATE TABLE hs_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('round', 'final')),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'live', 'done')),
  UNIQUE (game_id, ord)
);

-- One person's turn in a round. steps is a string of P (pass) and F (fail), one letter per step so far.
-- Turns of a normal round are created when an organiser starts monitoring; final turns are made ahead ('waiting').
CREATE TABLE hs_turns (
  round_id INTEGER NOT NULL REFERENCES hs_rounds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'live', 'done')),
  monitor_id INTEGER REFERENCES users(id),
  steps TEXT NOT NULL DEFAULT '',
  score INTEGER,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX idx_hs_turns_user ON hs_turns(user_id);
