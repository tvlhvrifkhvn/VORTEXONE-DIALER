-- Call recording plumbing (Phase 2 fills recording_url via Twilio's webhook).
-- to_number/is_manual already exist (013_manual_calls.sql) — IF NOT EXISTS
-- guards keep this safe to combine with that migration's columns anyway.
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS was_recorded BOOLEAN DEFAULT FALSE;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS to_number VARCHAR(20);
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE;
