-- Groups agents who work at the same physical office: normalized brokerage
-- + city + state (see utils/officeKey.js). Brand alone is useless as a key —
-- "Keller Williams" exists in every market. NULL when the lead has no
-- brokerage, so brokerage-less leads are never pooled together.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS office_key TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_office_key ON leads(office_key) WHERE office_key IS NOT NULL;
