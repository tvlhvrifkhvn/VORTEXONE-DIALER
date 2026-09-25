const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const { officeLabelFromKey } = require('../utils/officeKey');

// A call that still went well despite the objection. The brief lists
// "interested, callback, meeting": `contacted` is the "Spoke / Interested"
// disposition button, `callback_scheduled` is the callback. There is no
// meeting disposition in this schema.
const POSITIVE_OUTCOMES = ['contacted', 'callback_scheduled'];

const MAX_LABEL_LENGTH = 80;
const REPORT_DEFAULT_DAYS = 30;

function cleanLabel(raw) {
  const label = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!label) throw new ApiError(400, 'Objection label cannot be empty');
  if (label.length > MAX_LABEL_LENGTH) {
    throw new ApiError(400, `Objection label is too long (${MAX_LABEL_LENGTH} characters max)`);
  }
  return label;
}

function uniqueViolation(err) {
  if (err.code === '23505') return new ApiError(409, 'An objection with that label already exists');
  return err;
}

// ---------------------------------------------------------------------------
// Objection types (Settings)
// ---------------------------------------------------------------------------

async function listTypes({ includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, label, is_active, sort_order FROM objection_types
     ${includeInactive ? '' : 'WHERE is_active = true'}
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

async function createType(rawLabel) {
  const label = cleanLabel(rawLabel);
  try {
    const { rows } = await db.query(
      `INSERT INTO objection_types (label, sort_order)
       VALUES ($1, (SELECT COALESCE(max(sort_order), 0) + 1 FROM objection_types))
       RETURNING id, label, is_active, sort_order`,
      [label]
    );
    return rows[0];
  } catch (err) {
    throw uniqueViolation(err);
  }
}

/** Rename and/or (de)activate. There is deliberately no delete: removing a
 * type would orphan its historical call_objections rows, and the report has
 * to keep showing what was logged before it was switched off. */
async function updateType(id, { label, isActive }) {
  const sets = [];
  const params = [id];
  if (label !== undefined) {
    params.push(cleanLabel(label));
    sets.push(`label = $${params.length}`);
  }
  if (isActive !== undefined) {
    params.push(!!isActive);
    sets.push(`is_active = $${params.length}`);
  }
  if (sets.length === 0) throw new ApiError(400, 'Nothing to update');

  try {
    const { rows } = await db.query(
      `UPDATE objection_types SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, label, is_active, sort_order`,
      params
    );
    if (!rows[0]) throw new ApiError(404, 'Objection type not found');
    return rows[0];
  } catch (err) {
    throw uniqueViolation(err);
  }
}

/** Takes the full list of ids in their new order and rewrites sort_order to
 * match, in one transaction so a half-applied reorder is never visible. */
async function reorderTypes(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'ids must be a non-empty array');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE objection_types SET sort_order = $2 WHERE id = $1', [ids[i], i + 1]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return listTypes({ includeInactive: true });
}

// ---------------------------------------------------------------------------
// Per-call logging (call screen)
// ---------------------------------------------------------------------------

async function getCallOrThrow(callId) {
  const { rows } = await db.query('SELECT id, lead_id FROM call_history WHERE id = $1', [callId]);
  if (!rows[0]) throw new ApiError(404, 'Call not found');
  return rows[0];
}

async function listForCall(callId) {
  const { rows } = await db.query(
    `SELECT co.objection_type_id, ot.label, co.rebuttal_used, co.created_at
     FROM call_objections co
     JOIN objection_types ot ON ot.id = co.objection_type_id
     WHERE co.call_id = $1
     ORDER BY co.created_at ASC`,
    [callId]
  );
  return rows;
}

/** Idempotent: tapping a chip twice in a row never logs it twice. lead_id is
 * read from the call itself rather than trusted from the client. */
async function logForCall(callId, objectionTypeId) {
  const call = await getCallOrThrow(callId);
  const { rows: typeRows } = await db.query('SELECT id FROM objection_types WHERE id = $1', [objectionTypeId]);
  if (!typeRows[0]) throw new ApiError(404, 'Objection type not found');

  await db.query(
    `INSERT INTO call_objections (call_id, lead_id, objection_type_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (call_id, objection_type_id) DO NOTHING`,
    [call.id, call.lead_id, objectionTypeId]
  );
  return listForCall(callId);
}

async function removeForCall(callId, objectionTypeId) {
  await db.query('DELETE FROM call_objections WHERE call_id = $1 AND objection_type_id = $2', [
    callId,
    objectionTypeId,
  ]);
  return listForCall(callId);
}

async function saveRebuttal(callId, objectionTypeId, rawText) {
  const text = String(rawText || '').trim();
  const { rows } = await db.query(
    `UPDATE call_objections SET rebuttal_used = $3
     WHERE call_id = $1 AND objection_type_id = $2
     RETURNING objection_type_id`,
    [callId, objectionTypeId, text || null]
  );
  if (!rows[0]) throw new ApiError(404, 'Log this objection on the call before saving what you said');
  return listForCall(callId);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - REPORT_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { dateFrom: iso(from), dateTo: iso(to) };
}

/**
 * Per objection type: how often it was logged in the range, and how many of
 * those calls still ended positively. Filters are applied inside the CTE and
 * the type list is LEFT JOINed onto it, so a filter never makes a type vanish
 * — it just reads zero. Inactive types are kept whenever they have data, which
 * is what keeps a deactivated objection visible in the report.
 */
async function getReport({ dateFrom, dateTo, state, officeKey } = {}) {
  const range = defaultRange();
  const from = dateFrom || range.dateFrom;
  const to = dateTo || range.dateTo;

  const params = [from, to, POSITIVE_OUTCOMES];
  const filters = [
    'co.created_at >= $1::date',
    // < next day, so calls made on the end date itself are included.
    "co.created_at < ($2::date + interval '1 day')",
  ];
  if (state) {
    params.push(String(state).toUpperCase());
    filters.push(`l.state = $${params.length}`);
  }
  if (officeKey) {
    params.push(officeKey);
    filters.push(`l.office_key = $${params.length}`);
  }

  const { rows } = await db.query(
    `WITH logged AS (
       SELECT co.objection_type_id, ch.disposition
       FROM call_objections co
       LEFT JOIN call_history ch ON ch.id = co.call_id
       LEFT JOIN leads l ON l.id = co.lead_id
       WHERE ${filters.join(' AND ')}
     )
     SELECT ot.id, ot.label, ot.is_active, ot.sort_order,
            count(lg.objection_type_id)::int                                        AS count,
            count(lg.disposition)::int                                              AS dispositioned,
            count(*) FILTER (WHERE lg.disposition = ANY($3))::int                   AS positive
     FROM objection_types ot
     LEFT JOIN logged lg ON lg.objection_type_id = ot.id
     GROUP BY ot.id
     ORDER BY count DESC, ot.sort_order ASC`,
    params
  );

  const objections = rows
    .filter((r) => r.is_active || r.count > 0)
    .map((r) => ({
      ...r,
      // Of the calls that have an outcome — an in-progress call hasn't had one yet.
      positiveRate: r.dispositioned > 0 ? Math.round((r.positive / r.dispositioned) * 100) : null,
    }));

  return { dateFrom: from, dateTo: to, objections };
}

async function listOffices() {
  const { rows } = await db.query(
    `SELECT office_key, max(brokerage) AS brokerage, count(*)::int AS leads
     FROM leads
     WHERE office_key IS NOT NULL AND deleted_at IS NULL
     GROUP BY office_key
     ORDER BY office_key ASC`
  );
  return rows.map((r) => ({
    officeKey: r.office_key,
    label: officeLabelFromKey(r.office_key, r.brokerage),
    leads: r.leads,
  }));
}

module.exports = {
  POSITIVE_OUTCOMES,
  listTypes,
  createType,
  updateType,
  reorderTypes,
  listForCall,
  logForCall,
  removeForCall,
  saveRebuttal,
  getReport,
  listOffices,
};
