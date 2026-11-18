-- Segment 10 (F-44): a new "Regenerate" batch expires the older pending one,
-- so the review list shows only the latest batch. Idempotent.
ALTER TABLE rebuttal_suggestions DROP CONSTRAINT IF EXISTS rebuttal_suggestions_status_check;
ALTER TABLE rebuttal_suggestions ADD CONSTRAINT rebuttal_suggestions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));
