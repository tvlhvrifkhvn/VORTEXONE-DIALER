-- C3A: tasks (docs/CRM_PLAN.md section 2). A task belongs to a campaign and
-- usually to a lead; done_at null = open.
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'call' CHECK (type IN ('call', 'email', 'text', 'other')),
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  done_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'disposition')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_open_due ON tasks (campaign_id, due_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks (lead_id, created_at);
