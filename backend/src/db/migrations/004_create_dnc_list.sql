CREATE TABLE IF NOT EXISTS dnc_list (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'imported')),
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dnc_list_phone ON dnc_list(phone);
