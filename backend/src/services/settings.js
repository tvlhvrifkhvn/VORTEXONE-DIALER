const db = require('../db');

/** Simple key/value store backing runtime-configurable settings (e.g. the
 * Groq API key) that shouldn't require editing .env by hand. See CLAUDE.md
 * → "No SQL in route handlers": this is the service layer for routes/settings.js. */
async function getSetting(key) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  const { rows } = await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
     RETURNING key, value, updated_at`,
    [key, value]
  );
  return rows[0];
}

module.exports = { getSetting, setSetting };
