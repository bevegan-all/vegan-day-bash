-- Shark Tank runs turn by turn: idle -> prep -> pitching -> voting -> done.
-- The server stores when each timed phase ends, so every phone shows the same countdown.
ALTER TABLE pitches ADD COLUMN ord INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pitches ADD COLUMN phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'prep', 'pitching', 'voting', 'done'));
ALTER TABLE pitches ADD COLUMN phase_ends_at INTEGER;

UPDATE pitches SET phase = 'done' WHERE state = 'closed';
UPDATE pitches SET phase = 'voting' WHERE state = 'voting';

INSERT INTO settings (key, value) VALUES
  ('shark_prep_seconds', '300'),
  ('shark_pitch_seconds', '180'),
  ('shark_vote_seconds', '60');
