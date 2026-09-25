const db = require('../db');

function withConnectRate(row) {
  return {
    ...row,
    connectRate: row.dials > 0 ? Math.round((row.contacts / row.dials) * 100) : 0,
  };
}

/** Dials/contacts/connect-rate for today — powers the dashboard stat cards. */
async function todayStats() {
  const { rows } = await db.query(
    `SELECT
       count(*)::int AS dials,
       count(*) FILTER (WHERE disposition = 'contacted')::int AS contacts
     FROM call_history
     WHERE started_at >= date_trunc('day', now())`
  );
  return withConnectRate(rows[0]);
}

/** Per-state contact counts and connect rate — powers the /reports page. */
async function perStateReport() {
  const { rows } = await db.query(
    `SELECT l.state,
            count(ch.id)::int AS dials,
            count(*) FILTER (WHERE ch.disposition = 'contacted')::int AS contacts
     FROM leads l
     LEFT JOIN call_history ch ON ch.lead_id = l.id
     GROUP BY l.state
     ORDER BY l.state ASC`
  );
  return rows.map(withConnectRate);
}

/** Today's ad-hoc dial-pad calls (no lead) — the per-state report can't
 * carry these (no lead means no state), so they get their own small list. */
async function manualCallsToday() {
  const { rows } = await db.query(
    `SELECT id, to_number, started_at, ended_at, duration_seconds
     FROM call_history
     WHERE is_manual = true AND started_at >= date_trunc('day', now())
     ORDER BY started_at DESC`
  );
  return rows;
}

module.exports = { todayStats, perStateReport, manualCallsToday };
