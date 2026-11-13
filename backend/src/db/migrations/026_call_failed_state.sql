-- Segment 5 (F-30): a dial the telephony provider refused is recorded as
-- 'failed' (with ended_at set), instead of staying 'ringing' forever.
ALTER TABLE call_history DROP CONSTRAINT IF EXISTS call_history_telephony_state_check;
ALTER TABLE call_history ADD CONSTRAINT call_history_telephony_state_check
  CHECK (telephony_state IN ('ringing', 'answered', 'voicemail_detected', 'busy', 'ended', 'failed'));
