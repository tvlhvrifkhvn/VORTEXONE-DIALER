-- C6B: merging duplicate leads. The merged (secondary) lead is soft-deleted
-- and points at the lead it was merged into. The stage history gets a
-- 'merge' source for the primary's row when a DNC secondary makes it lost.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS merged_into INTEGER REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_merged_into ON leads (merged_into) WHERE merged_into IS NOT NULL;

ALTER TABLE lead_stage_history DROP CONSTRAINT IF EXISTS lead_stage_history_source_check;
ALTER TABLE lead_stage_history ADD CONSTRAINT lead_stage_history_source_check
  CHECK (source IN ('create', 'import', 'disposition', 'manual', 'undo', 'move', 'bulk', 'merge'));

-- Duplicate finding (services/duplicates.js): normalized email and name.
CREATE INDEX IF NOT EXISTS idx_leads_email_norm ON leads (lower(btrim(email))) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_name_norm ON leads (lower(btrim(name))) WHERE deleted_at IS NULL;
