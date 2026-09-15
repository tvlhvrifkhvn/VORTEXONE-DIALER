const db = require('../db');
const telephony = require('../telephony');

// Reserved-for-fiction NANP range (555-0100 through 555-0199) — safe
// placeholder until phone_numbers is populated with real numbers in phase 2.
const MOCK_FROM_NUMBER = '+15555550100';

/**
 * Starts a telephony call for an already-locked lead and records it. All
 * live progress (ringing/answered/voicemail_detected/ended) is persisted to
 * the call_history row as it arrives so the call screen can just poll
 * GET /api/calls/:id — no in-memory state, nothing lost on a restart.
 */
async function start({ lead, userId, sessionId = null }) {
  const fromNumber = MOCK_FROM_NUMBER;

  const { rows } = await db.query(
    `INSERT INTO call_history (lead_id, user_id, from_number, was_mock, telephony_state, session_id)
     VALUES ($1, $2, $3, true, 'ringing', $4)
     RETURNING *`,
    [lead.id, userId, fromNumber, sessionId]
  );
  const call = rows[0];

  await db.query('UPDATE leads SET attempts = attempts + 1, updated_at = now() WHERE id = $1', [lead.id]);

  const telephonyCallId = telephony.placeCall(fromNumber, lead.phone, (event) => {
    const nextState = event.type; // 'ringing' | 'answered' | 'voicemail_detected' | 'ended'
    db.query('UPDATE call_history SET telephony_state = $2 WHERE id = $1', [call.id, nextState]).catch((err) => {
      console.error(`Failed to record telephony event "${event.type}" for call ${call.id}:`, err.message);
    });
  });

  await db.query('UPDATE call_history SET telephony_call_id = $2 WHERE id = $1', [call.id, telephonyCallId]);

  return { ...call, telephony_call_id: telephonyCallId, attempts: lead.attempts + 1 };
}

async function get(callHistoryId) {
  const { rows } = await db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId]);
  return rows[0] || null;
}

module.exports = { start, get, MOCK_FROM_NUMBER };
