CREATE TABLE IF NOT EXISTS phone_numbers (
  id SERIAL PRIMARY KEY,
  e164 TEXT NOT NULL UNIQUE,
  area_code TEXT NOT NULL,
  state CHAR(2),
  provider TEXT NOT NULL DEFAULT 'twilio',
  active BOOLEAN NOT NULL DEFAULT true,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
