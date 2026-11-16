-- C2C: per-campaign custom fields (docs/CRM_PLAN.md section 2) and the
-- lead's values for them, keyed by campaign_fields.key.
CREATE TABLE IF NOT EXISTS campaign_fields (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'boolean')),
  options JSONB NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL,
  show_in_list BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_fields_campaign_key_key UNIQUE (campaign_id, key)
);
CREATE INDEX IF NOT EXISTS idx_campaign_fields_campaign ON campaign_fields (campaign_id, position);

-- A constant default: no table rewrite, existing leads read as {}.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom JSONB NOT NULL DEFAULT '{}';
