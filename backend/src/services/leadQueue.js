const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const callingHours = require('./callingHours');
const dncCheck = require('./dncCheck');
const leadLifecycle = require('./leadLifecycle');
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

// Safety ceiling for a call that never closes (browser closed mid-call, a
// lost `ended` event): an open call older than this no longer protects its
// lead from the sweep. Env MAX_LIVE_CALL_MINUTES, default 240 (4 hours).
function maxLiveCallMinutes() {
  const value = Number(process.env.MAX_LIVE_CALL_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 240;
}

/**
 * A rep who hangs up without submitting a disposition keeps the lead locked
 * for a 30s grace period (see leadLifecycle.hangup), after which it should
 * silently become dialable again. Every read of the queue lazily releases any
 * lock past that grace period first, and index.js also runs this on a timer.
 *
 * A lock is stale only when locked_at is past the grace period AND the lead
 * has no open call (call_history row with ended_at and disposition both
 * empty) — a rep on a live call keeps the lead however long it lasts. An
 * open call older than maxLiveCallMinutes() counts as dangling: the lead is
 * released and that call row is closed (ended_at = now()). One statement,
 * so a lead is never released while a check about it is half done.
 */
async function releaseStaleLocks() {
  const { rows } = await db.query(
    `WITH stale AS (
       SELECT l.id FROM leads l
       WHERE l.status = 'in_progress'
         AND l.locked_at < now() - interval '${LOCK_TIMEOUT_SECONDS} seconds'
         AND NOT EXISTS (
           SELECT 1 FROM call_history c
           WHERE c.lead_id = l.id AND c.ended_at IS NULL AND c.disposition IS NULL
             AND c.started_at > now() - $1::float8 * interval '1 minute'
         )
       FOR UPDATE OF l SKIP LOCKED
     ), closed_calls AS (
       UPDATE call_history c SET ended_at = now()
       FROM stale
       WHERE c.lead_id = stale.id AND c.ended_at IS NULL AND c.disposition IS NULL
       RETURNING c.id
     )
     UPDATE leads l
     SET status = 'in_queue', locked_by = NULL, locked_at = NULL, updated_at = now()
     FROM stale
     WHERE l.id = stale.id
     RETURNING l.id`,
    [maxLiveCallMinutes()]
  );
  return rows.map((r) => r.id);
}

/**
 * Works out tz_zones for leads that don't have them yet (NULL): rows from
 * before migration 027, seeds, or anything written straight to the DB. Run
 * at startup and before every queue read, so no lead is left out of the
 * queue for lack of a zone. derived data: updated_at is left alone.
 */
let backfillRun = null;
async function backfillZones(batchSize = 2000) {
  if (backfillRun) return backfillRun;
  backfillRun = (async () => {
    let total = 0;
    for (;;) {
      const { rows } = await db.query(
        'SELECT id, phone, state, address FROM leads WHERE tz_zones IS NULL ORDER BY id LIMIT $1',
        [batchSize]
      );
      if (rows.length === 0) return total;
      await db.query(
        `UPDATE leads l SET tz_zones = ARRAY(SELECT jsonb_array_elements_text(v.zones))
         FROM jsonb_to_recordset($1::jsonb) AS v(id int, zones jsonb)
         WHERE l.id = v.id`,
        [JSON.stringify(rows.map((r) => ({ id: r.id, zones: callingHours.zonesForLead(r) })))]
      );
      total += rows.length;
    }
  })().finally(() => {
    backfillRun = null;
  });
  return backfillRun;
}

async function candidates(limit = 50) {
  await releaseStaleLocks();
  await backfillZones();
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
  return rows.find((lead) => callingHours.isLeadWithinCallingHours(lead)) || null;
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
    // deleted_at IS NULL: same filter candidates() uses — a soft-deleted lead is never dialed.
    const { rows } = await db.query('SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
    lead = rows[0];
    if (!lead) throw new ApiError(404, 'Lead not found');
    // This by-id path bypasses candidates() entirely, so it needs its own
    // phoneless guard — otherwise a flagged lead clicked from the table dials.
    if (lead.missing_phone || !lead.phone) {
      throw new ApiError(409, 'This lead has no phone number yet — add one before calling.');
    }
    // Same guard and message as the manual dial pad (callSession.startManual).
    if (await dncCheck.isOnDncList(normalizePhone(lead.phone) || lead.phone)) {
      throw new ApiError(409, 'This number is on the DNC list and cannot be dialed');
    }
    if (lead.dnc_flag || !DIALABLE_STATUSES.includes(lead.status)) {
      throw new ApiError(409, `Lead is not dialable (status: ${lead.status})`);
    }
    if (lead.next_action_at && new Date(lead.next_action_at) > new Date()) {
      throw new ApiError(409, `Lead is not due yet (next action at ${lead.next_action_at})`);
    }
  } else {
    // "Next lead": the same candidates, in the same order, with the same
    // calling-hours filter peekNext() applies — but each one is claimed
    // atomically, so a candidate another request just took is skipped
    // instead of being locked a second time. Bounded: CLAIM_ROUNDS re-queries.
    for (let round = 0; round < CLAIM_ROUNDS; round++) {
      const inHours = (await candidates()).filter((c) => callingHours.isLeadWithinCallingHours(c));
      if (inHours.length === 0) break;
      for (const candidate of inHours) {
        // A queued lead whose number is on the DNC list (e.g. added after
        // import) is marked dnc — the same outcome as multi-line reserveSlot.
        if (await dncCheck.isOnDncList(normalizePhone(candidate.phone) || candidate.phone)) {
          await leadLifecycle.markDncFromQueue(candidate.id);
          continue;
        }
        const claimed = await claimLead(candidate.id, userId);
        if (claimed) return claimed;
      }
    }
    throw new ApiError(404, 'No dialable leads in queue right now');
  }

  await callingHours.assertCallingHours(lead);

  const claimed = await claimLead(lead.id, userId);
  if (!claimed) {
    // Lost the race: another request locked (or changed) this lead between
    // the checks above and the claim. Never a second lock.
    const { rows: current } = await db.query('SELECT status FROM leads WHERE id = $1 AND deleted_at IS NULL', [lead.id]);
    if (!current[0]) throw new ApiError(404, 'Lead not found');
    throw new ApiError(409, `Lead is not dialable (status: ${current[0].status})`);
  }
  return claimed;
}

const CLAIM_ROUNDS = 3;

/**
 * Atomic compare-and-set lock: sets in_progress only if the lead is STILL
 * dialable at this instant. Under concurrency Postgres re-checks the WHERE
 * after the row-lock wait, so exactly one caller gets the row back and every
 * other caller gets null. Used only by lockNext().
 */
/**
 * Redial: the lead is still locked to this rep (in_progress) — refresh the
 * lock in the same statement that checks it. A plain read left a gap: the
 * stale-lock sweep could release the lead between the check and the new
 * call, leaving it unlocked while the rep was on the phone (seen 3 times in
 * 40 in fix-seg5b-b6.sh). Now either this wins (the sweep then sees a fresh
 * lock) or the sweep wins first (no row; the caller falls back to lockNext).
 */
async function refreshOwnLock(leadId, userId) {
  // A Redial is a new dial: calling hours apply exactly as for any other
  // (F-19). Refused -> the lead stays locked to this rep, who can still log
  // the previous call; the stale-lock sweep frees it otherwise.
  const { rows: own } = await db.query(
    `SELECT * FROM leads WHERE id = $1 AND status = 'in_progress' AND locked_by = $2 AND deleted_at IS NULL`,
    [leadId, userId]
  );
  if (own[0]) await callingHours.assertCallingHours(own[0]);

  const { rows } = await db.query(
    `UPDATE leads SET locked_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'in_progress' AND locked_by = $2 AND missing_phone = false AND deleted_at IS NULL
     RETURNING *, 'in_progress' AS previous_status`,
    [leadId, userId]
  );
  return rows[0] || null;
}

async function claimLead(leadId, userId) {
  // Same compare-and-set as before; the CTE only adds previous_status (the
  // status the lead had just before this lock), so a dial the telephony
  // provider refuses can put the lead back exactly where it was.
  const { rows } = await db.query(
    `WITH prev AS (SELECT id, status AS previous_status FROM leads WHERE id = $2 FOR UPDATE)
     UPDATE leads l
     SET status = 'in_progress', locked_by = $1, locked_at = now(), updated_at = now()
     FROM prev
     WHERE l.id = prev.id
       AND l.status = ANY($3)
       AND l.deleted_at IS NULL
       AND l.dnc_flag = false
       AND l.missing_phone = false
       AND (l.next_action_at IS NULL OR l.next_action_at <= now())
     RETURNING l.*, prev.previous_status`,
    [userId, leadId, DIALABLE_STATUSES]
  );
  return rows[0] || null;
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

  // A note may point at a call only if that call was made to this lead.
  if (callId) {
    const { rows: callRows } = await db.query('SELECT lead_id FROM call_history WHERE id = $1', [callId]);
    if (!callRows[0] || Number(callRows[0].lead_id) !== Number(leadId)) {
      throw new ApiError(400, "That call isn't one of this lead's calls");
    }
  }

  const { rows } = await db.query(
    `INSERT INTO lead_notes (lead_id, call_id, user_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [leadId, callId || null, userId || null, text]
  );
  await db.query('UPDATE leads SET notes_count = notes_count + 1, updated_at = now() WHERE id = $1', [leadId]);
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

const MAX_NAME_LENGTH = 200;

/**
 * The one set of lead field rules, shared by create() and updateFields():
 * name required (trimmed, max MAX_NAME_LENGTH), phone normalised to E.164,
 * state a US code (trimmed, upper-cased), email as create() always stored it,
 * and a phone on the DNC list is refused. With { partial: true } (an edit),
 * only the fields actually present are checked. Returns the cleaned values.
 */
async function validateLeadInput(input, { partial = false } = {}) {
  const present = (key) => !partial || input[key] !== undefined;
  const clean = {};

  if (present('name')) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new ApiError(400, 'Name is required');
    if (name.length > MAX_NAME_LENGTH) {
      throw new ApiError(400, `Name is too long (${MAX_NAME_LENGTH} characters max)`);
    }
    clean.name = name;
  }
  if (present('phone')) {
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone) throw new ApiError(400, 'Enter a valid 10-digit US phone number');
    clean.phone = normalizedPhone;
  }
  if (present('state')) {
    const normalizedState = String(input.state || '').trim().toUpperCase();
    if (!US_STATES.includes(normalizedState)) throw new ApiError(400, 'Enter a valid US state');
    clean.state = normalizedState;
  }
  if (present('email')) clean.email = input.email || null;

  if (clean.phone && (await dncCheck.isOnDncList(clean.phone))) {
    throw new ApiError(409, 'This number is on the DNC list and cannot be added as a lead');
  }
  return clean;
}

/**
 * Creates a new lead directly — the manual dial pad's optional "Save as
 * lead" form (see AppShell.jsx / DialPad.jsx) is the one hand-entry path in
 * an app where every other lead comes from a CSV import, so it applies the
 * same phone validation and DNC block CLAUDE.md requires of imports.
 */
async function create({ name, phone, state, email = null, address = null, brokerage = null }) {
  const valid = await validateLeadInput({ name, phone, state, email });
  const normalizedPhone = valid.phone;
  const normalizedState = valid.state;

  try {
    const { rows } = await db.query(
      `INSERT INTO leads (name, phone, email, address, brokerage, state, status, office_key, tz_zones)
       VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
       RETURNING *`,
      [
        valid.name,
        normalizedPhone,
        valid.email,
        address || null,
        brokerage || null,
        normalizedState,
        buildOfficeKey({ brokerage, address, state: normalizedState }),
        callingHours.zonesForLead({ phone: normalizedPhone, state: normalizedState, address }),
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
  const requested = EDITABLE_FIELDS.some((f) => fields[f] !== undefined);
  const { rows: currentRows } = await db.query('SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
  const current = currentRows[0];
  if (!current) throw new ApiError(404, 'Lead not found');

  // The edit form sends every field. A blank phone on a lead that has no
  // number yet (imported without one) means "no change", not "invalid".
  if (current.phone == null && fields.phone !== undefined && String(fields.phone ?? '').trim() === '') {
    fields = { ...fields, phone: undefined };
  }
  // Likewise the number the lead already has is not a change.
  if (fields.phone !== undefined && current.phone && normalizePhone(fields.phone) === current.phone) {
    fields = { ...fields, phone: undefined };
  }
  // A DNC lead's number is fixed: changing it would let the person be
  // dialed under a "new" number. Other fields stay editable.
  if (fields.phone !== undefined && (current.dnc_flag || current.status === 'dnc')) {
    throw new ApiError(409, "This lead is on the DNC list; its number can't be changed");
  }

  const keys = EDITABLE_FIELDS.filter((f) => fields[f] !== undefined);
  if (keys.length === 0) {
    // Only an unchanged phone was sent: nothing to save.
    if (requested) return current;
    throw new ApiError(400, 'No editable fields provided');
  }

  // Same rules as create() for the fields being edited: name, E.164 phone
  // (never a DNC-listed number — that was how a DNC'd number got dialed),
  // US state, email. address/brokerage are stored as given, as before.
  const values = { ...fields, ...(await validateLeadInput(fields, { partial: true })) };

  const setSql = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  let rows;
  try {
    ({ rows } = await db.query(
      `UPDATE leads SET ${setSql}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [leadId, ...keys.map((k) => values[k])]
    ));
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'A lead with this phone number already exists');
    throw err;
  }
  if (!rows[0]) throw new ApiError(404, 'Lead not found');

  // A new number can take a lead out of a phone-related dead end; that
  // status change belongs to leadLifecycle, not to this plain field edit.
  let updated = rows[0];
  if (updated.phone !== current.phone) {
    updated = (await leadLifecycle.phoneNumberChanged(leadId)) || updated;
  }

  // A new phone, state or address can change the lead's time zone(s).
  const zones = callingHours.zonesForLead(updated);
  if (JSON.stringify(zones) !== JSON.stringify(updated.tz_zones)) {
    const { rows: rezoned } = await db.query('UPDATE leads SET tz_zones = $2 WHERE id = $1 RETURNING *', [leadId, zones]);
    updated = rezoned[0];
  }

  // Editing brokerage/address/state changes which office this lead belongs
  // to, so the stored key would otherwise go stale.
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
  backfillZones,
  candidates,
  peekNext,
  lockNext,
  refreshOwnLock,
  create,
  getById,
  getHistory,
  addTag,
  removeTag,
  addNote,
  listNotes,
  countsByState,
  list,
  updateFields,
  softDelete,
  search,
  batchQueue,
};
