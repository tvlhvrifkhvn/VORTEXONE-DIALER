const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const dncCheck = require('./dncCheck');
const dialingSession = require('./dialingSession');
const callLifecycle = require('./callLifecycle');

const UNDO_WINDOW_SECONDS = 10;
const REQUEUE_HOURS = 4;
const SNOOZE_HOURS = 1;
const HANGUP_GRACE_SECONDS = 30;

// The six disposition buttons, plus 'callback_scheduled' — also triggered
// from the call screen (see routes/calls.js) and just as much a call outcome
// worth recording, even though it isn't one of the six colored buttons.
const DISPOSITIONS = [
  'contacted',
  'voicemail',
  'no_answer',
  'no_contact_number',
  'no_contact_person',
  'dnc',
  'callback_scheduled',
];

// Clock-skew allowance for "is this callback time in the past?".
const CALLBACK_PAST_TOLERANCE_MS = 60 * 1000;

/** Parses a callback time; 400 with a plain message when it isn't a real
 * date and time. Shared by the disposition path (applyDisposition) and the
 * lead page's callback route (leadQueue.scheduleCallback). */
function parseCallbackTime(scheduledAt) {
  const when = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(when.getTime())) {
    throw new ApiError(400, 'A valid callback date and time is required');
  }
  return when;
}

function snapshotOf(lead) {
  return {
    status: lead.status,
    attempts: lead.attempts,
    next_action_at: lead.next_action_at,
    notes_count: lead.notes_count,
    cold_at: lead.cold_at,
    cold_reason: lead.cold_reason,
    dnc_flag: lead.dnc_flag,
    locked_by: lead.locked_by,
    locked_at: lead.locked_at,
  };
}

/**
 * Submits the outcome of an in-progress call. Ends the call_history row
 * (if not already ended by a prior hangup) and transitions the lead per the
 * rules in CLAUDE.md. Stores a snapshot of the lead's pre-disposition state
 * so undoDisposition() can restore it within the 10s undo window.
 */
