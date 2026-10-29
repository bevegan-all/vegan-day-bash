-- The players acting in a Meme Charades turn, shared by all organisers.
-- One row per person, so several organisers adding people at the same moment cannot overwrite each other.
CREATE TABLE meme_turn_players (
  turn_id INTEGER NOT NULL REFERENCES meme_turns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (turn_id, user_id)
);
