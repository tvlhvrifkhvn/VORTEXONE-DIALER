-- Segment 5 (A.4): imports of any size.
-- An uploaded file's rows are written here in batches as the file is read,
-- instead of being held in memory and copied into import_jobs.source_rows.
-- Processing works through them batch by batch; each row ends with exactly
-- one outcome, so every row of the file is accounted for. Rows that became
-- leads are deleted when the job finishes; skipped rows stay so they can be
-- downloaded.
CREATE TABLE IF NOT EXISTS import_rows (
  id BIGSERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  sheet TEXT NOT NULL,
  row_number INTEGER NOT NULL,   -- data row within the sheet (1 = first row under the header)
  data JSONB NOT NULL,           -- the row exactly as read from the file
  prep JSONB,                    -- the cleaned values (csvImport.prepareRow)
  outcome TEXT CHECK (outcome IN ('imported', 'no_number', 'merged', 'already_in_list', 'dnc_blocked', 'invalid')),
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_import_rows_job ON import_rows (job_id, id);
CREATE INDEX IF NOT EXISTS idx_import_rows_job_name ON import_rows (job_id, (prep->>'nameKey'));

-- The phoneless "already in your list" check (same name + state) runs once
-- per batch; this keeps it an index lookup however many leads exist.
-- (Phone lookups already use the UNIQUE index on leads.phone, and the DNC
-- check the UNIQUE index on dnc_list.phone.)
CREATE INDEX IF NOT EXISTS idx_leads_phoneless_identity ON leads (lower(name), state) WHERE phone IS NULL;
