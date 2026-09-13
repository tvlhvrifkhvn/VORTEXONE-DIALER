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

async function countsByState() {
  await releaseStaleLocks();
  const { rows } = await db.query(
    `SELECT state, count(*)::int AS total,
            count(*) FILTER (WHERE status = ANY($1) AND (next_action_at IS NULL OR next_action_at <= now())) AS dialable
     FROM leads
     GROUP BY state
     ORDER BY state ASC`,
    [DIALABLE_STATUSES]
  );
  return rows;
}

function buildListFilters({ search, status, dateFrom, dateTo }) {
  const clauses = [];
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
  const { rows } = await db.query(
    `SELECT * FROM leads ${where} ${stateClause}
     ORDER BY created_at DESC
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

module.exports = {
  DIALABLE_STATUSES,
  releaseStaleLocks,
  candidates,
  peekNext,
  lockNext,
  getById,
  countsByState,
  list,
};
