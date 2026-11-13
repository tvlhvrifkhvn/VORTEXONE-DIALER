CREATE TABLE IF NOT EXISTS import_jobs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  filename VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  total_rows INTEGER DEFAULT 0,
  processed_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  result_summary JSONB,
  error_message TEXT,
  cancelled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  -- Parsed rows and the confirmed mapping live on the job itself, so
  -- processing never depends on the uploading request (or the browser tab)
  -- still being around. Not in the original spec's column list, but the
  -- background-job architecture it asks for doesn't work without them.
  source_rows JSONB,
  mapping JSONB
);
