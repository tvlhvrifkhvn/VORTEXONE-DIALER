const { EventEmitter } = require('events');
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

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

// ---- the settings API (F-47) -------------------------------------------------
// Only these keys can be read or written through /api/settings. Everything
// else is refused (400). secret: write-only, a read gives { configured, last4 }.
// Writes need the supervisor role. Lengths are checked here (400, never a
// database error).
const MAX_KEY_LENGTH = 100;
const API_SETTINGS = {
  calling_hours_enforced: { maxLength: 5 },              // callingHours.js
  'groq-key': { maxLength: 200, secret: true },          // the AI features
  reporting_timezone: { maxLength: 64 },                 // reportingPeriod.js
  day_start_time: { maxLength: 5 },                      // reportingPeriod.js
  'rebuttal-recalibration-dismissed-month': { maxLength: 7 }, // Reports banner
};

function apiSetting(key) {
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) {
    throw new ApiError(400, `Setting names are at most ${MAX_KEY_LENGTH} characters`);
  }
  const def = API_SETTINGS[key];
  if (!def) throw new ApiError(400, `Unknown setting "${key}"`);
  return def;
}

/** What GET /api/settings/:key shows. A secret is never returned. */
async function readForApi(key) {
  const def = apiSetting(key);
  const value = await getSetting(key);
  if (def.secret) {
    const configured = typeof value === 'string' && value.length > 0;
    return { key, configured, last4: configured && value.length >= 8 ? value.slice(-4) : null };
  }
  return { key, value };
}

/** PUT /api/settings/:key: supervisors only; null clears the value. */
async function writeFromApi(key, value, user) {
  const def = apiSetting(key);
  if (!user || user.role !== 'supervisor') throw new ApiError(403, 'Only a supervisor can change settings');
  if (value !== null && typeof value !== 'string') throw new ApiError(400, 'A setting value must be text');
  if (value !== null && value.length > def.maxLength) {
    throw new ApiError(400, `That value is too long (${def.maxLength} characters max)`);
  }
  await setSetting(key, value);
  return readForApi(key);
}

module.exports = { getSetting, setSetting, onSettingChanged, registerValidator, readForApi, writeFromApi, API_SETTINGS };
