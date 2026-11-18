-- Segment 9: SMS opt-out by phone number, not only by lead. A STOP-type text
-- adds the sender's number (canonical E.164) whether or not a lead has it;
-- START removes it. A lead created or imported later with a listed number
-- gets sms_opt_out. Never related to DNC. Idempotent.
CREATE TABLE IF NOT EXISTS sms_suppressions (
  phone TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('inbound_keyword', 'rep', 'backfill')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time backfill: the numbers of leads already opted out.
INSERT INTO sms_suppressions (phone, source)
SELECT DISTINCT phone, 'backfill' FROM leads WHERE sms_opt_out = true AND phone IS NOT NULL
ON CONFLICT (phone) DO NOTHING;

-- An opt-out applied because the number is on the list shows on the timeline.
ALTER TABLE sms_opt_events DROP CONSTRAINT IF EXISTS sms_opt_events_source_check;
ALTER TABLE sms_opt_events ADD CONSTRAINT sms_opt_events_source_check
  CHECK (source IN ('inbound_keyword', 'rep', 'suppression_list'));
