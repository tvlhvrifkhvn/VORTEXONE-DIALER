CREATE TABLE IF NOT EXISTS dialing_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  mode VARCHAR(20) DEFAULT 'power',
  total_dials INTEGER DEFAULT 0,
  total_contacts INTEGER DEFAULT 0,
  total_voicemails INTEGER DEFAULT 0,
  total_no_answers INTEGER DEFAULT 0,
  total_callbacks INTEGER DEFAULT 0,
  total_dnc INTEGER DEFAULT 0
);

ALTER TABLE call_history ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES dialing_sessions(id);
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS slot_number INTEGER DEFAULT 1;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS was_abandoned BOOLEAN DEFAULT FALSE;
