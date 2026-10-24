-- Teams
CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL
);
INSERT INTO teams (id, name, emoji, color) VALUES
  (1, 'Cow',     '🐄', '#2563eb'),
  (2, 'Chicken', '🐔', '#f59e0b'),
  (3, 'Goat',    '🐐', '#16a34a'),
  (4, 'Pig',     '🐖', '#ec4899');

-- Users (participants, organisers, admins)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'organiser', 'admin')),
  team_id INTEGER REFERENCES teams(id),
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  party_id TEXT,
  checked_in INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_users_party ON users(party_id);

-- QR sign-in links (token stored hashed)
CREATE TABLE login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_tokens_user ON login_tokens(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- sha256 of the cookie value
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Games. type: meme | greenred | shark | activity | individual
-- result_type (individual only): match_win | score_high | time_high | time_low | placement
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('team', 'individual')),
  type TEXT NOT NULL,
  result_type TEXT,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('draft', 'upcoming', 'live', 'closed')),
  sort INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}'
);

-- Individual results. value meaning depends on game result_type.
CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  value REAL NOT NULL,
  match_ref TEXT,
  note TEXT,
  idem TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  voided_at INTEGER
);
CREATE INDEX idx_results_game ON results(game_id, voided_at);
CREATE INDEX idx_results_user ON results(user_id);

-- Team points ledger (append only; corrections void a row)
CREATE TABLE team_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  points REAL NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  voided_at INTEGER
);
CREATE INDEX idx_team_points_game ON team_points(game_id, voided_at);
CREATE INDEX idx_team_points_ref ON team_points(ref);

-- Matches (Meme Charades and Shark Tank brackets). stage: semi1 | semi2 | final
CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  team_a INTEGER NOT NULL REFERENCES teams(id),
  team_b INTEGER REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'live', 'done')),
  winner_team INTEGER REFERENCES teams(id),
  UNIQUE (game_id, stage)
);

-- Meme Charades: correct guesses per team per round
CREATE TABLE meme_rounds (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  correct INTEGER NOT NULL,
  PRIMARY KEY (match_id, round, team_id)
);

-- Shark Tank: one pitch per team per match, rated by the audience
CREATE TABLE pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  item TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'voting', 'closed')),
  votes INTEGER NOT NULL DEFAULT 0,
  avg REAL,
  UNIQUE (match_id, team_id)
);

CREATE TABLE pitch_votes (
  pitch_id INTEGER NOT NULL REFERENCES pitches(id) ON DELETE CASCADE,
  voter_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pitch_id, voter_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('shark_block_opponent', '0'),
  ('shark_min_votes', '0'),
  ('individual_to_team', '0'),
  ('rank_points', '[10,8,6,4,4,4,4,4,4,4]'),
  ('participation_points', '1'),
  ('pts_semi_win', '5'),
  ('pts_final_win', '10'),
  ('pts_final_runner_up', '3'),
  ('pts_greenred_winner', '10'),
  ('pts_greenred_cleared', '1');

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

-- Games
INSERT INTO games (slug, name, kind, type, result_type, description, rules, status, sort) VALUES
  ('meme-charades', 'Meme Charades', 'team', 'meme', NULL,
   'Act out the meme and let your team guess.',
   '1 min to decide the meme, 1 min to act it out. 5 rounds. The team with the most correct guesses wins.', 'upcoming', 10),
  ('green-light-red-light', 'Green Light – Red Light', 'team', 'greenred', NULL,
   'Everyone plays together from point A to point B.',
   'The host faces away or turns back at random. You may only move while the host is not facing you. Rounds continue until one winner is left.', 'upcoming', 20),
  ('shark-tank', 'Shark Tank', 'team', 'shark', NULL,
   'Pitch your veggie or fruit like the next big startup.',
   '5 minutes to prep, 3 minutes to pitch. The audience rates every pitch, except your own team.', 'upcoming', 30),
  ('act-it-out', 'Act it Out', 'team', 'activity', NULL,
   'A random movie scene is shown. Act it out as precisely as possible.',
   'Just for fun. No winner or loser.', 'upcoming', 40),
  ('cup-flip-tic-tac-toe', 'Paper Cup Flip Tic-Tac-Toe', 'individual', 'individual', 'match_win',
   '1 v 1 tic-tac-toe where you only get to play after flipping the cup correctly.',
   'You can place a mark only when you flip the paper cup right.', 'upcoming', 110),
  ('arm-wrestling', 'Arm Wrestling', 'individual', 'individual', 'match_win',
   '1 v 1 arm wrestling.', 'Best of one. Winner takes the point.', 'upcoming', 120),
  ('colour-blind', 'Colour Blind', 'individual', 'individual', 'score_high',
   'Do not touch the colour.', 'Score is the number of correct taps. Your best score counts.', 'upcoming', 130),
  ('paper-dance', 'Paper Dance', 'individual', 'individual', 'placement',
   'Dance on the paper and keep shrinking the space.', 'Last one standing wins.', 'upcoming', 140),
  ('stay-in-the-square', 'Stay in the Square', 'individual', 'individual', 'time_high',
   'Stay on the paper square while jogging.', 'Longest time in the square wins. Time is in seconds.', 'upcoming', 150),
  ('hook-step-challenge', 'Hook Step Challenge', 'individual', 'individual', 'score_high',
   'Nail the hook step.', 'Organisers give you a score out of 10.', 'upcoming', 160),
  ('blindfold-animals', 'Blindfold: Find Your Animal', 'team', 'activity', NULL,
   'Backup game: find your animal team by sound.', 'Blindfolded players find their team using animal sounds.', 'draft', 910),
  ('random-activity', 'Random Person, Random Activity', 'team', 'activity', NULL,
   'Backup game: a random person gets a random activity.', 'Just for fun.', 'draft', 920);
