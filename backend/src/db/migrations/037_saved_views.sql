-- C2E: saved views (docs/CRM_PLAN.md section 2). A view is one user's named
-- filter set inside one campaign; `filters` is the same object GET
-- /api/leads accepts as its query.
CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT saved_views_user_campaign_name_key UNIQUE (user_id, campaign_id, name)
);
CREATE INDEX IF NOT EXISTS idx_saved_views_user_campaign ON saved_views (user_id, campaign_id, position);
