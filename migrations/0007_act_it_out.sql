-- Act It Out: rounds, one turn per team, and a public ranking vote.
-- Each round every team performs in turn. Then everyone ranks the OTHER three teams, best first.
UPDATE games SET
  type = 'actout',
  description = 'A movie scene is shown. Every team acts it out, then everyone ranks the other teams.',
  rules = 'Every round a new movie scene is shown on the screen. Each team gets up to 1 minute to act it out, one team after the other. When all four teams have performed, everyone ranks the three other teams (not their own) from best to worst. Best team gets 2 points, the next two get 1 point each, the last gets 0. There are 5 rounds.'
WHERE slug = 'act-it-out';

CREATE TABLE act_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  scene TEXT,
  phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'performing', 'voting', 'done')),
  phase_ends_at INTEGER,
  UNIQUE (game_id, ord)
);

CREATE TABLE act_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES act_rounds(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'acting', 'done')),
  phase_ends_at INTEGER,
  UNIQUE (round_id, ord)
);

-- One ballot per voter per round: the three other teams, best first
CREATE TABLE act_votes (
  round_id INTEGER NOT NULL REFERENCES act_rounds(id) ON DELETE CASCADE,
  voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_team INTEGER NOT NULL,
  second_team INTEGER NOT NULL,
  third_team INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, voter_id)
);

CREATE TABLE act_results (
  round_id INTEGER NOT NULL REFERENCES act_rounds(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  avg REAL NOT NULL,
  firsts INTEGER NOT NULL,
  ballots INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  points REAL NOT NULL,
  PRIMARY KEY (round_id, team_id)
);

INSERT INTO settings (key, value) VALUES
  ('actout_act_seconds', '60'),
  ('actout_vote_seconds', '60'),
  ('actout_rounds', '5'),
  ('team_rank_points', '[2,1,1,0]');

-- New points for every team game: 1st place 2, 2nd and 3rd 1, 4th 0.
-- Knockout games: semi-final winner 1, final winner 1 more (so the champion has 2).
UPDATE settings SET value = '1' WHERE key IN ('pts_semi_win', 'pts_final_win');
UPDATE settings SET value = '0' WHERE key = 'pts_final_runner_up';
