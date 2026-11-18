-- CRM phase C1A (docs/CRM_PLAN.md section 2): campaigns ("files").
-- Every lead, call, dial session and import job belongs to exactly one
-- campaign; SMS templates and objection types belong to one or are shared
-- (campaign_id NULL). Existing rows all go to File 01 "Real Estate".
-- Runs in one transaction (db/migrate.js): backfill, then NOT NULL.

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  file_number INTEGER NOT NULL UNIQUE CHECK (file_number > 0),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('real_estate', 'roofing_supplement', 'custom')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  company_label TEXT NOT NULL DEFAULT 'Company',
  ai_context TEXT,
  pitch_script TEXT,
  daily_goal INTEGER CHECK (daily_goal IS NULL OR daily_goal > 0),
  default_max_attempts INTEGER CHECK (default_max_attempts IS NULL OR default_max_attempts BETWEEN 1 AND 10),
  monthly_budget_cents INTEGER CHECK (monthly_budget_cents IS NULL OR monthly_budget_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

INSERT INTO campaigns (file_number, name, slug, kind, status, company_label, ai_context)
VALUES (
  1, 'Real Estate', 'real-estate', 'real_estate', 'active', 'Brokerage',
  'Vortexone Agency offers virtual-assistant services (lead follow-up, appointment setting and admin support) to real estate agents in the United States.'
)
ON CONFLICT (file_number) DO NOTHING;

-- Leads, calls, dial sessions, import jobs: one campaign each (I10, I11).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id);
UPDATE leads SET campaign_id = (SELECT id FROM campaigns WHERE file_number = 1) WHERE campaign_id IS NULL;
ALTER TABLE leads ALTER COLUMN campaign_id SET NOT NULL;

ALTER TABLE call_history ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id);
UPDATE call_history SET campaign_id = (SELECT id FROM campaigns WHERE file_number = 1) WHERE campaign_id IS NULL;
ALTER TABLE call_history ALTER COLUMN campaign_id SET NOT NULL;

ALTER TABLE dialing_sessions ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id);
UPDATE dialing_sessions SET campaign_id = (SELECT id FROM campaigns WHERE file_number = 1) WHERE campaign_id IS NULL;
ALTER TABLE dialing_sessions ALTER COLUMN campaign_id SET NOT NULL;

ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id);
UPDATE import_jobs SET campaign_id = (SELECT id FROM campaigns WHERE file_number = 1) WHERE campaign_id IS NULL;
ALTER TABLE import_jobs ALTER COLUMN campaign_id SET NOT NULL;

-- Templates and objection types: a campaign's own, or shared (NULL).
-- Existing ones become File 01's, as the plan says.
ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id);
UPDATE sms_templates SET campaign_id = (SELECT id FROM campaigns WHERE file_number = 1) WHERE campaign_id IS NULL;

ALTER TABLE objection_types ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id);
UPDATE objection_types SET campaign_id = (SELECT id FROM campaigns WHERE file_number = 1) WHERE campaign_id IS NULL;

-- unique (label) becomes two partial unique indexes: one label per campaign,
-- and one label among the shared types. (Plain unique (campaign_id, label)
-- would let two shared rows repeat a label, since NULLs are distinct.)
ALTER TABLE objection_types DROP CONSTRAINT IF EXISTS objection_types_label_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_objection_types_campaign_label
  ON objection_types (campaign_id, label) WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_objection_types_shared_label
  ON objection_types (label) WHERE campaign_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads (campaign_id);
CREATE INDEX IF NOT EXISTS idx_call_history_campaign_started ON call_history (campaign_id, started_at);
