ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_leads_tags ON leads USING GIN (tags);

-- Notes taken mid-call, before (or without) a disposition. These deliberately
-- do NOT live in call_history.note: leadLifecycle.applyDisposition overwrites
-- that column wholesale when a disposition is submitted, which would silently
-- destroy anything typed during the call. Separate rows also let notes
-- accumulate over a single call instead of replacing each other.
CREATE TABLE IF NOT EXISTS lead_notes (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  call_id INTEGER REFERENCES call_history(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id);
