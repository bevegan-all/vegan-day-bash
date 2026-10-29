-- The tournament engine now serves more than one game, so its type is called knockout.
UPDATE games SET type = 'knockout' WHERE type = 'tictactoe';

-- Colour Blind becomes a knockout tournament too: players join while it is live, the bracket is drawn automatically
-- and organisers pick the winner of each match.
UPDATE games SET type = 'knockout', config = '{"state":"registration"}', sort = 130,
  description = 'A knockout tournament of Colour Blind. Do not touch the colour.',
  rules = 'Join from the app while the game is open. When the organisers start it, everyone is matched at random in a knockout bracket. You play one match at a time against one other player, and the winner goes through to the next round, then the quarter-finals, semi-finals and the final. In a match, do not touch the colour: the organiser decides who won.'
 WHERE slug = 'colour-blind';
