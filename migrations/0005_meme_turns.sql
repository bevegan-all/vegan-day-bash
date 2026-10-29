-- Meme Charades runs turn by turn. Each team gets the same number of turns, taken alternately.
-- A turn: idle -> acting (timed) -> done, ending in a point or a fail.
-- The meme number is only for organisers (players must never see it, it is the answer).
CREATE TABLE meme_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'acting', 'done')),
  phase_ends_at INTEGER,
  result TEXT CHECK (result IN ('point', 'fail')),
  meme TEXT,
  players TEXT,
  UNIQUE (match_id, ord)
);
CREATE INDEX idx_meme_turns_match ON meme_turns(match_id, ord);

INSERT INTO settings (key, value) VALUES
  ('meme_act_seconds', '60'),
  ('meme_turns_per_team', '5'),
  ('meme_count', '16');

-- The old rules text described the previous round-by-round scoring
UPDATE games SET rules = 'Each team sends 3 players to act out a meme in 1 minute while their own team guesses. If they guess it, the organisers give a point. Each team gets 5 turns, taken one after the other. The team with more points wins.' WHERE slug = 'meme-charades';
