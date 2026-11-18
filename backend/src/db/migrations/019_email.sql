-- Phase-2-Twilio pattern, mirrored for email: mock now (mockEmailAdapter.js),
-- sendgridAdapter.js drops in later behind the same sendEmail(to, subject,
-- body) signature — see telephony/emailIndex.js.
CREATE TABLE IF NOT EXISTS email_messages (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES leads(id),
  direction VARCHAR(10) DEFAULT 'outbound',
  subject TEXT,
  body TEXT,
  status VARCHAR(20) DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_lead ON email_messages(lead_id);
