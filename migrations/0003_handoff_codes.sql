-- Short one-time codes. A signed-in person gets one in the browser and types it into the
-- installed app, which keeps its own separate storage on iPhones and starts signed out.
CREATE TABLE handoff_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_handoff_user ON handoff_codes(user_id);
