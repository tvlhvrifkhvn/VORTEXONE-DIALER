-- Segment 6 (F-18): every time zone a lead could be in, from its phone's area
-- code, its address and its state (services/callingHours.js zonesForLead).
-- The dialer only calls when all of them are inside 8am-9pm.
--   {}   = time zone unknown: never dialed while calling hours are enforced
--   NULL = not worked out yet: the server fills these in at startup and before
--          each queue read (leadQueue.backfillZones)
-- Idempotent.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tz_zones TEXT[];
CREATE INDEX IF NOT EXISTS idx_leads_tz_zones_missing ON leads (id) WHERE tz_zones IS NULL;
