-- Paper Cup Flip Tic-Tac-Toe becomes a knockout tournament: players join while the game is live,
-- the organiser starts it, the bracket is drawn automatically and winners move on round by round.
UPDATE games SET type = 'tictactoe', config = '{"state":"registration"}', sort = 110,
  description = 'A knockout tic-tac-toe tournament. Flip the paper cup right to earn the right to place your mark.',
  rules = 'Join from the app while the game is open. When the organisers start it, everyone is matched at random in a knockout bracket. You play one match at a time and the winner goes through to the next round, then the quarter-finals, semi-finals and the final. In a match you may place a mark only after you flip your paper cup the right way up.'
 WHERE slug = 'cup-flip-tic-tac-toe';

-- Players are kept in game_players. One row per match of the bracket: round 1 is the first round, the last round is the final.
-- Winners move into slot (slot / 2) of the next round, as side a when the slot is even and side b when it is odd.
CREATE TABLE ttt_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  a_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  b_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'live', 'done')),
  bye INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  UNIQUE (game_id, round, slot)
);
