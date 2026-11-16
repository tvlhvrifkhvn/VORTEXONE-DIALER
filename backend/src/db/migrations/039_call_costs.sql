-- C4A: the cost engine's two numbers per call (docs/CRM_PLAN.md section 2).
-- billed_seconds: whole minutes for a connected call (answered or voicemail),
--   0 for one that never connected; fixed once, when the call closes.
-- cost_est_cents: the estimate from the rates in Settings, stored once when
--   rates exist (fractions of a cent kept: real per-minute rates are < 1 cent).
-- Both stay NULL for a failed dial and until they are worked out.
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS billed_seconds INTEGER CHECK (billed_seconds IS NULL OR billed_seconds >= 0);
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS cost_est_cents NUMERIC(12, 4) CHECK (cost_est_cents IS NULL OR cost_est_cents >= 0);
CREATE INDEX IF NOT EXISTS idx_call_history_unsettled ON call_history (id) WHERE ended_at IS NOT NULL AND cost_est_cents IS NULL;
CREATE INDEX IF NOT EXISTS idx_call_history_unbilled ON call_history (id) WHERE ended_at IS NOT NULL AND billed_seconds IS NULL AND telephony_state <> 'failed';
