-- C5A: one row per assistant call (ask, summary, and later brief and draft),
-- success or error. tools_called holds tool names and arguments only, never
-- tool results. campaign_id null = all files.
CREATE TABLE IF NOT EXISTS assistant_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ask', 'summary', 'brief', 'draft')),
  question TEXT CHECK (question IS NULL OR char_length(question) <= 1000),
  tools_called JSONB NOT NULL DEFAULT '[]',
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_log_user ON assistant_log (user_id, created_at);
