const db = require('../db');
const reportingPeriod = require('./reportingPeriod');

function withConnectRate(row) {
  return {
    ...row,
    connectRate: row.dials > 0 ? Math.round((row.contacts / row.dials) * 100) : 0,
  };
}

/**
 * Dials/contacts/connect-rate for a period (reportingPeriod.resolvePeriod) —
 * by default the reporting day containing now. Powers the dashboard stat
 * cards and the daily goal.
 */
async function todayStats(period) {
  const p = period || (await reportingPeriod.resolvePeriod());
  const { rows } = await db.query(
    `SELECT
       count(*)::int AS dials,
       count(*) FILTER (WHERE disposition = 'contacted')::int AS contacts
     FROM call_history
     WHERE started_at >= $1 AND started_at < $2`,
    [p.start, p.end]
  );
  return { ...withConnectRate(rows[0]), period: reportingPeriod.describe(p) };
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
async function manualCallsToday(period) {
  const p = period || (await reportingPeriod.resolvePeriod());
  const { rows } = await db.query(
    `SELECT id, to_number, started_at, ended_at, duration_seconds
     FROM call_history
     WHERE is_manual = true AND started_at >= $1 AND started_at < $2
     ORDER BY started_at DESC`,
    [p.start, p.end]
  );
  return rows;
}

module.exports = { todayStats, perStateReport, manualCallsToday };
