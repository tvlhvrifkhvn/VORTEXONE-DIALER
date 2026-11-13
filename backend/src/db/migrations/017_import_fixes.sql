-- A scraped agent row can carry a name with no phone. Those leads are real and
-- must stay visible (CLAUDE.md: no lead ever silently disappears) — they just
-- aren't dialable until someone adds a number. Postgres treats multiple NULLs
-- as distinct, so phone's UNIQUE index still works with several phoneless rows.
ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS missing_phone BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_leads_missing_phone ON leads(missing_phone) WHERE missing_phone = TRUE;
