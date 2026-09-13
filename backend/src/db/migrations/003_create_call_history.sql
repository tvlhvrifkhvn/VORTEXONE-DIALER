CREATE TABLE IF NOT EXISTS call_history (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  disposition TEXT CHECK (disposition IN (
    'contacted', 'voicemail', 'no_answer', 'no_contact_number', 'no_contact_person', 'dnc',
    'callback_scheduled'
  )),
  note TEXT,
  from_number TEXT,
  was_mock BOOLEAN NOT NULL DEFAULT true,
  -- live progress for the call screen to poll, driven by telephony adapter events
  telephony_state TEXT NOT NULL DEFAULT 'ringing' CHECK (telephony_state IN (
    'ringing', 'answered', 'voicemail_detected', 'ended'
  )),
  telephony_call_id TEXT,
  -- undo support: snapshot of the lead row immediately before this disposition
  -- was applied, and when it was applied, so the 10s undo window can restore it
  pre_disposition_snapshot JSONB,
  disposition_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_history_lead_id ON call_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_history_started_at ON call_history(started_at);
