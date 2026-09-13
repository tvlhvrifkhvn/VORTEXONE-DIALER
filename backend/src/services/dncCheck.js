const db = require('../db');

async function isOnDncList(phone) {
  const { rows } = await db.query('SELECT 1 FROM dnc_list WHERE phone = $1', [phone]);
  return rows.length > 0;
}

/** Adds a phone to the DNC list. Idempotent — re-adding the same phone is a no-op. */
async function addToDncList(phone, { source = 'manual', leadId = null, client = db } = {}) {
  const { rows } = await client.query(
    `INSERT INTO dnc_list (phone, source, lead_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO NOTHING
     RETURNING id`,
    [phone, source, leadId]
  );
  return rows[0]?.id ?? null;
}

async function removeFromDncList(id, { client = db } = {}) {
  await client.query('DELETE FROM dnc_list WHERE id = $1', [id]);
}

async function listDnc() {
  const { rows } = await db.query('SELECT * FROM dnc_list ORDER BY added_at DESC');
  return rows;
}

module.exports = { isOnDncList, addToDncList, removeFromDncList, listDnc };
