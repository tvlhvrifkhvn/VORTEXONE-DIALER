const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const dncCheck = require('./dncCheck');
const dialingSession = require('./dialingSession');

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
async function applyDisposition({ callHistoryId, disposition, note, scheduledAt }) {
  if (!DISPOSITIONS.includes(disposition)) {
    throw new ApiError(400, `Unknown disposition: ${disposition}`);
  }
  if (disposition === 'callback_scheduled' && !scheduledAt) {
    throw new ApiError(400, 'scheduledAt is required for callback_scheduled');
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
    if (call.disposition) throw new ApiError(409, 'Call already has a disposition');

    const { rows: leadRows } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [call.lead_id]);
    const lead = leadRows[0];
    if (!lead) throw new ApiError(404, 'Lead not found');

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
        status: 'callback_scheduled', next_action_at: new Date(scheduledAt),
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
        [lead.id, scheduledAt, note || null]
      );
    }

    let cascadedLeadIds = [];
    if (disposition === 'no_contact_person') {
      // Best-effort match on the same person across separate lead rows —
      // phase 1 has no explicit person entity, so this matches by name only.
      // Undo does not reverse this cascade (see undoDisposition).
      const { rows: siblings } = await client.query(
        `UPDATE leads
         SET status = 'cold', cold_at = $2, cold_reason = 'no_contact_person', next_action_at = NULL, updated_at = $2
         WHERE id != $1
           AND lower(trim(name)) = lower(trim($3))
           AND status NOT IN ('dnc', 'cold')
         RETURNING id`,
        [lead.id, now, lead.name]
      );
      cascadedLeadIds = siblings.map((r) => r.id);
    }

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
      cascadedLeadIds,
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
 * call_history row so a new disposition can be submitted. Does not reverse
 * a no_contact_person cascade to sibling leads.
 */
async function undoDisposition({ callHistoryId }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: callRows } = await client.query(
      'SELECT * FROM call_history WHERE id = $1 FOR UPDATE',
      [callHistoryId]
    );
    const call = callRows[0];
    if (!call) throw new ApiError(404, 'Call not found');
    if (!call.disposition || !call.pre_disposition_snapshot || !call.disposition_at) {
      throw new ApiError(409, 'Nothing to undo for this call');
    }

    const ageSeconds = (Date.now() - new Date(call.disposition_at).getTime()) / 1000;
    if (ageSeconds > UNDO_WINDOW_SECONDS) {
      throw new ApiError(410, 'Undo window has expired');
    }

    const snapshot = call.pre_disposition_snapshot;

    if (call.disposition === 'dnc') {
      await client.query(
        'DELETE FROM dnc_list WHERE lead_id = $1',
        [call.lead_id]
      );
    }
    if (call.disposition === 'callback_scheduled') {
      await client.query(
        'DELETE FROM callbacks WHERE lead_id = $1 AND done = false ORDER BY created_at DESC LIMIT 1',
        [call.lead_id]
      );
    }

    await client.query(
      `UPDATE leads
       SET status = $2, attempts = $3, next_action_at = $4, notes_count = $5,
           cold_at = $6, cold_reason = $7, dnc_flag = $8, locked_by = $9, locked_at = $10, updated_at = now()
       WHERE id = $1`,
      [
        call.lead_id, snapshot.status, snapshot.attempts, snapshot.next_action_at, snapshot.notes_count,
        snapshot.cold_at, snapshot.cold_reason, snapshot.dnc_flag, snapshot.locked_by, snapshot.locked_at,
      ]
    );

    await client.query(
      `UPDATE call_history
       SET disposition = NULL, note = NULL, ended_at = NULL, duration_seconds = NULL,
           pre_disposition_snapshot = NULL, disposition_at = NULL
       WHERE id = $1`,
      [callHistoryId]
    );

    const { rows: leadRows } = await client.query('SELECT * FROM leads WHERE id = $1', [call.lead_id]);
    await client.query('COMMIT');
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
async function hangup({ callHistoryId }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: callRows } = await client.query(
      'SELECT * FROM call_history WHERE id = $1 FOR UPDATE',
      [callHistoryId]
    );
    const call = callRows[0];
    if (!call) throw new ApiError(404, 'Call not found');
    if (call.disposition) throw new ApiError(409, 'Call already has a disposition');

    const now = new Date();
    if (!call.ended_at) {
      const durationSeconds = Math.max(0, Math.round((now - new Date(call.started_at)) / 1000));
      await client.query(
        'UPDATE call_history SET ended_at = $2, duration_seconds = $3, was_abandoned = true WHERE id = $1',
        [callHistoryId, now, durationSeconds]
      );
    }

    await client.query(
      `UPDATE leads SET locked_at = $2, updated_at = $2 WHERE id = $1 AND status = 'in_progress'`,
      [call.lead_id, now]
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

module.exports = {
  DISPOSITIONS,
  UNDO_WINDOW_SECONDS,
  applyDisposition,
  undoDisposition,
  hangup,
  snooze,
};
