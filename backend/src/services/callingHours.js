const { ApiError } = require('../middleware/errorHandler');
const settingsStore = require('./settings');
const { STATE_ZONES, ALL_ZONES, zonesForAreaCode, stateForAreaCode, zonesForPlace } = require('../utils/timeZones');

const CALLING_HOURS_START = 8; // 8am inclusive
const CALLING_HOURS_END = 21; // 9pm exclusive
const ENFORCEMENT_SETTING_KEY = 'calling_hours_enforced';
// A dial is allowed only if the lead's zones are open now AND a few seconds
// from now, so a call can't be placed in the last instant before 9pm.
const DIAL_MARGIN_MS = 5000;

// Testing-phase toggle (Settings → Dialing defaults → "Enforce calling
// hours"), default OFF. A self-refreshing in-memory cache, so the
// synchronous checks below can read it; up to CACHE_REFRESH_MS stale.
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
      // Leave the cached value as-is on a transient DB hiccup.
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

async function isEnforced() {
  return isCallingHoursEnforced();
}

// ---- zones -----------------------------------------------------------------

function cleanState(state) {
  return String(state || '').trim().toUpperCase();
}

function areaCodeOf(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  return digits.length === 10 ? digits.slice(0, 3) : null;
}

const union = (...lists) => [...new Set(lists.flat())].sort();

/**
 * Every IANA zone the lead could be in. Order: (1) the phone's area code,
 * (2) a known place in the lead's address when the area code (or the state)
 * spans two zones, (3) all zones of the state. When the area code belongs to
 * another state than the lead (a moved or ported number), both are kept —
 * the dial then waits until every one of them is inside calling hours.
 * Returns [] when the state is missing or not a known US state/territory:
 * the time zone is unknown and the lead is never dialed while enforced.
 */
function zonesForLead({ phone, state, address, city } = {}) {
  const st = cleanState(state);
  const stateZones = STATE_ZONES[st];
  if (!stateZones) return [];

  const placeZones = zonesForPlace(st, [address, city].filter(Boolean).join(', '));
  const areaCode = areaCodeOf(phone);
  const codeZones = zonesForAreaCode(areaCode);
  if (codeZones && stateForAreaCode(areaCode) === st) {
    if (codeZones.length > 1 && placeZones) {
      const narrowed = codeZones.filter((z) => placeZones.includes(z));
      if (narrowed.length) return union(narrowed);
    }
    return union(codeZones);
  }
  const fromState = placeZones || stateZones;
  return codeZones ? union(codeZones, fromState) : union(fromState);
}

/** Zones for a bare number (the dial pad): from its area code only, [] if unknown. */
function zonesForNumber(phone) {
  return union(zonesForAreaCode(areaCodeOf(phone)) || []);
}

function localParts(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

function isZoneOpenAt(zone, date) {
  const { hour } = localParts(zone, date);
  return hour >= CALLING_HOURS_START && hour < CALLING_HOURS_END;
}

function isZoneOpen(zone, date = new Date()) {
  return isZoneOpenAt(zone, date) && isZoneOpenAt(zone, new Date(date.getTime() + DIAL_MARGIN_MS));
}

function zonesOpen(zones, date = new Date()) {
  return Array.isArray(zones) && zones.length > 0 && zones.every((z) => isZoneOpen(z, date));
}

/** The zones inside calling hours at `date` — the queue's SQL filter. */
function openZones(date = new Date()) {
  return ALL_ZONES.filter((z) => isZoneOpen(z, date));
}

/** null when calling hours are off (no filter), else the open zones. */
async function openZonesNow(date = new Date()) {
  return (await isEnforced()) ? openZones(date) : null;
}

/**
 * The next moment every zone in `zones` is open (all zones are whole-hour
 * offsets, so local hours change only at the top of a UTC hour). null if
 * the zones are unknown or never open together within two days.
 */
function nextOpensAt(zones, date = new Date()) {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  if (zonesOpen(zones, date)) return date;
  const t = new Date(date);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 48; i++) {
    const candidate = new Date(t.getTime() + i * 3600e3);
    if (zonesOpen(zones, candidate)) return candidate;
  }
  return null;
}

function describeLocalTime(zones, date) {
  return zones
    .map((z) => new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date))
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(' / ');
}

/**
 * The one check every outbound path uses. Pass the lead (its stored
 * tz_zones are used when present) or { zones }. Throws 422 when calling
 * hours are enforced and the lead's local time is outside 8am–9pm in any of
 * its zones, or when its zone is unknown.
 */
async function assertCallingHours(target, date = new Date()) {
  if (!(await isEnforced())) return;
  const zones = zonesOf(target);
  if (zones.length === 0) {
    throw new ApiError(422, target?.phoneOnly
      ? "Time zone unknown for this number's area code — calling hours can't be checked, so it can't be dialed while they're enforced."
      : 'Time zone unknown, set the state first');
  }
  if (!zonesOpen(zones, date)) {
    throw new ApiError(
      422,
      `Outside calling hours (8am–9pm local time; it's ${describeLocalTime(zones, date)} there). Try again later.`
    );
  }
}

/** The dial pad: the zone comes from the dialled number's area code. */
async function assertNumberCallingHours(phone, date = new Date()) {
  return assertCallingHours({ zones: zonesForNumber(phone), phoneOnly: true }, date);
}

function zonesOf(target) {
  if (!target) return [];
  if (Array.isArray(target.zones)) return target.zones;
  if (Array.isArray(target.tz_zones)) return target.tz_zones;
  return zonesForLead(target);
}

// ---- kept for existing callers ----------------------------------------------

/** The state's main zone, for display (preCallBrief). Not used for the dialing check. */
function timezoneForState(state) {
  const zones = STATE_ZONES[cleanState(state)];
  return zones ? zones[0] : 'America/New_York';
}

function localHour(state, date = new Date()) {
  return localParts(timezoneForState(state), date).hour;
}

/** Synchronous, state-only form of the same rule (every zone of the state must be open). */
function isWithinCallingHours(state, date = new Date()) {
  if (!isCallingHoursEnforced()) return true;
  return zonesOpen(zonesForLead({ state }), date);
}

module.exports = {
  assertCallingHours,
  assertNumberCallingHours,
  zonesForLead,
  zonesForNumber,
  openZones,
  openZonesNow,
  zonesOpen,
  nextOpensAt,
  isEnforced,
  isCallingHoursEnforced,
  isWithinCallingHours,
  timezoneForState,
  localHour,
  ENFORCEMENT_SETTING_KEY,
  CALLING_HOURS_START,
  CALLING_HOURS_END,
};
