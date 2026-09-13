CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  address TEXT,
  brokerage TEXT,
  state CHAR(2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'in_queue', 'in_progress', 'contacted', 'voicemail', 'no_answer',
    'callback_scheduled', 'no_contact_number', 'no_contact_person', 'dnc', 'cold'
  )),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_action_at TIMESTAMPTZ,
  notes_count INTEGER NOT NULL DEFAULT 0,
  cold_at TIMESTAMPTZ,
  cold_reason TEXT CHECK (cold_reason IN ('max_attempts', 'no_contact_person')),
  dnc_flag BOOLEAN NOT NULL DEFAULT false,
  locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_action_at ON leads(next_action_at);
