-- Segment 8 (F-37): inbound texts, STOP / START. Idempotent.
-- Inbound rows keep who sent them and to which number; an inbound row with no
-- lead (unknown sender) is kept, never dropped. keyword_action marks a STOP /
-- START message.
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS from_number TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS to_number TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS keyword_action TEXT;
ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_keyword_action_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_keyword_action_check
  CHECK (keyword_action IS NULL OR keyword_action IN ('opt_out', 'opt_in'));
CREATE INDEX IF NOT EXISTS idx_sms_messages_unmatched ON sms_messages (sent_at) WHERE lead_id IS NULL AND direction = 'inbound';

-- One row per provider message id: a webhook delivered twice is stored and
-- applied once.
CREATE TABLE IF NOT EXISTS sms_inbound_receipts (
  provider_message_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every change to a lead's sms_opt_out, for the timeline.
CREATE TABLE IF NOT EXISTS sms_opt_events (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('opt_out', 'opt_in')),
  source TEXT NOT NULL CHECK (source IN ('inbound_keyword', 'rep')),
  sms_message_id INTEGER REFERENCES sms_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_opt_events_lead ON sms_opt_events (lead_id);
