const { EventEmitter } = require('events');
const db = require('../db');

// Services that cache a setting (callingHours) subscribe here, so a change
// saved through setSetting() applies at once instead of after their cache expires.
const changes = new EventEmitter();
function onSettingChanged(key, listener) {
  changes.on(key, listener);
}

/** Simple key/value store backing runtime-configurable settings (e.g. the
 * Groq API key) that shouldn't require editing .env by hand. See CLAUDE.md
 * → "No SQL in route handlers": this is the service layer for routes/settings.js. */
async function getSetting(key) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

// Settings with a fixed format are checked here (400 on a bad value).
// Registered by the service that owns them (reportingPeriod).
const validators = new Map();
function registerValidator(key, fn) {
  validators.set(key, fn);
}

async function setSetting(key, value) {
  if (validators.has(key)) validators.get(key)(key, value);
  const { rows } = await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
     RETURNING key, value, updated_at`,
    [key, value]
  );
  changes.emit(key, rows[0].value);
  return rows[0];
}

module.exports = { getSetting, setSetting, onSettingChanged, registerValidator };
