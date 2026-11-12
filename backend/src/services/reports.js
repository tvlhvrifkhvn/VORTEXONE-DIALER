const db = require('../db');
const reportingPeriod = require('./reportingPeriod');

function withConnectRate(row) {
  return {
    ...row,
    connectRate: row.dials > 0 ? Math.round((row.contacts / row.dials) * 100) : 0,
  };
}

// The calls a period covers — one WHERE clause for the headline numbers
// and for the PDF table, so the two can never disagree.
const PERIOD_CALLS_WHERE = 'ch.started_at >= $1 AND ch.started_at < $2';

/**
 * Every headline number for a period (reportingPeriod.resolvePeriod; by
 * default the reporting day containing now), from one query: dials,
 * contacts, voicemails, no-answers, DNC and the connect rate. Powers the
 * dashboard stat cards, the daily goal, the Reports page and the PDF.
 */
async function periodStats(period) {
  const p = period || (await reportingPeriod.resolvePeriod());
  const { rows } = await db.query(
    `SELECT
       count(*)::int AS dials,
       count(*) FILTER (WHERE ch.disposition = 'contacted')::int AS contacts,
       count(*) FILTER (WHERE ch.disposition = 'voicemail')::int AS voicemails,
       count(*) FILTER (WHERE ch.disposition = 'no_answer')::int AS "noAnswers",
       count(*) FILTER (WHERE ch.disposition = 'dnc')::int AS dnc
     FROM call_history ch
     WHERE ${PERIOD_CALLS_WHERE}`,
    [p.start, p.end]
  );
  return { ...withConnectRate(rows[0]), period: reportingPeriod.describe(p) };
}

/** The same calls, one row each, oldest first — the PDF table. */
async function periodCalls(period) {
  const { rows } = await db.query(
    `SELECT ch.id, ch.started_at, ch.duration_seconds, ch.disposition, ch.note, ch.is_manual, ch.was_abandoned,
            ch.ended_at, ch.to_number, l.name, l.phone, l.state, l.brokerage
     FROM call_history ch
     LEFT JOIN leads l ON l.id = ch.lead_id
     WHERE ${PERIOD_CALLS_WHERE}
     ORDER BY ch.started_at ASC, ch.id ASC`,
    [period.start, period.end]
  );
  return rows;
}

/** Kept for existing callers: the headline numbers for a period (default today). */
const todayStats = periodStats;

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

module.exports = { todayStats, periodStats, periodCalls, perStateReport, manualCallsToday };
