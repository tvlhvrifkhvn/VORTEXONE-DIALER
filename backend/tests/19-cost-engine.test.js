// C4A: the cost engine (docs/CRM_PLAN.md).
// 20 calls against a hand calculation; markEnded and the dial pad's end fix
// billed seconds from the state the call had; the 80 % warning; dialing
// blocked at 100 % on all three entry points (global and per-file budgets);
// a running multi-line session stops refilling; with no rates set nothing is
// costed or blocked and spend says "not set".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const callLifecycle = require('../src/services/callLifecycle');

let rep;
let supervisor;
const RATES = { outbound: 0.7, recording: 0.25, perCall: 0.4 }; // cents

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
});

after(async () => {
  await rep.api.post('/api/calls/multiline/stop', {});
  h.setOutcome(null);
});

const setSetting = async (key, value) => {
  const res = await supervisor.api.put(`/api/settings/${key}`, { value: value === null ? null : String(value) });
  assert.equal(res.status, 200, `${key}: ${JSON.stringify(res.body)}`);
};
const setRates = async (r) => {
  await setSetting('rate_outbound_cents_per_min', r ? r.outbound : null);
  await setSetting('rate_recording_cents_per_min', r ? r.recording : null);
  await setSetting('rate_per_call_cents', r ? r.perCall : null);
};
const spend = (campaign) => supervisor.api.get('/api/spend', { campaign }).then((r) => r.body);

/** A closed call row straight in the database (as an adapter and the app leave it). */
async function closedCall({ state, duration, campaignId = 1, leadId = null }) {
  const { rows } = await h.db.query(
    `INSERT INTO call_history (lead_id, user_id, from_number, was_mock, telephony_state, campaign_id, started_at, ended_at, duration_seconds)
     VALUES ($1, $2, '+15550000000', true, $3, $4, now() - interval '1 minute', now(), $5) RETURNING id`,
    [leadId, rep.user.id, state, campaignId, duration]
  );
  return rows[0].id;
}

/** The hand calculation. */
function expected(state, duration) {
  const connected = state === 'answered' || state === 'voicemail_detected';
  const billed = connected ? Math.ceil(duration / 60) * 60 : 0;
  return { billed, cost: Number((RATES.perCall + (billed / 60) * (RATES.outbound + RATES.recording)).toFixed(4)) };
}

test('settings: the rates and budget are supervisor only and checked', async () => {
  assert.equal((await rep.api.put('/api/settings/rate_per_call_cents', { value: '1' })).status, 403);
  assert.equal((await supervisor.api.put('/api/settings/rate_per_call_cents', { value: '-1' })).status, 400);
  assert.equal((await supervisor.api.put('/api/settings/rate_per_call_cents', { value: '0.12345' })).status, 400);
  assert.equal((await supervisor.api.put('/api/settings/monthly_budget_cents', { value: '12.5' })).status, 400);
});

test('no rates set: nothing costed, nothing blocked, spend says not set', async () => {
  await setRates(null);
  await setSetting('monthly_budget_cents', 0);
  const id = await closedCall({ state: 'answered', duration: 90 });
  const s = await spend();
  assert.equal(s.ratesSet, false);
  assert.equal(s.state, 'ok');
  assert.equal(s.month.cents, 0);
  const row = (await h.db.query('SELECT billed_seconds, cost_est_cents FROM call_history WHERE id = $1', [id])).rows[0];
  assert.equal(row.billed_seconds, 120);
  assert.equal(row.cost_est_cents, null);
  const lead = await h.createLead();
  const call = await h.dial(rep.api, lead.id);
  assert.equal(call.status, 201, 'a budget of 0 blocks nothing while rates are not set');
  await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'voicemail' });
  await setSetting('monthly_budget_cents', null);
  await h.db.query('DELETE FROM call_history');
});

