const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const callingHours = require('./callingHours');

const LOCK_TIMEOUT_SECONDS = 30;

// Statuses that can ever come back up for dialing. 'new' and 'in_queue' are
// always immediately dialable; the others become dialable once next_action_at
// has passed (see the WHERE clause below) — see CLAUDE.md for the full
// status/lifecycle rules.
const DIALABLE_STATUSES = ['new', 'in_queue', 'voicemail', 'no_answer', 'callback_scheduled'];

const CANDIDATE_ORDER_SQL = `
  ORDER BY CASE status WHEN 'callback_scheduled' THEN 0 ELSE 1 END,
           next_action_at ASC NULLS FIRST,
           created_at ASC
`;

/**
 * A rep who hangs up without submitting a disposition keeps the lead locked
 * for a 30s grace period (see leadLifecycle.hangup), after which it should
 * silently become dialable again. Rather than run a background sweep, every
 * read of the queue lazily releases any lock past that grace period first.
 */
async function releaseStaleLocks() {
  await db.query(
    `UPDATE leads
     SET status = 'in_queue', locked_by = NULL, locked_at = NULL, updated_at = now()
     WHERE status = 'in_progress' AND locked_at < now() - interval '${LOCK_TIMEOUT_SECONDS} seconds'`
  );
}

async function candidates(limit = 50) {
  await releaseStaleLocks();
  const { rows } = await db.query(
    `SELECT * FROM leads
     WHERE dnc_flag = false
       AND deleted_at IS NULL
       AND status = ANY($1)
       AND (next_action_at IS NULL OR next_action_at <= now())
     ${CANDIDATE_ORDER_SQL}
     LIMIT $2`,
    [DIALABLE_STATUSES, limit]
  );
  return rows;
}

/** The lead the dialer would call next, respecting calling hours. Read-only. */
async function peekNext() {
  const rows = await candidates();
  return rows.find((lead) => callingHours.isWithinCallingHours(lead.state)) || null;
}

/**
 * Locks a lead for dialing: either a specific leadId (clicked from the
 * table) or, if omitted, whichever lead peekNext() would pick ("Start
 * Dialing"). Throws ApiError for anything that makes the lead undialable
 * right now so the route can surface a clear message.
 */
async function lockNext({ userId, leadId = null }) {
  await releaseStaleLocks();

  let lead;
  if (leadId) {
    const { rows } = await db.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    lead = rows[0];
    if (!lead) throw new ApiError(404, 'Lead not found');
    if (lead.dnc_flag || !DIALABLE_STATUSES.includes(lead.status)) {
      throw new ApiError(409, `Lead is not dialable (status: ${lead.status})`);
    }
    if (lead.next_action_at && new Date(lead.next_action_at) > new Date()) {
      throw new ApiError(409, `Lead is not due yet (next action at ${lead.next_action_at})`);
    }
  } else {
    lead = await peekNext();
    if (!lead) throw new ApiError(404, 'No dialable leads in queue right now');
  }

  callingHours.assertCallingHours(lead.state);

  const { rows } = await db.query(
    `UPDATE leads
     SET status = 'in_progress', locked_by = $1, locked_at = now(), updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [userId, lead.id]
  );
  return rows[0];
}

async function getById(leadId) {
  const { rows } = await db.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  return rows[0] || null;
}

/** Past dispositioned calls for a lead, newest first — powers the call
 * screen's "Previous Notes" panel. */
async function getHistory(leadId) {
  const { rows } = await db.query(
    `SELECT id, started_at, ended_at, duration_seconds, disposition, note
     FROM call_history
     WHERE lead_id = $1 AND disposition IS NOT NULL
     ORDER BY started_at DESC`,
    [leadId]
  );
  return rows;
}

async function countsByState() {
  await releaseStaleLocks();
  const { rows } = await db.query(
    `SELECT state, count(*)::int AS total,
            count(*) FILTER (WHERE status = ANY($1) AND (next_action_at IS NULL OR next_action_at <= now())) AS dialable,
            count(*) FILTER (WHERE status IN ('new', 'in_queue')) AS uncontacted
     FROM leads
     WHERE deleted_at IS NULL
     GROUP BY state
     ORDER BY state ASC`,
    [DIALABLE_STATUSES]
  );
  return rows;
}

function buildListFilters({ search, status, dateFrom, dateTo }) {
  const clauses = ['deleted_at IS NULL'];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR brokerage ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    clauses.push(`created_at <= $${params.length}`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function list({ search, status, dateFrom, dateTo, state, page = 1, pageSize = 50 } = {}) {
  await releaseStaleLocks();

  const filters = { search, status, dateFrom, dateTo };
  const { where, params } = buildListFilters(filters);
  const stateClause = state ? `${where ? 'AND' : 'WHERE'} state = $${params.length + 1}` : '';
  const allParams = state ? [...params, state] : params;

  const offset = (Math.max(1, page) - 1) * pageSize;
  // Sort so the most urgent leads always surface first: a due callback,
  // then never-dialed leads, then in_queue leads that have waited longest.
  const { rows } = await db.query(
    `SELECT leads.*, (dnc_list.id IS NOT NULL) AS is_dnc_flagged
     FROM leads
     LEFT JOIN dnc_list ON dnc_list.phone = leads.phone
     ${where} ${stateClause}
     ORDER BY
       CASE
         WHEN status = 'callback_scheduled' THEN 0
         WHEN status = 'new' THEN 1
         WHEN status = 'in_queue' THEN 2
         ELSE 3
       END,
       CASE WHEN status = 'callback_scheduled' THEN next_action_at END ASC,
       CASE WHEN status = 'in_queue' THEN updated_at END ASC,
       created_at DESC
     LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}`,
    [...allParams, pageSize, offset]
  );

  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS total FROM leads ${where} ${stateClause}`,
    allParams
  );

  const next = await peekNext();

  return {
    leads: rows.map((lead) => ({ ...lead, isUpNext: next?.id === lead.id })),
    total: countRows[0].total,
    page,
    pageSize,
  };
}

const EDITABLE_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];

/** Applies an inline edit from the lead detail slide-in panel. Only the six
 * plain contact fields are editable this way — lifecycle fields (status,
 * attempts, etc.) go through leadLifecycle instead. */
async function updateFields(leadId, fields) {
  const keys = EDITABLE_FIELDS.filter((f) => fields[f] !== undefined);
  if (keys.length === 0) throw new ApiError(400, 'No editable fields provided');

  const setSql = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  const { rows } = await db.query(
    `UPDATE leads SET ${setSql}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [leadId, ...keys.map((k) => fields[k])]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
}

/** Soft-deletes a lead — it stops appearing anywhere in the list/queue but
 * the row (and its call history) is kept. */
async function softDelete(leadId) {
  const { rows } = await db.query(
    `UPDATE leads SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [leadId]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
}

/** Global search across name/phone/brokerage, ignoring any state filter —
 * powers the navbar search. Capped at 10 results. */
async function search(q) {
  if (!q || !q.trim()) return [];
  const { rows } = await db.query(
    `SELECT * FROM leads
     WHERE deleted_at IS NULL
       AND (name ILIKE $1 OR phone ILIKE $1 OR brokerage ILIKE $1)
     ORDER BY created_at DESC
     LIMIT 10`,
    [`%${q.trim()}%`]
  );
  return rows;
}

module.exports = {
  DIALABLE_STATUSES,
  releaseStaleLocks,
  candidates,
  peekNext,
  lockNext,
  getById,
  getHistory,
  countsByState,
  list,
  updateFields,
  softDelete,
  search,
};
