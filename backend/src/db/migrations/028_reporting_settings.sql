-- Segment 7 (F-34): the reporting day follows the owner's own settings.
--   reporting_timezone: IANA zone for "today" in reports, the dashboard and the PDF
--   day_start_time:     HH:MM; a day runs from this time to the same time next day
-- Seeded once; never overwrites a value the owner has saved. Idempotent.
INSERT INTO settings (key, value, updated_at) VALUES ('reporting_timezone', 'Asia/Karachi', now())
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value, updated_at) VALUES ('day_start_time', '00:00', now())
  ON CONFLICT (key) DO NOTHING;
