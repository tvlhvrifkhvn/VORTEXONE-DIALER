// The manual dial pad (C8F): touch tones, the RECORD switch, live notes, the
// recent manual calls, and the lead a dialed number belongs to. Manual calls
// still never touch a lead's status or attempts (callSession.startManual /
// endManualCall); the only thing that reaches the lead is the call's notes,
// copied once as a note "Manual call · m:ss · <notes>" when the call ends (or
// when notes arrive after it ended), then kept in step with later edits.
const db = require('../db');
const telephony = require('../telephony');
const callLifecycle = require('./callLifecycle');
const { ApiError } = require('../middleware/errorHandler');
const { normalizePhone } = require('../utils/phoneNormalize');

const DIGITS_RE = /^[0-9*#]{1,32}$/;
const MAX_NOTES = 5000;
const NOTES_WINDOW_MS = 24 * 3600 * 1000;
const RECENT_LIMIT = 10;
const NOT_AVAILABLE = 'Not available with this provider yet';

function isLive(call) {
  return !call.ended_at && !['ended', 'failed'].includes(call.telephony_state);
}

/** The caller's own call (or any, for a supervisor): 404 / 403 otherwise. */
async function ownCall(callId, user) {
  const id = Number(callId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, 'Call not found');
  const { rows } = await db.query('SELECT * FROM call_history WHERE id = $1', [id]);
  if (!rows[0]) throw new ApiError(404, 'Call not found');
  callLifecycle.assertCanActOn(rows[0], user);
  return rows[0];
}

/** The lead a number belongs to (leads.phone is unique), or null. */
async function leadForNumber(number) {
  const phone = normalizePhone(number);
  if (!phone) return null;
  const { rows } = await db.query(
    `SELECT id, name, brokerage, state, status, campaign_id FROM leads
     WHERE phone = $1 AND deleted_at IS NULL AND merged_into IS NULL`,
    [phone]
  );
  return rows[0] || null;
}

function mss(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function sendDigits({ callId, user, digits }) {
  const text = typeof digits === 'string' ? digits : '';
  if (!DIGITS_RE.test(text)) throw new ApiError(400, 'Digits are 0-9, * and #, 1 to 32 of them');
  const call = await ownCall(callId, user);
  if (!telephony.supports('digits')) throw new ApiError(501, NOT_AVAILABLE);
  if (!isLive(call)) throw new ApiError(409, 'The call has ended');
  await telephony.sendDigits(call.telephony_call_id, text);
  return { sent: text };
}

async function setRecording({ callId, user, on }) {
  if (typeof on !== 'boolean') throw new ApiError(400, '`on` must be true or false');
  const call = await ownCall(callId, user);
  if (!telephony.supports('recording')) throw new ApiError(501, NOT_AVAILABLE);
  if (!isLive(call)) throw new ApiError(409, 'The call has ended');
  await telephony.setRecording(call.telephony_call_id, on);
  const { rows } = await db.query('UPDATE call_history SET recording = $2 WHERE id = $1 RETURNING id, recording', [call.id, on]);
  return rows[0];
}

/**
 * Copies a manual call's notes to the lead its number belongs to: the first
 * time as a new note, afterwards by updating that same note. Only for an
 * ended manual call with notes and a matching lead; otherwise nothing.
 */
async function copyNotesToLead(callId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM call_history WHERE id = $1 FOR UPDATE', [callId]);
    const call = rows[0];
    const notes = (call?.notes || '').trim();
    if (!call || !call.is_manual || isLive(call) || !notes) {
      await client.query('COMMIT');
      return null;
    }
    const lead = await leadForNumber(call.to_number);
    if (!lead) {
      await client.query('COMMIT');
      return null;
    }
    const body = `Manual call · ${mss(call.duration_seconds)} · ${notes}`;
    let note = null;
    if (call.notes_note_id) {
      ({ rows: [note] } = await client.query('UPDATE lead_notes SET body = $2 WHERE id = $1 RETURNING *', [call.notes_note_id, body]));
    }
    if (!note) {
      ({ rows: [note] } = await client.query(
        'INSERT INTO lead_notes (lead_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
        [lead.id, call.user_id, body]
      ));
      await client.query('UPDATE leads SET notes_count = notes_count + 1, updated_at = now() WHERE id = $1', [lead.id]);
      await client.query('UPDATE call_history SET notes_note_id = $2 WHERE id = $1', [call.id, note.id]);
    }
    await client.query('COMMIT');
    return note;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function saveNotes({ callId, user, notes }) {
  if (typeof notes !== 'string') throw new ApiError(400, 'Notes must be text');
  if (notes.length > MAX_NOTES) throw new ApiError(400, `Notes are at most ${MAX_NOTES.toLocaleString('en-US')} characters`);
  const call = await ownCall(callId, user);
  if (!isLive(call) && call.ended_at && Date.now() - new Date(call.ended_at).getTime() > NOTES_WINDOW_MS) {
    throw new ApiError(409, 'Notes can be changed until 24 hours after the call');
  }
  await db.query('UPDATE call_history SET notes = $2 WHERE id = $1', [call.id, notes]);
  const note = isLive(call) ? null : await copyNotesToLead(call.id);
  return { notes, copiedTo: note ? note.lead_id : null };
}

/** The lead a call's number belongs to (the dial pad shows it during the call). */
async function leadForCall({ callId, user }) {
  const call = await ownCall(callId, user);
  return leadForNumber(call.to_number);
}

/** The caller's last 10 manual calls: number, time, duration, matched lead. */
async function recent(user) {
  const { rows } = await db.query(
    `SELECT ch.id, ch.to_number, ch.started_at, ch.ended_at, ch.duration_seconds, ch.recording,
            l.id AS lead_id, l.name AS lead_name
     FROM call_history ch
     LEFT JOIN leads l ON l.phone = ch.to_number AND l.deleted_at IS NULL AND l.merged_into IS NULL
     WHERE ch.is_manual AND ch.user_id = $1
     ORDER BY ch.started_at DESC, ch.id DESC
     LIMIT ${RECENT_LIMIT}`,
    [user.sub]
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.to_number,
    startedAt: r.started_at,
    durationSeconds: r.duration_seconds,
    recording: r.recording,
    lead: r.lead_id ? { id: r.lead_id, name: r.lead_name } : null,
  }));
}

module.exports = { sendDigits, setRecording, saveNotes, copyNotesToLead, leadForCall, recent, NOT_AVAILABLE };
