const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * The telephony adapter reported { type: 'ended', duration } — the network
 * ended the call (no answer, voicemail greeting finished, busy, the other
 * side hung up). Closes the call_history row in the same statement that
 * records the state, so a call the network ended never looks "still live"
 * to the stale-lock sweep (leadQueue.releaseStaleLocks).
 *
 * Never overwrites what a hangup or disposition already wrote: ended_at and
 * duration_seconds are COALESCEd. When this event is what ended the call
 * (ended_at was still empty, no disposition yet) and the lead is still
 * in_progress and locked to the rep who placed the call, the lead's
 * locked_at is set to now — the 30 s no-disposition grace starts at the
 * call's end, the same as after a hangup (leadLifecycle.hangup).
 *
 * Used for every call the adapter places: single-line (callSession.start),
 * manual dial pad (callSession.startManual, no lead) and multi-line slots
 * (callSession.placeSlotCall).
 */
async function markEnded(callHistoryId, durationSeconds) {
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds)) : null;
  await db.query(
    `WITH prev AS (
       SELECT id, ended_at AS prev_ended_at FROM call_history WHERE id = $1 FOR UPDATE
     ), closed AS (
       UPDATE call_history c
       SET telephony_state = 'ended',
           ended_at = COALESCE(c.ended_at, now()),
           duration_seconds = COALESCE(c.duration_seconds, $2,
             GREATEST(0, EXTRACT(EPOCH FROM (now() - c.started_at))::int))
       FROM prev
       WHERE c.id = prev.id AND c.telephony_state <> 'failed'
       RETURNING c.lead_id, c.user_id, c.disposition, prev.prev_ended_at
     )
     UPDATE leads l
     SET locked_at = now(), updated_at = now()
     FROM closed
     WHERE l.id = closed.lead_id
       AND closed.prev_ended_at IS NULL
       AND closed.disposition IS NULL
       AND l.status = 'in_progress'
       AND l.locked_by = closed.user_id`,
    [callHistoryId, duration]
  );
}

/**
 * Who may disposition, undo or hang up a call: the rep who placed it (for a
 * multi-line slot, the session owner — slot calls carry the session's
 * user_id) or a supervisor. `user` is the JWT payload ({ sub, email, role }).
 * Internal callers that act for the session itself (multi-line releaseSlot)
 * pass no user and skip the check. 403 otherwise.
 */
function assertCanActOn(call, user) {
  if (!user) return;
  if (user.role === 'supervisor') return;
  if (Number(call.user_id) !== Number(user.sub)) {
    throw new ApiError(403, 'This call belongs to another rep.');
  }
}

/**
 * The lead moved on to someone else after this call (e.g. its lock expired
 * and another rep dialed it): an action on the old call must not change the
 * lead under the new rep. A lead with no lock (locked_by NULL) is allowed,
 * as before. 409 otherwise.
 */
function assertLeadNotTaken(call, lead) {
  if (lead && lead.locked_by != null && Number(lead.locked_by) !== Number(call.user_id)) {
    throw new ApiError(409, 'This lead is now with another rep.');
  }
}

/**
 * The telephony provider refused to place the call (placeCall threw): the
 * row is closed as 'failed' so no phantom "ringing" call is left behind.
 * Events that still arrive for it are ignored (they check for 'failed').
 */
async function markFailed(callHistoryId) {
  await db.query(
    `UPDATE call_history
     SET telephony_state = 'failed', ended_at = COALESCE(ended_at, now()), duration_seconds = COALESCE(duration_seconds, 0)
     WHERE id = $1`,
    [callHistoryId]
  );
}

module.exports = { markEnded, markFailed, assertCanActOn, assertLeadNotTaken };
