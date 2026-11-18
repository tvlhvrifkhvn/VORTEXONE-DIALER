// The cost engine (docs/CRM_PLAN.md, phase C4A): what calls cost, what was
// spent today and this month, and the budget that stops dialing.
//
// Rates come from Settings (supervisor only) and start empty: until at least
// one rate is set nothing is costed, nothing is blocked, and spend reads
// "not set". A call's numbers are fixed once:
//   billed_seconds  whole minutes for a connected call (answered or
//                   voicemail), 0 for one that never connected. Set when the
//                   call closes — by markEnded and the dial pad's end in the
//                   same statement (they overwrite telephony_state), or by
//                   settle() for every other close path (which keep it).
//   cost_est_cents  per-call fee + billed minutes × (outbound + recording),
//                   stored once, as soon as rates exist.
// A failed dial (never placed) costs nothing and is never counted.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const settings = require('./settings');
const reportingPeriod = require('./reportingPeriod');
const campaignScope = require('./campaignScope');

const RATE_KEYS = ['rate_outbound_cents_per_min', 'rate_recording_cents_per_min', 'rate_per_call_cents'];
const BUDGET_KEY = 'monthly_budget_cents';
const WARNING_PCT = 80;
const BUDGET_REACHED_MESSAGE = 'Budget reached — dialing stopped';

/** SQL for "this call connected" on call_history alias c (the state it had when it closed). */
const CONNECTED_SQL = "c.telephony_state IN ('answered', 'voicemail_detected')";
/** Billed seconds from a duration expression: whole minutes, rounded up. */
const billedSql = (duration) => `(CEIL(GREATEST(0, ${duration}) / 60.0)::int * 60)`;

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** { outbound, recording, perCall } in cents (null = not set), and ratesSet. */
async function rates() {
  const [outbound, recording, perCall] = await Promise.all(RATE_KEYS.map((k) => settings.getSetting(k)));
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const r = { outbound: num(outbound), recording: num(recording), perCall: num(perCall) };
  return { ...r, ratesSet: Object.values(r).some((v) => v !== null) };
}

/** Pure: the estimate for one call from its billed seconds (a missing rate counts as 0). */
function estimate({ billedSeconds }, r) {
  const minutes = (billedSeconds || 0) / 60;
  return Number(((r.perCall || 0) + minutes * ((r.outbound || 0) + (r.recording || 0))).toFixed(4));
}

/** Pure: billed seconds for a call that did or didn't connect. */
function billedSeconds({ connected, durationSeconds }) {
  return connected ? Math.ceil(Math.max(0, durationSeconds || 0) / 60) * 60 : 0;
}

// ---------------------------------------------------------------------------
// Settling: billed seconds for closed calls that don't have them, then the
// cost for every closed call that has billed seconds but no cost (when rates
// exist). Idempotent; `callId` limits it to one call.
// ---------------------------------------------------------------------------

