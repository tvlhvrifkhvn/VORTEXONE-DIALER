-- Objection tracker: one-tap logging of what an agent pushed back with during
-- a call (services/objectionService.js), plus Groq-generated rebuttal ideas
-- learned from the calls that still went well (services/rebuttalCoach.js).
CREATE TABLE IF NOT EXISTS objection_types (
  id SERIAL PRIMARY KEY,
  label VARCHAR(80) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS call_objections (
  id SERIAL PRIMARY KEY,
  call_id INTEGER REFERENCES call_history(id),
  lead_id INTEGER REFERENCES leads(id),
  objection_type_id INTEGER REFERENCES objection_types(id),
  rebuttal_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A chip on the call screen is a toggle: an objection is either logged on a
-- call or it isn't. This makes a double-tap idempotent so counts can't double.
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_objections_call_type
  ON call_objections(call_id, objection_type_id);
CREATE INDEX IF NOT EXISTS idx_call_objections_type ON call_objections(objection_type_id);
CREATE INDEX IF NOT EXISTS idx_call_objections_created_at ON call_objections(created_at);

CREATE TABLE IF NOT EXISTS rebuttal_suggestions (
  id SERIAL PRIMARY KEY,
  objection_type_id INTEGER REFERENCES objection_types(id),
  suggestion TEXT NOT NULL,
  based_on_count INTEGER,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rebuttal_suggestions_type_time
  ON rebuttal_suggestions(objection_type_id, generated_at DESC);

INSERT INTO objection_types (label, sort_order) VALUES
  ('Already have a VA', 1),
  ('Too expensive', 2),
  ('Not interested', 3),
  ('Call me later', 4),
  ('Send me info', 5),
  ('Too busy right now', 6),
  ('Do it myself', 7),
  ('Bad past experience with VAs', 8)
ON CONFLICT (label) DO NOTHING;
