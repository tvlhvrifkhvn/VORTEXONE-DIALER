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
  default_max_attempts: { maxLength: 2 },                // new leads (F-48), see defaultMaxAttempts()
};

// ---- default max attempts (F-48) ----------------------------------------------
// A global setting (supervisor only). It applies to NEW leads (created or
// imported); existing leads keep their own max_attempts. Read only here.
const DEFAULT_MAX_ATTEMPTS = 5; // the leads.max_attempts column default
const MAX_ATTEMPTS_RANGE = [1, 10];
registerValidator('default_max_attempts', (key, value) => {
  const n = Number(value);
  if (value !== null && !(Number.isInteger(n) && n >= MAX_ATTEMPTS_RANGE[0] && n <= MAX_ATTEMPTS_RANGE[1])) {
    throw new ApiError(400, `Default max attempts must be a whole number from ${MAX_ATTEMPTS_RANGE[0]} to ${MAX_ATTEMPTS_RANGE[1]}`);
  }
});

/** max_attempts for a lead being created or imported now. */
async function defaultMaxAttempts() {
  const n = Number(await getSetting('default_max_attempts'));
  return Number.isInteger(n) && n >= MAX_ATTEMPTS_RANGE[0] && n <= MAX_ATTEMPTS_RANGE[1] ? n : DEFAULT_MAX_ATTEMPTS;
}

// ---- per-user preferences (F-48) ------------------------------------------------
// Each user's own; any logged-in user reads and writes their own.
const USER_SETTINGS = {
  daily_goal: { maxLength: 6, check: (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 100000, hint: 'a whole number from 1 to 100000' },
  default_lines: { maxLength: 1, check: (v) => ['1', '2', '3'].includes(v), hint: '1, 2 or 3' },
  pitch_script: { maxLength: 5000 },
  'rebuttal-recalibration-dismissed-month': { maxLength: 7, check: (v) => /^\d{4}-\d{2}$/.test(v), hint: 'YYYY-MM' },
};

async function getUserSettings(userId) {
  const { rows } = await db.query('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]);
  return Object.fromEntries(rows.filter((r) => USER_SETTINGS[r.key]).map((r) => [r.key, r.value]));
}

async function setUserSetting(userId, key, value) {
  const def = USER_SETTINGS[key];
  if (!def) throw new ApiError(400, `Unknown preference "${String(key).slice(0, 100)}"`);
  if (value !== null && typeof value !== 'string') throw new ApiError(400, 'A preference value must be text');
  if (value !== null && value.length > def.maxLength) throw new ApiError(400, `That value is too long (${def.maxLength} characters max)`);
  if (value !== null && def.check && !def.check(value)) throw new ApiError(400, `${key} must be ${def.hint}`);
  await db.query(
    `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = now()`,
    [userId, key, value]
  );
  return getUserSettings(userId);
}

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

module.exports = {
  getSetting, setSetting, onSettingChanged, registerValidator, readForApi, writeFromApi, API_SETTINGS,
  defaultMaxAttempts, getUserSettings, setUserSetting, USER_SETTINGS,
};
