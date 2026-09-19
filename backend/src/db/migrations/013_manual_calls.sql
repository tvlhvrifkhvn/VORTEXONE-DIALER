-- Manual dial pad (see AppShell.jsx): an ad-hoc call to a number typed in by
-- the rep, not tied to any lead. lead_id must become nullable to represent
-- that, and the number dialed has to live on call_history itself since
-- there's no lead row to join for it.
ALTER TABLE call_history ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS to_number TEXT;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false;
