const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const callingHours = require('./callingHours');
const dncCheck = require('./dncCheck');
const { normalizePhone } = require('../utils/phoneNormalize');
const { buildOfficeKey } = require('../utils/officeKey');
const { US_STATES } = require('../utils/usStates');

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
       AND missing_phone = false
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
    // This by-id path bypasses candidates() entirely, so it needs its own
    // phoneless guard — otherwise a flagged lead clicked from the table dials.
    if (lead.missing_phone || !lead.phone) {
      throw new ApiError(409, 'This lead has no phone number yet — add one before calling.');
    }
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

/** Appends a tag to a lead, ignoring duplicates and blank input. */
async function addTag(leadId, rawTag) {
  const tag = (rawTag || '').replace(/\s+/g, ' ').trim();
  if (!tag) throw new ApiError(400, 'Tag cannot be empty');
  if (tag.length > 40) throw new ApiError(400, 'Tag is too long (40 characters max)');

  const { rows } = await db.query(
    `UPDATE leads
     SET tags = CASE WHEN $2 = ANY(tags) THEN tags ELSE array_append(tags, $2) END,
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [leadId, tag]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
}

async function removeTag(leadId, rawTag) {
  const { rows } = await db.query(
    `UPDATE leads SET tags = array_remove(tags, $2), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [leadId, (rawTag || '').trim()]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
}

/**
 * A note saved during a call, without submitting a disposition. Stored in
 * lead_notes rather than call_history.note, which applyDisposition overwrites
 * wholesale — see migration 018.
 */
async function addNote({ leadId, callId = null, userId = null, body }) {
  const text = (body || '').trim();
  if (!text) throw new ApiError(400, 'Note cannot be empty');

  const { rows: leadRows } = await db.query(
    'SELECT id FROM leads WHERE id = $1 AND deleted_at IS NULL',
    [leadId]
  );
  if (!leadRows[0]) throw new ApiError(404, 'Lead not found');

  const { rows } = await db.query(
    `INSERT INTO lead_notes (lead_id, call_id, user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [leadId, callId || null, userId || null, text]
  );
  await db.query('UPDATE leads SET notes_count = notes_count + 1, updated_at = now() WHERE id = $1', [leadId]);
  return rows[0];
}

/**
 * Schedules a callback from the lead page, with no call in progress.
 * leadLifecycle.applyDisposition covers the same transition, but only for a
 * live call — it requires a call_history row to attach the disposition to.
 * Same two writes (lead status + next_action_at, and a callbacks row) so both
 * paths leave identical state behind.
 */
async function scheduleCallback(leadId, scheduledAt) {
  const when = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(when.getTime())) {
    throw new ApiError(400, 'A valid callback date and time is required');
  }

  const { rows } = await db.query(
    `UPDATE leads
     SET status = 'callback_scheduled', next_action_at = $2, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [leadId, when]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');

  await db.query('INSERT INTO callbacks (lead_id, scheduled_at) VALUES ($1, $2)', [leadId, when]);
  return rows[0];
}

async function listNotes(leadId) {
  const { rows } = await db.query(
    'SELECT id, body, call_id, created_at FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC',
    [leadId]
  );
  return rows;
}

async function countsByState() {
  await releaseStaleLocks();
  const { rows } = await db.query(
    `SELECT state, count(*)::int AS total,
            count(*) FILTER (WHERE missing_phone = false AND status = ANY($1) AND (next_action_at IS NULL OR next_action_at <= now())) AS dialable,
            count(*) FILTER (WHERE missing_phone = false AND status IN ('new', 'in_queue')) AS uncontacted
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
    clauses.push(`(name ILIKE $${params.length} OR leads.phone ILIKE $${params.length} OR brokerage ILIKE $${params.length})`);
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

/**
 * Creates a new lead directly — the manual dial pad's optional "Save as
 * lead" form (see AppShell.jsx / DialPad.jsx) is the one hand-entry path in
 * an app where every other lead comes from a CSV import, so it applies the
 * same phone validation and DNC block CLAUDE.md requires of imports.
 */
async function create({ name, phone, state, email = null, address = null, brokerage = null }) {
  if (!name || !name.trim()) throw new ApiError(400, 'Name is required');

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new ApiError(400, 'Enter a valid 10-digit US phone number');

  const normalizedState = String(state || '').trim().toUpperCase();
  if (!US_STATES.includes(normalizedState)) throw new ApiError(400, 'Enter a valid US state');

  if (await dncCheck.isOnDncList(normalizedPhone)) {
    throw new ApiError(409, 'This number is on the DNC list and cannot be added as a lead');
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO leads (name, phone, email, address, brokerage, state, status, office_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'new', $7)
       RETURNING *`,
      [
        name.trim(),
        normalizedPhone,
        email || null,
        address || null,
        brokerage || null,
        normalizedState,
        buildOfficeKey({ brokerage, address, state: normalizedState }),
      ]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'A lead with this phone number already exists');
    throw err;
  }
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

  // Editing brokerage/address/state changes which office this lead belongs
  // to, so the stored key would otherwise go stale.
  const updated = rows[0];
  const nextKey = buildOfficeKey({
    brokerage: updated.brokerage,
    address: updated.address,
    state: updated.state,
  });
  if (nextKey !== updated.office_key) {
    const { rows: rekeyed } = await db.query(
      'UPDATE leads SET office_key = $2 WHERE id = $1 RETURNING *',
      [leadId, nextKey]
    );
    return rekeyed[0];
  }
  return updated;
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

/**
 * Given a set of lead ids (a rep's manual selection for targeted dialing),
 * returns them in the same priority order the regular queue uses — callbacks
 * first (soonest due), then never-dialed leads, then in_queue leads that
 * have waited longest. Does not filter by dialable status: a lead the rep
 * explicitly picked stays in the list even if it's not currently dialable,
 * so the count the frontend shows matches what it asked for.
 */
async function batchQueue(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { rows } = await db.query(
    `SELECT * FROM leads
     WHERE id = ANY($1) AND deleted_at IS NULL AND missing_phone = false
     ORDER BY
       CASE
         WHEN status = 'callback_scheduled' THEN 0
         WHEN status = 'new' THEN 1
         WHEN status = 'in_queue' THEN 2
         ELSE 3
       END,
       CASE WHEN status = 'callback_scheduled' THEN next_action_at END ASC,
       CASE WHEN status = 'in_queue' THEN updated_at END ASC,
       created_at DESC`,
    [ids]
  );
  return rows;
}

module.exports = {
  DIALABLE_STATUSES,
  releaseStaleLocks,
  candidates,
  peekNext,
  lockNext,
  create,
  getById,
  getHistory,
  addTag,
  removeTag,
  addNote,
  listNotes,
  scheduleCallback,
  countsByState,
  list,
  updateFields,
  softDelete,
  search,
  batchQueue,
};
