const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

// Whitelisted so incrementStat can never be handed an arbitrary column name
// via string interpolation.
const STAT_COLUMNS = [
  'total_dials',
  'total_contacts',
  'total_voicemails',
  'total_no_answers',
  'total_callbacks',
  'total_dnc',
];

// Maps a disposition to the dialing_sessions stat column it bumps.
// no_contact_number/no_contact_person have no dedicated column in this
// schema, so they only ever count toward total_dials (see calls.js).
const DISPOSITION_TO_STAT = {
  contacted: 'total_contacts',
  voicemail: 'total_voicemails',
  no_answer: 'total_no_answers',
  callback_scheduled: 'total_callbacks',
  dnc: 'total_dnc',
};

async function startSession(userId, mode = 'power') {
  const { rows } = await db.query(
    'INSERT INTO dialing_sessions (user_id, mode) VALUES ($1, $2) RETURNING id',
    [userId, mode]
  );
  return rows[0].id;
}

async function endSession(sessionId) {
  const { rows } = await db.query(
    'UPDATE dialing_sessions SET ended_at = now() WHERE id = $1 RETURNING *',
    [sessionId]
  );
  if (!rows[0]) throw new ApiError(404, 'Dialing session not found');
  return rows[0];
}

async function incrementStat(sessionId, statName) {
  if (!STAT_COLUMNS.includes(statName)) {
    throw new ApiError(400, `Unknown dialing session stat: ${statName}`);
  }
  await db.query(`UPDATE dialing_sessions SET ${statName} = ${statName} + 1 WHERE id = $1`, [sessionId]);
}

async function getSessionStats(sessionId) {
  const { rows } = await db.query('SELECT * FROM dialing_sessions WHERE id = $1', [sessionId]);
  return rows[0] || null;
}

module.exports = { STAT_COLUMNS, DISPOSITION_TO_STAT, startSession, endSession, incrementStat, getSessionStats };
