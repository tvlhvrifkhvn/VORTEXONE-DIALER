const { ApiError } = require('../middleware/errorHandler');
const settingsStore = require('./settings');

// "Today" for every report, the dashboard counters, the daily goal and the
// PDF. It follows only the owner's two settings: reporting_timezone (an
// IANA zone) and day_start_time ("HH:MM"). A day runs from day_start_time
// on one calendar date to the same wall-clock time on the next date in that
// zone, so it is 23 or 25 hours long across a daylight-saving change.
// Migration 028 seeds both settings without overwriting existing values;
// the defaults below are only a fallback if the rows are missing.
const TIMEZONE_KEY = 'reporting_timezone';
const DAY_START_KEY = 'day_start_time';
const DEFAULT_TIMEZONE = 'Asia/Karachi';
const DEFAULT_DAY_START = '00:00';
const MAX_RANGE_DAYS = 366;

const DAY_START_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidDayStart(value) {
  return typeof value === 'string' && DAY_START_RE.test(value);
}

/** Validation for PUT /api/settings/<key> of the two reporting settings (400 on a bad value). */
function validateSetting(key, value) {
  if (key === TIMEZONE_KEY && !isValidTimezone(value)) {
    throw new ApiError(400, `"${value}" is not a time zone. Use an IANA name such as Asia/Karachi or America/Chicago.`);
  }
  if (key === DAY_START_KEY && !isValidDayStart(value)) {
    throw new ApiError(400, 'The day start time must be HH:MM (24-hour), for example 00:00.');
  }
}

settingsStore.registerValidator(TIMEZONE_KEY, validateSetting);
settingsStore.registerValidator(DAY_START_KEY, validateSetting);

async function getSettings() {
  const [tz, dayStart] = await Promise.all([settingsStore.getSetting(TIMEZONE_KEY), settingsStore.getSetting(DAY_START_KEY)]);
  return {
    timezone: isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE,
    dayStart: isValidDayStart(dayStart) ? dayStart : DEFAULT_DAY_START,
  };
}

// ---- wall-clock <-> instant in a zone ---------------------------------------

function localParts(tz, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') % 24, mm: get('minute'), ss: get('second') };
}

/** Zone offset (ms, local minus UTC) at an instant. */
function offsetAt(tz, ms) {
  const p = localParts(tz, new Date(ms));
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant of a wall-clock time in a zone. A time skipped by a DST jump
 * resolves to the first instant after the jump; a time that happens twice
 * resolves to the first occurrence.
 */
function zonedToInstant(tz, y, m, d, hh = 0, mm = 0, ss = 0) {
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  const candidates = [...new Set([offsetAt(tz, wall - 36e5 * 14), offsetAt(tz, wall), offsetAt(tz, wall + 36e5 * 14)])]
    .map((off) => wall - off)
    .filter((t) => offsetAt(tz, t) === wall - t)
    .sort((a, b) => a - b);
  if (candidates.length) return new Date(candidates[0]);
  // In a gap (the clock jumps over this time): the day starts at the jump.
  let lo = wall - offsetAt(tz, wall + 36e5 * 14); // before the jump
  let hi = wall - offsetAt(tz, wall - 36e5 * 14); // after the jump
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (offsetAt(tz, mid) === offsetAt(tz, lo)) lo = mid; else hi = mid;
  }
  return new Date(hi);
}

/** y-m-d plus n days (calendar arithmetic, no zone). */
function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

// ---- the one function -------------------------------------------------------

/** The reporting day that starts on local date {y,m,d} at dayStart. */
function dayStarting(date, { timezone, dayStart }) {
  const [sh, sm] = dayStart.split(':').map(Number);
  const next = addDays(date.y, date.m, date.d, 1);
  return {
    start: zonedToInstant(timezone, date.y, date.m, date.d, sh, sm),
    end: zonedToInstant(timezone, next.y, next.m, next.d, sh, sm),
    date: ymd(date),
  };
}

/** The reporting day containing instant T. */
function dayContaining(T, settings) {
  const p = localParts(settings.timezone, T);
  let day = dayStarting(p, settings);
  if (T < day.start) day = dayStarting(addDays(p.y, p.m, p.d, -1), settings);
  else if (T >= day.end) day = dayStarting(addDays(p.y, p.m, p.d, 1), settings);
  return day;
}

function parseDate(value, name) {
  const match = DATE_RE.exec(String(value));
  if (!match) throw new ApiError(400, `${name} must be a date like 2026-11-12`);
  const [y, m, d] = match.slice(1).map(Number);
  const check = addDays(y, m, d, 0);
  if (check.y !== y || check.m !== m || check.d !== d) throw new ApiError(400, `${name} is not a real date: ${value}`);
  return { y, m, d };
}

function parseLocalDateTime(value, name, tz) {
  const match = DATETIME_RE.exec(String(value));
  if (!match) throw new ApiError(400, `${name} must be a date and time like 2026-11-12T22:00`);
  const [y, m, d, hh, mm, ss = 0] = match.slice(1).map((v) => Number(v || 0));
  const check = addDays(y, m, d, 0);
  if (check.y !== y || check.m !== m || check.d !== d || hh > 23 || mm > 59 || ss > 59) {
    throw new ApiError(400, `${name} is not a real date and time: ${value}`);
  }
  return zonedToInstant(tz, y, m, d, hh, mm, ss);
}

const formatLocal = (instant, tz) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instant);

/**
 * The period a report covers, from request query parameters:
 *   (none)            the reporting day containing `now`
 *   date=YYYY-MM-DD   the reporting day that starts on that local date
 *   from=…&to=…       a custom range, local date-times in the reporting zone
 * Returns { start, end, timezone, dayStart, kind, label }. Bad input → 400.
 */
async function resolvePeriod(query = {}, now = new Date()) {
  const settings = await getSettings();
  const { timezone, dayStart } = settings;
  const { date, from, to } = query;
  const has = (v) => v !== undefined && v !== null && v !== '';

  if (has(date) && (has(from) || has(to))) throw new ApiError(400, 'Give either date or from/to, not both');
  if (has(from) !== has(to)) throw new ApiError(400, 'A custom range needs both from and to');

  if (has(from)) {
    const start = parseLocalDateTime(from, 'from', timezone);
    const end = parseLocalDateTime(to, 'to', timezone);
    if (end <= start) throw new ApiError(400, '"to" must be after "from"');
    if (end - start > MAX_RANGE_DAYS * 864e5) throw new ApiError(400, `A range can be at most ${MAX_RANGE_DAYS} days`);
    return {
      start, end, timezone, dayStart, kind: 'range',
      label: `${formatLocal(start, timezone)} to ${formatLocal(end, timezone)}`,
    };
  }

  const day = has(date) ? dayStarting(parseDate(date, 'date'), settings) : dayContaining(now, settings);
  return {
    start: day.start, end: day.end, timezone, dayStart, kind: has(date) ? 'day' : 'today', date: day.date,
    label: dayStart === '00:00'
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00Z`))
      : `${formatLocal(day.start, timezone)} to ${formatLocal(day.end, timezone)}`,
  };
}

/** For JSON responses. */
function describe(period) {
  return {
    kind: period.kind, date: period.date || null, label: period.label, timezone: period.timezone, dayStart: period.dayStart,
    start: period.start.toISOString(), end: period.end.toISOString(),
  };
}

module.exports = {
  TIMEZONE_KEY, DAY_START_KEY, DEFAULT_TIMEZONE, DEFAULT_DAY_START, MAX_RANGE_DAYS,
  getSettings, validateSetting, dayContaining, dayStarting, resolvePeriod, describe, zonedToInstant,
};
