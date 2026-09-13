CREATE TABLE IF NOT EXISTS callbacks (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_callbacks_lead_id ON callbacks(lead_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_scheduled_at ON callbacks(scheduled_at);