async function applyDisposition({ callHistoryId, disposition, note, scheduledAt, user }) {
  if (!DISPOSITIONS.includes(disposition)) {
    throw new ApiError(400, `Unknown disposition: ${disposition}`);
  }
  let callbackAt = null;
  if (disposition === 'callback_scheduled') {
    callbackAt = parseCallbackTime(scheduledAt);
    if (callbackAt.getTime() < Date.now() - CALLBACK_PAST_TOLERANCE_MS) {
      throw new ApiError(400, 'That callback time is in the past — pick a time from now on');
    }
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: callRows } = await client.query(
      'SELECT * FROM call_history WHERE id = $1 FOR UPDATE',
      [callHistoryId]
    );
    const call = callRows[0];
    if (!call) throw new ApiError(404, 'Call not found');
    callLifecycle.assertCanActOn(call, user);
    if (call.disposition) throw new ApiError(409, 'Call already has a disposition');

    const { rows: leadRows } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [call.lead_id]);
    const lead = leadRows[0];
    if (!lead) throw new ApiError(404, 'Lead not found');
    callLifecycle.assertLeadNotTaken(call, lead);

    const snapshot = snapshotOf(lead);
    const now = new Date();
    const endedAt = call.ended_at || now;
    const durationSeconds =
      call.duration_seconds ?? Math.max(0, Math.round((endedAt - new Date(call.started_at)) / 1000));

    const updates = { updated_at: now };

    if (disposition === 'contacted') {
      Object.assign(updates, { status: 'contacted', next_action_at: null, locked_by: null, locked_at: null });
    } else if (disposition === 'voicemail' || disposition === 'no_answer') {
      if (lead.attempts >= lead.max_attempts) {
        Object.assign(updates, {
          status: 'cold', cold_at: now, cold_reason: 'max_attempts',
          next_action_at: null, locked_by: null, locked_at: null,
        });
      } else {
        Object.assign(updates, {
          status: disposition,
          next_action_at: new Date(now.getTime() + REQUEUE_HOURS * 60 * 60 * 1000),
          locked_by: null, locked_at: null,
        });
      }
    } else if (disposition === 'no_contact_number') {
      Object.assign(updates, { status: 'no_contact_number', next_action_at: null, locked_by: null, locked_at: null });
    } else if (disposition === 'no_contact_person') {
      Object.assign(updates, {
        status: 'cold', cold_at: now, cold_reason: 'no_contact_person',
        next_action_at: null, locked_by: null, locked_at: null,
      });
    } else if (disposition === 'dnc') {
      Object.assign(updates, { status: 'dnc', dnc_flag: true, next_action_at: null, locked_by: null, locked_at: null });
    } else if (disposition === 'callback_scheduled') {
      Object.assign(updates, {
        status: 'callback_scheduled', next_action_at: callbackAt,
        locked_by: null, locked_at: null,
      });
    }

    if (note) {
      updates.notes_count = lead.notes_count + 1;
    }

    const setKeys = Object.keys(updates);
    const setSql = setKeys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const { rows: updatedRows } = await client.query(
      `UPDATE leads SET ${setSql} WHERE id = $1 RETURNING *`,
      [lead.id, ...setKeys.map((k) => updates[k])]
    );
    const updatedLead = updatedRows[0];

    if (disposition === 'dnc') {
      await dncCheck.addToDncList(lead.phone, { source: 'manual', leadId: lead.id, client });
    }

    if (disposition === 'callback_scheduled') {
      await client.query(
        'INSERT INTO callbacks (lead_id, scheduled_at, note) VALUES ($1, $2, $3)',
        [lead.id, callbackAt, note || null]
      );
    }

    // no_contact_person parks this lead only. A lead has one phone, and
    // CLAUDE.md scopes the rule to "that lead" — there is no cascade to other
    // leads with the same name (removed: it parked different people in other
    // states, and undo could not reverse it).

    // Recording eligibility: only a real conversation ('contacted') is ever
    // recorded — voicemail/no_answer/busy/no_contact_*/dnc never are.
    // recording_url stays null; Phase 2 fills it via Twilio's webhook.
    const wasRecorded = disposition === 'contacted';

    await client.query(
      `UPDATE call_history
       SET disposition = $2, note = $3, ended_at = $4, duration_seconds = $5,
           pre_disposition_snapshot = $6, disposition_at = $7, was_recorded = $8
       WHERE id = $1`,
      [callHistoryId, disposition, note || null, endedAt, durationSeconds, JSON.stringify(snapshot), now, wasRecorded]
    );

    await client.query('COMMIT');

    // Best-effort — a dialing session may not be active (e.g. a lead dialed
    // directly from the table rather than via Start Dialing).
    if (call.session_id) {
      const statColumn = dialingSession.DISPOSITION_TO_STAT[disposition];
      if (statColumn) await dialingSession.incrementStat(call.session_id, statColumn);
    }

    return {
      lead: updatedLead,
      undoExpiresAt: new Date(now.getTime() + UNDO_WINDOW_SECONDS * 1000),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reverts the most recent disposition on a call within the 10s undo window,
 * restoring the lead to its pre-disposition state and reopening the same
 * call_history row so a new disposition can be submitted. Every disposition
 * changes only its own lead, so restoring that lead (plus the callback /
 * DNC-list row it created) undoes it completely.
 */
async function undoDisposition({ callHistoryId, user }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: callRows } = await client.query(
      'SELECT * FROM call_history WHERE id = $1 FOR UPDATE',
      [callHistoryId]
    );
    const call = callRows[0];
    if (!call) throw new ApiError(404, 'Call not found');
    callLifecycle.assertCanActOn(call, user);
    if (!call.disposition || !call.pre_disposition_snapshot || !call.disposition_at) {
      throw new ApiError(409, 'Nothing to undo for this call');
    }

    const ageSeconds = (Date.now() - new Date(call.disposition_at).getTime()) / 1000;
    if (ageSeconds > UNDO_WINDOW_SECONDS) {
      throw new ApiError(410, 'Undo window has expired');
    }

    const { rows: currentLead } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [call.lead_id]);
    callLifecycle.assertLeadNotTaken(call, currentLead[0]);

    const snapshot = call.pre_disposition_snapshot;

    if (call.disposition === 'dnc') {
      await client.query(
        'DELETE FROM dnc_list WHERE lead_id = $1',
        [call.lead_id]
      );
    }
    if (call.disposition === 'callback_scheduled') {
      // Postgres DELETE takes no ORDER BY / LIMIT: pick the newest open row first.
      await client.query(
        `DELETE FROM callbacks
         WHERE id = (SELECT id FROM callbacks WHERE lead_id = $1 AND done = false ORDER BY created_at DESC LIMIT 1)`,
        [call.lead_id]
      );
    }

    // A lead restored to in_progress gets a fresh locked_at: the 30 s grace
    // for the new disposition starts now, not when the call was placed.
    await client.query(
      `UPDATE leads
       SET status = $2, attempts = $3, next_action_at = $4, notes_count = $5,
           cold_at = $6, cold_reason = $7, dnc_flag = $8, locked_by = $9,
           locked_at = CASE WHEN $2 = 'in_progress' THEN now() ELSE $10::timestamptz END, updated_at = now()
       WHERE id = $1`,
      [
        call.lead_id, snapshot.status, snapshot.attempts, snapshot.next_action_at, snapshot.notes_count,
        snapshot.cold_at, snapshot.cold_reason, snapshot.dnc_flag, snapshot.locked_by, snapshot.locked_at,
      ]
    );

    // ended_at / duration_seconds stay: the call itself did end. Only the
    // disposition is reopened — clearing ended_at would make the row look
    // like a live call and keep the lead locked until the sweep's ceiling.
    await client.query(
      `UPDATE call_history
       SET disposition = NULL, note = NULL,
           pre_disposition_snapshot = NULL, disposition_at = NULL
       WHERE id = $1`,
      [callHistoryId]
    );

    const { rows: leadRows } = await client.query('SELECT * FROM leads WHERE id = $1', [call.lead_id]);
    await client.query('COMMIT');

    // Best-effort, mirroring applyDisposition: take back the session stat the
    // disposition counted.
    if (call.session_id) {
      const statColumn = dialingSession.DISPOSITION_TO_STAT[call.disposition];
      if (statColumn) await dialingSession.decrementStat(call.session_id, statColumn);
    }
    return leadRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Rep hung up without choosing a disposition. Ends the call timer but keeps
 * the lead locked for a grace period so a late disposition can still land —
 * leadQueue.releaseStaleLocks() will return it to in_queue once locked_at is
 * older than HANGUP_GRACE_SECONDS.
 */
