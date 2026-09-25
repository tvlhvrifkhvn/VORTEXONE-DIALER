const { ApiError } = require('../middleware/errorHandler');
const settingsStore = require('./settings');

const CALLING_HOURS_START = 8; // 8am inclusive
const CALLING_HOURS_END = 21; // 9pm exclusive
const ENFORCEMENT_SETTING_KEY = 'calling_hours_enforced';

// Testing-phase toggle (Settings → Dialing defaults → "Enforce calling
// hours"), default OFF. isWithinCallingHours/assertCallingHours are called
// synchronously from leadQueue.js (including inside an Array.find predicate,
// which can't await), so this is a self-refreshing in-memory cache rather
// than an async settings lookup — that keeps both exported functions'
// signatures unchanged and leadQueue.js untouched. Cost: up to
// CACHE_REFRESH_MS of staleness after flipping the toggle before dialing
// behavior picks it up.
const CACHE_REFRESH_MS = 5000;
let cachedEnforced = false;
let lastRefreshAt = 0;
let refreshInFlight = false;

function refreshEnforcedCache() {
  const now = Date.now();
  if (refreshInFlight || now - lastRefreshAt < CACHE_REFRESH_MS) return;
  refreshInFlight = true;
  settingsStore
    .getSetting(ENFORCEMENT_SETTING_KEY)
    .then((value) => {
      cachedEnforced = value === 'true';
    })
    .catch(() => {
      // Leave the cached value as-is on a transient DB hiccup rather than
      // flipping enforcement on/off from an error.
    })
    .finally(() => {
      lastRefreshAt = Date.now();
      refreshInFlight = false;
    });
}

/** Fire-and-forget refresh, synchronous read of whatever's cached. */
function isCallingHoursEnforced() {
  refreshEnforcedCache();
  return cachedEnforced;
}

// One representative IANA time zone per state. A few states technically
// straddle two zones (e.g. FL panhandle, western TX) — this is a documented
// phase-1 simplification; the important part is that every state maps to
// *some* zone so calling hours are always enforced.
const STATE_TIMEZONES = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
};

function timezoneForState(state) {
  return STATE_TIMEZONES[state] || 'America/New_York';
}

function localHour(state, date = new Date()) {
  const timeZone = timezoneForState(state);
  const formatted = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  }).format(date);
  const hour = Number(formatted);
  return hour === 24 ? 0 : hour; // ICU quirk: midnight can format as "24"
}

function isWithinCallingHours(state, date = new Date()) {
  if (!isCallingHoursEnforced()) return true;
  const hour = localHour(state, date);
  return hour >= CALLING_HOURS_START && hour < CALLING_HOURS_END;
}

function assertCallingHours(state, date = new Date()) {
  if (!isWithinCallingHours(state, date)) {
    throw new ApiError(
      422,
      `Outside calling hours for ${state} (8am-9pm local time). Try again later.`
    );
  }
}

module.exports = {
  isWithinCallingHours,
  assertCallingHours,
  timezoneForState,
  localHour,
  STATE_TIMEZONES,
  isCallingHoursEnforced,
  ENFORCEMENT_SETTING_KEY,
};
