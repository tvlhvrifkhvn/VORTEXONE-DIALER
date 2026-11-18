// Clearing a scheduled callback (owner's rule, after C8C): the lead goes back
// to `in_queue`, dialable right away (next_action_at NULL), and its open
// callbacks rows are marked done. Only a lead in `callback_scheduled` can be
// cleared (409 otherwise), so a locked or DNC lead is never touched.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

async function clearCallback({ leadId }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: current } = await client.query('SELECT id, status FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [leadId]);
    if (!current[0]) throw new ApiError(404, 'Lead not found');
    if (current[0].status !== 'callback_scheduled') throw new ApiError(409, 'This lead has no scheduled callback');
    const { rows } = await client.query(
      `UPDATE leads SET status = 'in_queue', next_action_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [leadId]
    );
    await client.query('UPDATE callbacks SET done = true WHERE lead_id = $1 AND done = false', [leadId]);
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { clearCallback };