async function hangup({ callHistoryId, user }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: callRows } = await client.query(
      'SELECT * FROM call_history WHERE id = $1 FOR UPDATE',
      [callHistoryId]
    );
    const call = callRows[0];
    if (!call) throw new ApiError(404, 'Call not found');
    callLifecycle.assertCanActOn(call, user);
    if (call.disposition) throw new ApiError(409, 'Call already has a disposition');

    const { rows: leadRows } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [call.lead_id]);
    callLifecycle.assertLeadNotTaken(call, leadRows[0]);

    const now = new Date();
    if (!call.ended_at) {
      const durationSeconds = Math.max(0, Math.round((now - new Date(call.started_at)) / 1000));
      await client.query(
        'UPDATE call_history SET ended_at = $2, duration_seconds = $3, was_abandoned = true WHERE id = $1',
        [callHistoryId, now, durationSeconds]
      );
    }

    await client.query(
      `UPDATE leads SET locked_at = $2, updated_at = $2 WHERE id = $1 AND status = 'in_progress' AND locked_by = $3`,
      [call.lead_id, now, call.user_id]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { gracePeriodSeconds: HANGUP_GRACE_SECONDS };
}

/** "Not now" — pushes a lead to the back of the queue without counting as a dial attempt. */
async function snooze({ leadId }) {
  const { rows } = await db.query(
    `UPDATE leads
     SET next_action_at = now() + interval '${SNOOZE_HOURS} hours',
         status = CASE WHEN status = 'new' THEN 'in_queue' ELSE status END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [leadId]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
}

/**
 * The lead's phone number was just changed (leadQueue.updateFields calls this
 * after saving the new number). A lead parked as no_contact_number because
 * its number was bad goes back to in_queue: attempts are kept, next_action_at
 * is cleared, and a timeline note records why. Any other status is left as
 * it is. Returns the lead as it now stands.
 */
async function phoneNumberChanged(leadId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [leadId]);
    let lead = rows[0];
    if (lead && lead.status === 'no_contact_number' && lead.phone) {
      ({ rows: [lead] } = await client.query(
        `UPDATE leads
         SET status = 'in_queue', next_action_at = NULL, notes_count = notes_count + 1, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [leadId]
      ));
      await client.query('INSERT INTO lead_notes (lead_id, body) VALUES ($1, $2)', [
        leadId,
        'Number changed, back in queue',
      ]);
    }
    await client.query('COMMIT');
    return lead || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** The queue picked a lead whose number is already on the DNC list (added
 * after import, or by another lead): park it as dnc so it is never served
 * again. Mirrors what multi-line reserveSlot does on the same hit. */
async function markDncFromQueue(leadId) {
  const { rows } = await db.query(
    `UPDATE leads
     SET status = 'dnc', dnc_flag = true, next_action_at = NULL,
         locked_by = NULL, locked_at = NULL, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [leadId]
  );
  return rows[0] || null;
}

module.exports = {
  DISPOSITIONS,
  parseCallbackTime,
  UNDO_WINDOW_SECONDS,
  applyDisposition,
  undoDisposition,
  hangup,
  snooze,
  markDncFromQueue,
  phoneNumberChanged,
};
