-- Segment 5 (F-08 / F-11): an import reports two phases — "cleaning" (rows
-- read and checked) then "saving" (rows written in batches, one transaction
-- each). saved_rows / written_leads only move when a batch has committed, so
-- progress and the cancel answer never run ahead of what is in the database.
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS rows_to_save INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS saved_rows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS written_leads INTEGER NOT NULL DEFAULT 0;
