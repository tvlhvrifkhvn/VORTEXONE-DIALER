-- The mock adapter now emits a 'busy' outcome (and Twilio will in phase 2),
-- but telephony_state's original CHECK only allowed the four states that
-- existed then, so recording a busy call failed. Extend the allowed set
-- rather than editing migration 003.
ALTER TABLE call_history DROP CONSTRAINT IF EXISTS call_history_telephony_state_check;
ALTER TABLE call_history ADD CONSTRAINT call_history_telephony_state_check
  CHECK (telephony_state IN ('ringing', 'answered', 'voicemail_detected', 'busy', 'ended'));
