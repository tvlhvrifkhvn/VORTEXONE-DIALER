-- Segment 9 (F-48): per-user preferences that used to live only in one
-- browser's localStorage (daily goal, default lines, pitch script, the
-- Reports reminder). Idempotent.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key VARCHAR(64) NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
