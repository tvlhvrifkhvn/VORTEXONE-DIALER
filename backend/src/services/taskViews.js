// C6A: the three task views and the reminders (docs/CRM_PLAN.md).
//   list({ view, campaignId, now, from, to })
//     overdue   open, due before now
//     today     open, due inside today's reporting day (reporting timezone and day start)
//     upcoming  open, due after today, grouped by local date; from/to (YYYY-MM-DD) narrow it
//   dueSoon({ userId, now })  open tasks and callbacks due within 15 minutes or
//     already due, that this user hasn't been reminded of today (every file)
//   markReminded({ userId, kind, id, dueAt })  the toast was shown
// "Now" comes from Node, so the tests can move the clock.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const campaignScope = require('./campaignScope');
const reportingPeriod = require('./reportingPeriod');

const VIEWS = ['overdue', 'today', 'upcoming'];
const CAP = 200;
const SOON_MS = 15 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COLUMNS = 't.id, t.campaign_id, t.lead_id, t.user_id, t.type, t.title, t.due_at, t.done_at, t.source, t.created_at';

function localDate(tz, instant) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** A YYYY-MM-DD in the reporting zone → the reporting day that starts on it. */
function dayOf(value, name, settings) {
  const m = typeof value === 'string' && value.match(DATE_RE);
  if (!m) throw new ApiError(400, `${name} must be a date like 2026-11-20`);
  return reportingPeriod.dayStarting({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, settings);
}

async function list({ view, campaignId, now = new Date(), from, to } = {}) {
  if (!VIEWS.includes(view)) throw new ApiError(400, `view must be one of: ${VIEWS.join(', ')}`);
  const settings = await reportingPeriod.getSettings();
  const day = reportingPeriod.dayContaining(now, settings);
  let start;
  let end = null;
  if (view === 'overdue') {
    start = null;
    end = now;
  } else if (view === 'today') {
    start = day.start;
    end = day.end;
  } else {
    start = day.end;
    if (from) start = new Date(Math.max(day.end.getTime(), dayOf(from, 'from', settings).start.getTime()));
    if (to) end = dayOf(to, 'to', settings).end;
    if (end && end <= start) throw new ApiError(400, '"to" must be after today and after "from"');
  }
  const s = campaignScope.scope('t', campaignId, 4);
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, l.name AS lead_name, (t.due_at < $3) AS overdue, count(*) OVER ()::int AS total
     FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
     WHERE t.done_at IS NULL AND (t.lead_id IS NULL OR l.deleted_at IS NULL)
       AND ($1::timestamptz IS NULL OR t.due_at >= $1) AND ($2::timestamptz IS NULL OR t.due_at < $2)
       AND ${s.sql}
     ORDER BY t.due_at ASC, t.id ASC
     LIMIT ${CAP}`,
    [start, end, now, ...s.params]
  );
  const total = rows[0]?.total ?? 0;
  const items = rows.map(({ total: _t, ...r }) => r);
  const result = { view, total, items, timezone: settings.timezone, today: day.date };
  if (view === 'upcoming') {
    const groups = new Map();
    for (const t of items) {
      const date = localDate(settings.timezone, t.due_at);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(t);
    }
    result.groups = [...groups].map(([date, groupItems]) => ({ date, items: groupItems }));
  }
  return result;
}

/** Due within 15 minutes or already due (open), not yet reminded today, for this user; every file. */
async function dueSoon({ userId, now = new Date() } = {}) {
  const settings = await reportingPeriod.getSettings();
  const day = reportingPeriod.dayContaining(now, settings);
  const until = new Date(now.getTime() + SOON_MS);
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT 'task' AS kind, t.id, t.due_at, t.title, t.type, t.lead_id, l.name AS lead_name, t.campaign_id
       FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.done_at IS NULL AND t.due_at < $2 AND t.due_at >= $3 AND (t.lead_id IS NULL OR l.deleted_at IS NULL)
       UNION ALL
       SELECT 'callback' AS kind, l.id, l.next_action_at AS due_at, 'Callback' AS title, 'call' AS type, l.id AS lead_id, l.name AS lead_name, l.campaign_id
       FROM leads l
       WHERE l.status = 'callback_scheduled' AND l.deleted_at IS NULL AND l.next_action_at < $2 AND l.next_action_at >= $3
     ) due
     WHERE NOT EXISTS (
       SELECT 1 FROM reminder_log r
       WHERE r.user_id = $1 AND r.kind = due.kind AND r.ref_id = due.id AND r.due_at = due.due_at AND r.reminded_at >= $3
     )
     ORDER BY due.due_at ASC, due.id ASC
     LIMIT 50`,
    [userId, until, day.start]
  );
  return { now: now.toISOString(), items: rows.map((r) => ({ ...r, due: new Date(r.due_at) <= now })) };
}

async function markReminded({ userId, kind, id, dueAt, now = new Date() } = {}) {
  if (!['task', 'callback'].includes(kind)) throw new ApiError(400, 'kind must be "task" or "callback"');
  const ref = Number(id);
  if (!Number.isInteger(ref) || ref <= 0) throw new ApiError(400, 'id must be a positive whole number');
  const due = new Date(dueAt);
  if (!dueAt || Number.isNaN(due.getTime())) throw new ApiError(400, 'dueAt must be a date and time');
  await db.query(
    `INSERT INTO reminder_log (user_id, kind, ref_id, due_at, reminded_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, kind, ref_id, due_at) DO UPDATE SET reminded_at = EXCLUDED.reminded_at`,
    [userId, kind, ref, due, now]
  );
  return { reminded: true };
}

module.exports = { VIEWS, CAP, SOON_MS, list, dueSoon, markReminded };
