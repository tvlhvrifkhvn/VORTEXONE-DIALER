-- Soft-delete flag for leads, used by the "Delete lead" button in the lead
-- detail panel. A dedicated column (like dnc_flag) rather than overloading
-- the status CHECK constraint with a new enum value.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
