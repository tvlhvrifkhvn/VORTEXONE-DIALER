-- Segment 5 (F-09): never lose what was in the phone cell.
-- original_phone keeps the raw text from the import file (always, when there
-- was any), so a number the parser couldn't read is still visible on the lead
-- ("Number unreadable: <raw>") instead of silently becoming "No number".
-- extension holds "x123" / "ext. 123" split off the number.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS original_phone TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS extension TEXT;
