// C6C: best time to call (docs/CRM_PLAN.md). The connect rate (contacted /
// placed calls) by the lead's LOCAL hour, 8:00 to 21:00, over the last 90
// days: for one lead, for its state, and per state for Reports. Below 30
// calls a result says "Not enough data yet".
// A lead's local time is its state's main zone (the same one the brief
// shows); a lead without a state uses its first known zone.
const db = require('../db');
const campaignScope = require('./campaignScope');
const { STATE_ZONES } = require('../utils/timeZones');
const { PLACED_CALL_SQL } = require('./reports');

const DAYS = 90;
const MIN_CALLS = 30;
const MIN_HOUR_CALLS = 3; // an hour needs a few calls before it can be "best"
const FIRST_HOUR = 8;
const LAST_HOUR = 20; // the 20:00–21:00 slot is the last
const NOT_ENOUGH = 'Not enough data yet';

// (state, main zone) for every state, as SQL VALUES.
const ZONE_VALUES = Object.entries(STATE_ZONES)
  .map(([state, zones]) => `('${state}', '${zones[0]}')`)
  .join(', ');

const LOCAL_HOUR_SQL = `extract(hour FROM ch.started_at AT TIME ZONE COALESCE(z.tz, l.tz_zones[1]))::int`;

/** Placed calls in the window, by key and local hour. `where` filters leads (alias l). */
async function hourly({ where, params, groupBy = null, now = new Date() }) {
  const since = new Date(now.getTime() - DAYS * 864e5);
  const p = [...params, since, now];
  const { rows } = await db.query(
    `SELECT ${groupBy ? `${groupBy} AS key,` : ''} ${LOCAL_HOUR_SQL} AS hour,
            count(*)::int AS calls, count(*) FILTER (WHERE ch.disposition = 'contacted')::int AS contacts
     FROM call_history ch
     JOIN leads l ON l.id = ch.lead_id
     LEFT JOIN (VALUES ${ZONE_VALUES}) AS z(state, tz) ON z.state = l.state
     WHERE ${PLACED_CALL_SQL} AND ch.started_at >= $${p.length - 1} AND ch.started_at < $${p.length}
       AND COALESCE(z.tz, l.tz_zones[1]) IS NOT NULL AND ${where}
     GROUP BY ${groupBy ? `${groupBy}, ` : ''}hour`,
    p
  );
  return rows;
}

/** { calls, enough, hours: [{ hour, calls, contacts, rate }], best: { hour, rate, calls } | null, text } */
function summarize(rows, label) {
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const hours = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h += 1) {
    const r = byHour.get(h) || { calls: 0, contacts: 0 };
    hours.push({ hour: h, calls: r.calls, contacts: r.contacts, rate: r.calls ? Math.round((r.contacts / r.calls) * 100) : null });
  }
  const calls = hours.reduce((n, x) => n + x.calls, 0);
  const enough = calls >= MIN_CALLS;
  let best = null;
  if (enough) {
    for (const x of hours) {
      if (x.calls < MIN_HOUR_CALLS) continue;
      if (!best || x.rate > best.rate || (x.rate === best.rate && x.calls > best.calls)) best = { hour: x.hour, rate: x.rate, calls: x.calls };
    }
  }
  const text = !enough || !best
    ? NOT_ENOUGH
    : `${hourLabel(best.hour)}–${hourLabel(best.hour + 1)} local: ${best.rate}% connect (${calls} calls in ${DAYS} days${label ? `, ${label}` : ''})`;
  return { calls, enough, hours, best, text };
}

function hourLabel(h) {
  const suffix = h >= 12 ? 'pm' : 'am';
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n}${suffix}`;
}

/** For one lead: its own calls, and its state's. text = the lead's when it has enough data, else the state's. */
async function forLead(leadId, now = new Date()) {
  const { rows } = await db.query('SELECT id, state FROM leads WHERE id = $1', [leadId]);
  const lead = rows[0];
  if (!lead) return null;
  const own = summarize(await hourly({ where: 'l.id = $1', params: [lead.id], now }), 'this lead');
  const state = lead.state
    ? summarize(await hourly({ where: 'l.state = $1 AND l.deleted_at IS NULL', params: [lead.state], now }), `${lead.state} leads`)
    : null;
  const text = own.best ? own.text : state && state.best ? state.text : NOT_ENOUGH;
  return { lead: own, state, stateCode: lead.state || null, text };
}

/** Reports → BEST HOURS: one row per state with calls in the window (file or ALL). */
async function perState(campaignId, now = new Date()) {
  const s = campaignScope.scope('l', campaignId, 1);
  const rows = await hourly({ where: `l.state IS NOT NULL AND ${s.sql}`, params: s.params, groupBy: 'l.state', now });
  const byState = new Map();
  for (const r of rows) {
    if (!byState.has(r.key)) byState.set(r.key, []);
    byState.get(r.key).push(r);
  }
  return [...byState]
    .map(([state, list]) => ({ state, ...summarize(list) }))
    .sort((a, b) => b.calls - a.calls || a.state.localeCompare(b.state));
}

module.exports = { DAYS, MIN_CALLS, NOT_ENOUGH, FIRST_HOUR, LAST_HOUR, forLead, perState, summarize, hourLabel };
