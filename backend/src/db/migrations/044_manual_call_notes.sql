-- C8F: the manual dial pad. Live notes on a call (saved as you type, editable
-- until 24 hours after it ends), whether RECORD was switched on (stored; the
-- mock provider records nothing), and the lead note the notes were copied to
-- (so a call's notes reach its lead once, then that note is kept in step).
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS recording BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS notes_note_id INTEGER REFERENCES lead_notes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_call_history_manual_user ON call_history (user_id, started_at DESC) WHERE is_manual;