async function settle(callId = null) {
  const only = callId ? 'AND c.id = $1' : '';
  const params = callId ? [callId] : [];
  await db.query(
    `UPDATE call_history c
     SET billed_seconds = CASE WHEN ${CONNECTED_SQL}
           THEN ${billedSql('COALESCE(c.duration_seconds, EXTRACT(EPOCH FROM (c.ended_at - c.started_at))::int)')}
           ELSE 0 END
     WHERE c.ended_at IS NOT NULL AND c.billed_seconds IS NULL AND c.telephony_state <> 'failed' ${only}`,
    params
  );
  const r = await rates();
  if (!r.ratesSet) return;
  const n = params.length;
  await db.query(
    `UPDATE call_history c
     SET cost_est_cents = ROUND(($${n + 1}::numeric + (c.billed_seconds / 60.0) * ($${n + 2}::numeric + $${n + 3}::numeric))::numeric, 4)
     WHERE c.ended_at IS NOT NULL AND c.billed_seconds IS NOT NULL AND c.cost_est_cents IS NULL AND c.telephony_state <> 'failed' ${only}`,
    [...params, r.perCall || 0, r.outbound || 0, r.recording || 0]
  );
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

/** Today's reporting day and this calendar month (reporting timezone and day start). */
async function periods(now = new Date()) {
  const s = await reportingPeriod.getSettings();
  const day = reportingPeriod.dayContaining(now, s);
  const [y, m] = day.date.split('-').map(Number);
  const [sh, sm] = s.dayStart.split(':').map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const month = {
    start: reportingPeriod.zonedToInstant(s.timezone, y, m, 1, sh, sm),
    end: reportingPeriod.zonedToInstant(s.timezone, next.y, next.m, 1, sh, sm),
    label: `${y}-${String(m).padStart(2, '0')}`,
  };
  return { today: { start: day.start, end: day.end, label: day.date }, month };
}

const cents = (v) => Number(Number(v || 0).toFixed(4));

/** Costed spend (cents) in [start, end) for a campaign or ALL. */
async function sumSpend(campaignId, start, end) {
  const s = campaignScope.scope('c', campaignId, 3);
  const { rows } = await db.query(
    `SELECT COALESCE(sum(c.cost_est_cents), 0) AS spent, count(*)::int AS calls
     FROM call_history c
     WHERE c.started_at >= $1 AND c.started_at < $2 AND c.cost_est_cents IS NOT NULL AND ${s.sql}`,
    [start, end, ...s.params]
  );
  return { cents: cents(rows[0].spent), calls: rows[0].calls };
}

/** One budget: no budget = ok; a budget of 0 allows nothing (reached). */
function stateFor(spent, budget) {
  if (budget === null || budget === undefined) return { budget: null, spent, pct: null, state: 'ok' };
  const pct = budget > 0 ? Math.round((spent / budget) * 1000) / 10 : 100;
  const state = pct >= 100 ? 'reached' : pct >= WARNING_PCT ? 'warning' : 'ok';
  return { budget, spent, pct, state };
}

const RANK = { ok: 0, warning: 1, reached: 2 };
const stricter = (a, b) => (RANK[b] > RANK[a] ? b : a);

async function globalBudget() {
  const v = await settings.getSetting(BUDGET_KEY);
  return v === null || v === '' ? null : Number(v);
}

async function campaignBudget(campaignId) {
  if (campaignId === campaignScope.ALL) return null;
  const { rows } = await db.query('SELECT monthly_budget_cents FROM campaigns WHERE id = $1', [campaignId]);
  const v = rows[0]?.monthly_budget_cents;
  return v === null || v === undefined ? null : Number(v);
}

/**
 * ok | warning (80 % or more) | reached (100 % or more) for the campaign's
 * monthly budget and the global one; the stricter wins. No rates set → ok.
 */
async function budgetState(campaignId, { now = new Date(), settleFirst = true } = {}) {
  if (settleFirst) await settle();
  const r = await rates();
  const p = await periods(now);
  const [gBudget, cBudget, allMonth, fileMonth] = await Promise.all([
    globalBudget(),
    campaignBudget(campaignId),
    sumSpend(campaignScope.ALL, p.month.start, p.month.end),
    campaignId === campaignScope.ALL ? null : sumSpend(campaignId, p.month.start, p.month.end),
  ]);
  const global = stateFor(allMonth.cents, gBudget);
  const file = campaignId === campaignScope.ALL ? null : stateFor(fileMonth.cents, cBudget);
  const state = r.ratesSet ? stricter(global.state, file ? file.state : 'ok') : 'ok';
  return { ratesSet: r.ratesSet, state, global, campaign: file };
}

/** Refuses a new dial once the budget is reached (409). Global, like DNC (rule 11). */
async function assertBudget(campaignId) {
  const b = await budgetState(campaignId);
  if (b.state === 'reached') throw new ApiError(409, BUDGET_REACHED_MESSAGE);
  return b;
}

/** GET /api/spend: today, month, budgets, state and the per-campaign split. */
async function spend({ campaignId, now = new Date() } = {}) {
  await settle();
  const r = await rates();
  const p = await periods(now);
  const [today, month, budgets, split] = await Promise.all([
    sumSpend(campaignId, p.today.start, p.today.end),
    sumSpend(campaignId, p.month.start, p.month.end),
    budgetState(campaignId, { now, settleFirst: false }),
    db.query(
      `SELECT cp.id AS campaign_id, cp.file_number, cp.name, cp.monthly_budget_cents,
              COALESCE(sum(c.cost_est_cents) FILTER (WHERE c.started_at >= $1 AND c.started_at < $2), 0) AS today,
              COALESCE(sum(c.cost_est_cents) FILTER (WHERE c.started_at >= $3 AND c.started_at < $4), 0) AS month
       FROM campaigns cp
       LEFT JOIN call_history c ON c.campaign_id = cp.id AND c.cost_est_cents IS NOT NULL
       WHERE cp.status <> 'archived'
       GROUP BY cp.id
       ORDER BY cp.file_number`,
      [p.today.start, p.today.end, p.month.start, p.month.end]
    ),
  ]);
  return {
    ratesSet: r.ratesSet,
    rates: { outbound: r.outbound, recording: r.recording, perCall: r.perCall },
    today: { ...today, label: p.today.label },
    month: { ...month, label: p.month.label },
    state: budgets.state,
    budgets: { global: budgets.global, campaign: budgets.campaign },
    perCampaign: split.rows.map((row) => ({
      campaignId: row.campaign_id,
      fileNumber: row.file_number,
      name: row.name,
      budget: row.monthly_budget_cents === null ? null : Number(row.monthly_budget_cents),
      today: cents(row.today),
      month: cents(row.month),
    })),
  };
}

// ---- settings: the rates and the global budget (supervisor only) -------------
const RATE_MAX = 10000; // cents per minute / per call, a typo guard
for (const key of RATE_KEYS) {
  settings.registerValidator(key, (k, value) => {
    if (value === null || value === '') return;
    const n = Number(value);
    if (!/^\d+(\.\d{1,4})?$/.test(String(value)) || !(n >= 0 && n <= RATE_MAX)) {
      throw new ApiError(400, `${k} must be a number of cents from 0 to ${RATE_MAX}, up to 4 decimals (e.g. 0.7)`);
    }
  });
}
settings.registerValidator(BUDGET_KEY, (k, value) => {
  if (value === null || value === '') return;
  if (!/^\d{1,12}$/.test(String(value))) throw new ApiError(400, 'monthly_budget_cents must be a whole number of cents, 0 or more');
});

module.exports = {
  RATE_KEYS,
  BUDGET_KEY,
  BUDGET_REACHED_MESSAGE,
  billedSql,
  rates,
  estimate,
  billedSeconds,
  settle,
  periods,
  budgetState,
  assertBudget,
  spend,
};
