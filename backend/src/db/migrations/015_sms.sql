ALTER TABLE leads ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sms_templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('outbound','inbound')),
  body TEXT NOT NULL,
  template_id INTEGER REFERENCES sms_templates(id),
  status VARCHAR(20) DEFAULT 'sent',
  is_read BOOLEAN DEFAULT FALSE,
  segment_count INTEGER DEFAULT 1,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_lead ON sms_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_unread ON sms_messages(is_read) WHERE direction = 'inbound' AND is_read = FALSE;
