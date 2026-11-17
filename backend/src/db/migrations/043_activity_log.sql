-- C6C: who changed what. One row per successful POST / PUT / PATCH / DELETE
-- by a logged-in user (middleware/activity.js): the route pattern and ids
-- only, never a request body. Rows older than 180 days are deleted daily.
CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  route TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  status_code INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log (entity_type, entity_id, created_at) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log (user_id, created_at);