test('20 calls match the hand calculation; the month total is their sum', async () => {
  await setRates(RATES);
  const plan = [
    ['answered', 0], ['answered', 1], ['answered', 59], ['answered', 60], ['answered', 61],
    ['answered', 119], ['answered', 120], ['answered', 121], ['answered', 600], ['answered', 3599],
    ['voicemail_detected', 25], ['voicemail_detected', 61], ['voicemail_detected', 180],
    ['ringing', 30], ['ringing', 0], ['busy', 12], ['busy', 70], ['ended', 45], ['ended', 0], ['answered', 3601],
  ];
  const ids = [];
  for (const [state, duration] of plan) ids.push(await closedCall({ state, duration }));
  const s = await spend();
  assert.equal(s.ratesSet, true);
  let total = 0;
  for (let i = 0; i < plan.length; i++) {
    const [state, duration] = plan[i];
    const want = expected(state, duration);
    const row = (await h.db.query('SELECT billed_seconds, cost_est_cents FROM call_history WHERE id = $1', [ids[i]])).rows[0];
    assert.equal(row.billed_seconds, want.billed, `${state} ${duration}s billed`);
    assert.equal(Number(row.cost_est_cents), want.cost, `${state} ${duration}s cost`);
    total += want.cost;
  }
  assert.equal(s.month.calls, 20);
  assert.equal(s.month.cents, Number(total.toFixed(4)));
  assert.equal(s.today.cents, Number(total.toFixed(4)));
  // Stored once: a later rate change does not touch them.
  await setSetting('rate_per_call_cents', 9);
  assert.equal((await spend()).month.cents, Number(total.toFixed(4)));
  await setRates(RATES);
});

test('markEnded and the dial pad end bill from the state the call had', async () => {
  const { rows } = await h.db.query(
    `INSERT INTO call_history (lead_id, user_id, from_number, was_mock, telephony_state, campaign_id, started_at)
     VALUES (NULL, $1, '+15550000000', true, 'answered', 1, now() - interval '2 minutes') RETURNING id`,
    [rep.user.id]
  );
  await callLifecycle.markEnded(rows[0].id, 125);
  const ended = (await h.db.query('SELECT telephony_state, billed_seconds, cost_est_cents FROM call_history WHERE id = $1', [rows[0].id])).rows[0];
  assert.equal(ended.telephony_state, 'ended');
  assert.equal(ended.billed_seconds, 180);
  assert.equal(Number(ended.cost_est_cents), expected('answered', 125).cost);

  h.setOutcome('answered');
  const manual = await rep.api.post('/api/calls/manual/start', { toNumber: h.nextPhone().slice(2) });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  await h.waitFor(async () => (await rep.api.get(`/api/calls/${manual.body.call.id}`)).body.call.telephony_state === 'answered');
  const hung = await rep.api.post(`/api/calls/${manual.body.call.id}/hangup`, {});
  assert.equal(hung.status, 200, JSON.stringify(hung.body));
  const m = (await h.db.query('SELECT telephony_state, duration_seconds, billed_seconds, cost_est_cents FROM call_history WHERE id = $1', [manual.body.call.id])).rows[0];
  assert.equal(m.telephony_state, 'ended');
  assert.equal(m.billed_seconds, expected('answered', m.duration_seconds).billed);
  assert.equal(Number(m.cost_est_cents), expected('answered', m.duration_seconds).cost);
});

test('the budget: warning at 80 %, then all three entry points refuse at 100 %', async () => {
  const s0 = await spend();
  const month = s0.month.cents;
  await setSetting('monthly_budget_cents', Math.ceil(month / 0.85)); // ~85 % used
  const warn = await spend();
  assert.equal(warn.state, 'warning');
  assert.equal(warn.budgets.global.state, 'warning');
  assert.ok(warn.budgets.global.pct >= 80 && warn.budgets.global.pct < 100);
  const lead = await h.createLead();
  const ok = await h.dial(rep.api, lead.id);
  assert.equal(ok.status, 201, 'a warning does not block');
  await rep.api.post('/api/dispositions', { callId: ok.body.call.id, disposition: 'voicemail' });

  await setSetting('monthly_budget_cents', Math.floor(month)); // reached
  assert.equal((await spend()).state, 'reached');
  const lead2 = await h.createLead();
  for (const [path, body] of [
    ['/api/calls', { leadId: lead2.id }],
    ['/api/calls/manual/start', { toNumber: h.nextPhone().slice(2) }],
    ['/api/calls/multiline/start', { lineCount: 1, leadIds: [] }],
  ]) {
    const res = await rep.api.post(path, body);
    assert.equal(res.status, 409, path);
    assert.equal(res.body.error, 'Budget reached — dialing stopped', path);
  }
  assert.equal((await h.getLead(lead2.id)).status, 'in_queue', 'nothing was locked');
  await setSetting('monthly_budget_cents', null);
});

