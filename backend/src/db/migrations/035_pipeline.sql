-- C2A: the CRM pipeline (docs/CRM_PLAN.md section 2).
-- pipeline_stages per campaign, lead_stage_history, and the lead columns
-- pipeline_stage_id (NOT NULL), deal_value_cents, won_at, lost_reason.
-- leads.status stays the dialer's; pipeline_stage_id is the CRM's (D2).

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open', 'won', 'lost')),
  auto_on TEXT CHECK (auto_on IS NULL OR auto_on = 'contacted'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_stages_campaign_name_key UNIQUE (campaign_id, name),
  -- Target of the leads (pipeline_stage_id, campaign_id) foreign key (I12).
  CONSTRAINT pipeline_stages_id_campaign_key UNIQUE (id, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_campaign ON pipeline_stages (campaign_id, position);
-- Exactly one won, one lost and at most one auto stage per campaign.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_stages_won ON pipeline_stages (campaign_id) WHERE kind = 'won';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_stages_lost ON pipeline_stages (campaign_id) WHERE kind = 'lost';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_stages_auto ON pipeline_stages (campaign_id) WHERE auto_on IS NOT NULL;

CREATE TABLE IF NOT EXISTS lead_stage_history (
  id BIGSERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage_id INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('create', 'import', 'disposition', 'manual', 'undo', 'move', 'bulk')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead ON lead_stage_history (lead_id, created_at);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage_id INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value_cents BIGINT CHECK (deal_value_cents IS NULL OR deal_value_cents >= 0);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Stages for every existing campaign, from its kind's template (the same
-- lists as services/pipeline.js TEMPLATES).
INSERT INTO pipeline_stages (campaign_id, name, position, kind, auto_on)
SELECT c.id, t.name, t.position, t.stage_kind, t.auto_on
FROM campaigns c
JOIN (VALUES
  ('real_estate', 'New', 1, 'open', NULL),
  ('real_estate', 'Contacted', 2, 'open', 'contacted'),
  ('real_estate', 'Interested', 3, 'open', NULL),
  ('real_estate', 'Intro call booked', 4, 'open', NULL),
  ('real_estate', 'Proposal sent', 5, 'open', NULL),
  ('real_estate', 'Client', 6, 'won', NULL),
  ('real_estate', 'Lost', 7, 'lost', NULL),
  ('roofing_supplement', 'New', 1, 'open', NULL),
  ('roofing_supplement', 'Contacted', 2, 'open', 'contacted'),
  ('roofing_supplement', 'Interested', 3, 'open', NULL),
  ('roofing_supplement', 'Sample claim received', 4, 'open', NULL),
  ('roofing_supplement', 'First claim in progress', 5, 'open', NULL),
  ('roofing_supplement', 'Client', 6, 'won', NULL),
  ('roofing_supplement', 'Lost', 7, 'lost', NULL),
  ('custom', 'New', 1, 'open', NULL),
  ('custom', 'Contacted', 2, 'open', 'contacted'),
  ('custom', 'Interested', 3, 'open', NULL),
  ('custom', 'Client', 4, 'won', NULL),
  ('custom', 'Lost', 5, 'lost', NULL)
) AS t(campaign_kind, name, position, stage_kind, auto_on) ON t.campaign_kind = c.kind
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.campaign_id = c.id);

-- Backfill: spoke to someone -> the auto (Contacted) stage; DNC -> Lost
-- with reason "Do not call"; everyone else -> the first stage. No history
-- rows for the backfill.
UPDATE leads l
SET pipeline_stage_id = s.id
FROM pipeline_stages s
WHERE l.pipeline_stage_id IS NULL
  AND s.campaign_id = l.campaign_id
  AND l.status IN ('contacted', 'callback_scheduled')
  AND s.auto_on = 'contacted';

UPDATE leads l
SET pipeline_stage_id = s.id, lost_reason = 'Do not call'
FROM pipeline_stages s
WHERE l.pipeline_stage_id IS NULL
  AND s.campaign_id = l.campaign_id
  AND l.status = 'dnc'
  AND s.kind = 'lost';

UPDATE leads l
SET pipeline_stage_id = f.id
FROM (
  SELECT DISTINCT ON (campaign_id) id, campaign_id
  FROM pipeline_stages
  ORDER BY campaign_id, position, id
) f
WHERE l.pipeline_stage_id IS NULL
  AND f.campaign_id = l.campaign_id;

ALTER TABLE leads ALTER COLUMN pipeline_stage_id SET NOT NULL;
-- I12 in the database: a lead's stage belongs to the lead's campaign.
ALTER TABLE leads ADD CONSTRAINT leads_stage_campaign_fkey
  FOREIGN KEY (pipeline_stage_id, campaign_id) REFERENCES pipeline_stages (id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_stage ON leads (campaign_id, pipeline_stage_id);
