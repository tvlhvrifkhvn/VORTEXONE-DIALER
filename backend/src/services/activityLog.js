// C6C: the activity log (docs/CRM_PLAN.md). record() is called by
// middleware/activity.js with the route pattern and ids only; list() feeds
// Settings → ACTIVITY (supervisor); forLead() feeds the lead timeline;
// purgeOld() runs daily (rows older than 180 days).
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

const KEEP_DAYS = 180;
const PAGE_SIZE = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Plain words for the common changes; anything else reads "METHOD /route".
const SUMMARIES = {
  'POST /api/leads': 'Added a lead',
  'PUT /api/leads/:id': 'Edited the lead',
  'DELETE /api/leads/:id': 'Deleted the lead',
  'POST /api/leads/:id/notes': 'Added a note',
  'POST /api/leads/:id/tags': 'Added a tag',
  'DELETE /api/leads/:id/tags/:tag': 'Removed a tag',
  'POST /api/leads/:id/stage': 'Moved the stage',
  'PUT /api/leads/:id/deal': 'Set the deal value',
  'POST /api/leads/:id/callback': 'Scheduled a callback',
  'POST /api/leads/:id/snooze': 'Snoozed the lead',
  'POST /api/leads/:id/campaign': 'Moved to another file',
  'POST /api/leads/:id/draft': 'Drafted a message with AI',
  'POST /api/leads/merge': 'Merged two leads',
  'POST /api/leads/bulk/stage': 'Moved stages in bulk',
  'POST /api/leads/bulk/tag': 'Tagged in bulk',
  'POST /api/leads/bulk/campaign': 'Moved leads to another file in bulk',
  'POST /api/calls': 'Started a call',
  'POST /api/dispositions': 'Logged a call outcome',
  'POST /api/dispositions/:callId/undo': 'Undid a call outcome',
  'POST /api/sms/send': 'Sent a text',
  'POST /api/email/send': 'Sent an email',
  'POST /api/tasks': 'Added a task',
  'PUT /api/tasks/:id': 'Edited a task',
  'POST /api/tasks/:id/complete': 'Completed a task',
  'POST /api/tasks/:id/reopen': 'Reopened a task',
  'DELETE /api/tasks/:id': 'Deleted a task',
  'PUT /api/settings/:key': 'Changed a setting',
  'POST /api/imports/upload': 'Uploaded an import',
  'POST /api/campaigns': 'Created a file',
  'PUT /api/campaigns/:id': 'Edited a file',
};

/** "lead" for /api/leads/:id…, "task" for /api/tasks/:id…, else the first segment. */
function entityOf(route) {
  const m = String(route).match(/^\/api\/([a-z-]+)/);
  if (!m) return null;
  const map = { leads: 'lead', tasks: 'task', campaigns: 'campaign', calls: 'call', dispositions: 'call', pipeline: 'stage', views: 'view' };
  return map[m[1]] || m[1];
}

async function record({ userId, method, route, entityId, statusCode }) {
  const key = `${method} ${route}`;
  await db.query(
    `INSERT INTO activity_log (user_id, method, route, entity_type, entity_id, status_code, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, method, route.slice(0, 200), entityOf(route), entityId, statusCode, SUMMARIES[key] || key.slice(0, 200)]
  );
}

function dateOf(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, `${name} must be a date like 2026-11-20`);
  }
  return value;
}

/** Settings → ACTIVITY: newest first, filtered by user and date (UTC days), 100 a page. */
async function list({ userId, from, to, page = 1 } = {}) {
  const f = dateOf(from, 'from');
  const t = dateOf(to, 'to');
  let uid = null;
  if (userId !== undefined && userId !== null && userId !== '') {
    uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) throw new ApiError(400, 'userId must be a positive whole number');
  }
  const p = Math.max(1, Number.isInteger(Number(page)) ? Number(page) : 1);
  const { rows } = await db.query(
    `SELECT a.id, a.user_id, u.name AS user_name, a.method, a.route, a.entity_type, a.entity_id, a.status_code, a.summary, a.created_at,
            count(*) OVER ()::int AS total
     FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE ($1::int IS NULL OR a.user_id = $1)
       AND ($2::date IS NULL OR a.created_at >= $2::date)
       AND ($3::date IS NULL OR a.created_at < $3::date + 1)
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${PAGE_SIZE} OFFSET $4`,
    [uid, f, t, (p - 1) * PAGE_SIZE]
  );
  const { rows: users } = await db.query(
    'SELECT DISTINCT u.id, u.name FROM activity_log a JOIN users u ON u.id = a.user_id ORDER BY u.name'
  );
  return { total: rows[0]?.total ?? 0, page: p, pageSize: PAGE_SIZE, items: rows.map(({ total: _t, ...r }) => r), users };
}

/** One lead's rows, for its timeline. */
async function forLead(leadId) {
  const { rows } = await db.query(
    `SELECT a.id, a.created_at AS timestamp, a.summary, a.method, a.route, u.name AS user_name
     FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity_type = 'lead' AND a.entity_id = $1
     ORDER BY a.created_at DESC
     LIMIT 200`,
    [leadId]
  );
  return rows;
}

async function purgeOld(now = new Date()) {
  const res = await db.query('DELETE FROM activity_log WHERE created_at < $1', [new Date(now.getTime() - KEEP_DAYS * 864e5)]);
  return res.rowCount;
}

module.exports = { KEEP_DAYS, SUMMARIES, record, list, forLead, purgeOld, entityOf };
