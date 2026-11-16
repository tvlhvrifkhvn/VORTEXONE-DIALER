// C1B: the dialer works inside one campaign (docs/CRM_PLAN.md).
// I14: a dial session only dials leads of its own campaign — the queue, a
// single-line session and a multi-line session (queue or selection) never
// return another campaign's leads. A lead clicked from another file answers
// 409 with that file's label. State counts are per campaign. The DNC check
// stays global.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const leadQueue = require('../src/services/leadQueue');

let rep;
let file2;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  file2 = await h.createCampaign({ name: 'Roofing' });
});

after(async () => {
  await rep.api.post('/api/calls/multiline/stop', {});
  h.setOutcome(null);
});

/** Parks every dialable lead so each test starts from an empty queue. */
async function clearQueue() {
  await h.db.query("UPDATE leads SET status = 'cold', locked_by = NULL, locked_at = NULL WHERE status <> 'cold'");
}

async function twoFiles(n = 3) {
  const one = [];
  const two = [];
  for (let i = 0; i < n; i++) {
    one.push(await h.createLead({ campaign_id: 1, state: 'TX' }));
    two.push(await h.createLead({ campaign_id: file2.id, state: 'CA', areaCode: '415' }));
  }
  return { one, two };
}

test('the queue is per campaign (candidates and peekNext)', async () => {
  await clearQueue();
  const { one, two } = await twoFiles();
  const q1 = await leadQueue.candidates({ campaignId: 1, limit: 100 });
  const q2 = await leadQueue.candidates({ campaignId: file2.id, limit: 100 });
  assert.deepEqual(q1.map((l) => l.id).sort(), one.map((l) => l.id).sort());
  assert.deepEqual(q2.map((l) => l.id).sort(), two.map((l) => l.id).sort());
  assert.equal((await leadQueue.peekNext(file2.id)).campaign_id, file2.id);
  await assert.rejects(() => leadQueue.candidates({ limit: 5 }), /invalid campaignId/);
});

test('I14: single-line "next lead" only locks leads of the header campaign', async () => {
  await clearQueue();
  const { two } = await twoFiles(2);
  const ids = new Set(two.map((l) => l.id));
  for (let i = 0; i < 2; i++) {
    const res = await rep.api.post('/api/calls', {}, { campaign: file2.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(ids.has(res.body.lead.id), 'locked a lead of another campaign');
    assert.equal(res.body.call.campaign_id ?? file2.id, file2.id);
    await rep.api.post(`/api/calls/${res.body.call.id}/hangup`, {});
    await h.db.query("UPDATE leads SET status = 'cold', locked_by = NULL WHERE id = $1", [res.body.lead.id]);
  }
  // File 02 is now empty; File 01 still has leads, but they are not offered.
  const none = await rep.api.post('/api/calls', {}, { campaign: file2.id });
  assert.equal(none.status, 404);
});

test('a lead clicked from another file answers 409 with that file label', async () => {
  await clearQueue();
  const lead = await h.createLead({ campaign_id: file2.id });
  const res = await h.dial(rep.api, lead.id); // header: File 01
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'This lead belongs to FILE 02 · ROOFING');
  assert.equal((await h.getLead(lead.id)).status, 'in_queue');
  const ok = await rep.api.post('/api/calls', { leadId: lead.id }, { campaign: file2.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  await rep.api.post(`/api/calls/${ok.body.call.id}/hangup`, {});
});

test('the per-campaign lock: two reps on one file never get the same lead', async () => {
  await clearQueue();
  const other = await h.createUser({ role: 'rep' });
  await twoFiles(1);
  const [a, b] = await Promise.all([
    rep.api.post('/api/calls', {}, { campaign: file2.id }),
    other.api.post('/api/calls', {}, { campaign: file2.id }),
  ]);
  const won = [a, b].filter((r) => r.status === 201);
  assert.equal(won.length, 1, `${a.status} ${b.status}`);
  assert.equal(won[0].body.lead.campaign_id, file2.id);
  assert.equal([a, b].find((r) => r !== won[0]).status, 404);
  const { rows } = await h.db.query("SELECT count(*)::int AS n FROM leads WHERE status = 'in_progress' AND campaign_id = 1");
  assert.equal(rows[0].n, 0);
  for (const r of won) await (r === a ? rep : other).api.post(`/api/calls/${r.body.call.id}/hangup`, {});
});

async function runMultiline(body, campaign) {
  h.setOutcome('no_answer');
  const started = await h.db.query('SELECT coalesce(max(id), 0) AS m FROM call_history');
  const res = await rep.api.post('/api/calls/multiline/start', { lineCount: 3, ...body }, { campaign });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Let the lines ring out and refill a few times.
  await new Promise((r) => setTimeout(r, 9000));
  await rep.api.post('/api/calls/multiline/stop', {});
  h.setOutcome('answered');
  const { rows } = await h.db.query(
    `SELECT ch.campaign_id AS call_campaign, l.campaign_id AS lead_campaign, l.id
     FROM call_history ch JOIN leads l ON l.id = ch.lead_id WHERE ch.id > $1`,
    [started.rows[0].m]
  );
  return rows;
}

test('I14: a multi-line session (queue) dials only its own campaign, refills included', async () => {
  await clearQueue();
  await twoFiles(5);
  const rows = await runMultiline({}, file2.id);
  assert.ok(rows.length >= 3, `only ${rows.length} calls placed`);
  for (const r of rows) {
    assert.equal(r.lead_campaign, file2.id);
    assert.equal(r.call_campaign, file2.id);
  }
});

test('I14: a multi-line selection keeps only leads of the session campaign', async () => {
  await clearQueue();
  const { one, two } = await twoFiles(3);
  const mixed = [...one, ...two].map((l) => l.id);
  const queued = await rep.api.post('/api/leads/batch-queue', { leadIds: mixed }, { campaign: file2.id });
  assert.equal(queued.status, 200);
  assert.deepEqual(queued.body.leads.map((l) => l.id).sort(), two.map((l) => l.id).sort());
  const rows = await runMultiline({ leadIds: mixed }, file2.id);
  assert.ok(rows.length >= 1);
  for (const r of rows) assert.equal(r.lead_campaign, file2.id);
  for (const l of one) assert.equal((await h.getLead(l.id)).attempts, 0);
});

test('state counts are per campaign', async () => {
  await clearQueue();
  await twoFiles(2);
  const c1 = await rep.api.get('/api/leads/state-counts');
  const c2 = await rep.api.get('/api/leads/state-counts', { campaign: file2.id });
  assert.equal(c1.status, 200);
  const states = (res) => Object.fromEntries(res.body.counts.map((s) => [s.state, Number(s.dialable)]));
  // File 01 has only TX leads, File 02 the CA ones (its older TX lead is parked).
  assert.equal(states(c1).CA, undefined);
  assert.equal(states(c1).TX, 2);
  assert.equal(states(c2).TX ?? 0, 0);
  assert.equal(states(c2).CA, 2);
  const noHeader = await rep.api.get('/api/leads/state-counts', { campaign: null });
  assert.equal(noHeader.status, 400);
});

test('I15: the DNC check ignores the campaign (a number on the list is never dialed in any file)', async () => {
  await clearQueue();
  const lead = await h.createLead({ campaign_id: file2.id });
  await h.db.query('INSERT INTO dnc_list (phone) VALUES ($1)', [lead.phone]);
  const res = await rep.api.post('/api/calls', { leadId: lead.id }, { campaign: file2.id });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /DNC/);
});
