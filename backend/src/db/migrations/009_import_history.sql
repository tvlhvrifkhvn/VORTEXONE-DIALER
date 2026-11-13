CREATE TABLE IF NOT EXISTS import_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  filename VARCHAR(255),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  total_rows INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  skipped_dnc INTEGER DEFAULT 0,
  skipped_duplicate INTEGER DEFAULT 0,
  skipped_invalid INTEGER DEFAULT 0
);
