-- C6A: which reminders a user has been shown, so GET /api/tasks/due-soon
-- doesn't repeat one the same day. One row per user, item and due time: a
-- task or callback moved to a new time reminds again.
CREATE TABLE IF NOT EXISTS reminder_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'callback')),
  ref_id INTEGER NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  reminded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id, due_at)
);
CREATE INDEX IF NOT EXISTS idx_reminder_log_user ON reminder_log (user_id, reminded_at);