test('a file budget blocks only that file; the stricter budget wins', async () => {
  const file2 = await h.createCampaign({ name: 'Cost Two' });
  await closedCall({ state: 'answered', duration: 600, campaignId: file2.id });
  await h.db.query('UPDATE campaigns SET monthly_budget_cents = 1 WHERE id = $1', [file2.id]);
  const s2 = await spend(file2.id);
  assert.equal(s2.budgets.campaign.state, 'reached');
  assert.equal(s2.budgets.global.state, 'ok');
  assert.equal(s2.state, 'reached');
  const blocked = await rep.api.post('/api/calls/manual/start', { toNumber: h.nextPhone().slice(2) }, { campaign: file2.id });
  assert.equal(blocked.status, 409);
  const s1 = await spend(1);
  assert.equal(s1.state, 'ok', 'File 01 has no budget of its own and the global one is unset');
  const all = await spend('ALL');
  assert.ok(all.perCampaign.some((c) => c.campaignId === file2.id && c.month > 0));
  await h.db.query('UPDATE campaigns SET monthly_budget_cents = NULL WHERE id = $1', [file2.id]);
});

test('a running multi-line session stops refilling once the budget is reached', async () => {
  const file3 = await h.createCampaign({ name: 'Cost Three' });
  for (let i = 0; i < 10; i++) await h.createLead({ campaign_id: file3.id });
  h.setOutcome('no_answer'); // each call ends after the 3 s ring, so the line refills
  const opts = { campaign: file3.id };
  const count = async () => (await h.db.query('SELECT count(*)::int AS n FROM call_history WHERE campaign_id = $1', [file3.id])).rows[0].n;
  const start = await rep.api.post('/api/calls/multiline/start', { lineCount: 1 }, opts);
  assert.equal(start.status, 201, JSON.stringify(start.body));
  await h.waitFor(async () => (await count()) >= 2, { timeoutMs: 15000 });
  await h.db.query('UPDATE campaigns SET monthly_budget_cents = 0 WHERE id = $1', [file3.id]); // reached
  await new Promise((r) => setTimeout(r, 4500)); // the call in progress finishes
  const n1 = await count();
  await new Promise((r) => setTimeout(r, 7000)); // two more ring cycles
  const n2 = await count();
  assert.equal(n2, n1, `the line kept dialing (${n1} → ${n2})`);
  await rep.api.post('/api/calls/multiline/stop', {});
  h.setOutcome('answered');
});

test('C4B: a dialing session\'s stats, for its rep (or a supervisor) only', async () => {
  const started = await rep.api.post('/api/sessions/start', { mode: 'power' });
  assert.equal(started.status, 201);
  const id = started.body.sessionId;
  const lead = await h.createLead();
  const call = await rep.api.post('/api/calls', { leadId: lead.id, sessionId: id });
  assert.equal(call.status, 201, JSON.stringify(call.body));
  const mine = await rep.api.get(`/api/sessions/${id}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.session.total_dials, 1);
  assert.equal((await supervisor.api.get(`/api/sessions/${id}`)).status, 200);
  const other = await h.createUser({ role: 'rep' });
  assert.equal((await other.api.get(`/api/sessions/${id}`)).status, 404);
  await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'voicemail' });
});
