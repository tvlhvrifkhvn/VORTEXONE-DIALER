-- Human review for AI rebuttal suggestions. Nothing reaches the call screen
-- until a person approves it, and approved suggestions become the first-choice
-- few-shot examples for the next generation (see rebuttalCoach.js).
-- 'rejected' keeps a declined suggestion's history instead of deleting it.
ALTER TABLE rebuttal_suggestions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rebuttal_suggestions_type_status
  ON rebuttal_suggestions (objection_type_id, status, generated_at DESC);
