-- C1E: the pitch script and daily goal move from user settings to the campaign.
-- Copies the first supervisor's values into File 01 where File 01 has none.
-- The user_settings rows stay (nothing reads them for these keys after C1E).
WITH sup AS (
  SELECT id FROM users WHERE role = 'supervisor' ORDER BY id LIMIT 1
),
vals AS (
  SELECT
    (SELECT value FROM user_settings WHERE user_id = (SELECT id FROM sup) AND key = 'pitch_script') AS pitch,
    (SELECT value FROM user_settings WHERE user_id = (SELECT id FROM sup) AND key = 'daily_goal') AS goal
)
UPDATE campaigns c
SET pitch_script = CASE WHEN coalesce(trim(c.pitch_script), '') = '' AND coalesce(trim(v.pitch), '') <> ''
                        THEN v.pitch ELSE c.pitch_script END,
    daily_goal = CASE WHEN c.daily_goal IS NULL AND v.goal ~ '^[0-9]{1,6}$' AND v.goal::int BETWEEN 1 AND 100000
                      THEN v.goal::int ELSE c.daily_goal END
FROM vals v
WHERE c.file_number = 1;
