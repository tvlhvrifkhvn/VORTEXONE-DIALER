// C5C: proposals, drafts and the daily brief (docs/CRM_PLAN.md), against the
// scripted local Groq stub only. Proposals are never executed by the server;
// SMS drafts are refused for opted-out leads and capped at 320 characters;
// the brief is served from the cache the same day, rebuilt on REFRESH and
// after the reporting day ends.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const extras = require('../src/services/assistant/extras');
const { startToolsStub, toolCall, answer } = require('./stubs/groq-tools-stub');

let stub;
let rep;
let stages;
let ann;
let file2;

const sent = () => stub.requests.slice(stub.offset);

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  file2 = await h.createCampaign({ name: 'Roofing' });
  ann = await h.createLead({ name: 'Ann Alpha', email: 'ann@example.com' });
  stages = (await h.db.query('SELECT id, name, campaign_id FROM pipeline_stages ORDER BY campaign_id, position')).rows;
  stub = await startToolsStub();
  process.env.GROQ_BASE_URL = stub.url;
});

after(async () => {
  h.resetClock();
  await stub.close();
});

test('proposals are recorded for the owner and never executed by the server', async () => {
  const interested = stages.find((s) => s.campaign_id === 1 && s.name === 'Interested');
  const otherFile = stages.find((s) => s.campaign_id === file2.id);
  const tasksBefore = (await h.db.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
  const historyBefore = (await h.db.query('SELECT count(*)::int AS n FROM lead_stage_history')).rows[0].n;
  stub.script([
    toolCall([
      ['propose_task', { lead_id: ann.id, title: 'Call back about pricing', due_at: '2026-12-01T10:00:00-05:00', type: 'call' }],
      ['propose_stage', { lead_id: ann.id, stage_id: interested.id }],
      ['propose_stage', { lead_id: ann.id, stage_id: otherFile.id }],
    ]),
    answer(`I proposed a callback task and a move to Interested for [lead:${ann.id}].`),
  ]);
  const res = await rep.api.post('/api/assistant/ask', { question: 'Plan Ann' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.proposals, [
    { kind: 'task', leadId: ann.id, leadName: 'Ann Alpha', title: 'Call back about pricing', type: 'call', dueAt: '2026-12-01T15:00:00.000Z' },
    { kind: 'stage', leadId: ann.id, leadName: 'Ann Alpha', stageId: interested.id, stageName: 'Interested', stageKind: 'open', fromStage: 'New' },
  ]);
  assert.deepEqual(res.body.leadRefs, [{ id: ann.id, name: 'Ann Alpha' }]);
  // The cross-file stage was refused back to the model.
  const refusal = sent()[1].messages.filter((m) => m.role === 'tool')[2];
  assert.match(JSON.parse(refusal.content).error, /isn't one of this lead's file/);
  // Nothing changed.
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n, tasksBefore);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM lead_stage_history')).rows[0].n, historyBefore);
  assert.equal((await h.getLead(ann.id)).pipeline_stage_id, ann.pipeline_stage_id);

  // CONFIRM is the owner calling the existing routes.
  const t = await rep.api.post('/api/tasks', { leadId: ann.id, title: res.body.proposals[0].title, dueAt: res.body.proposals[0].dueAt, type: 'call' });
  assert.equal(t.status, 201);
  const m = await rep.api.post(`/api/leads/${ann.id}/stage`, { stageId: interested.id });
  assert.equal(m.status, 200, JSON.stringify(m.body));
});

test('an SMS draft is refused (409) for a lead that opted out, is DNC, or replied STOP; nothing reaches Groq', async () => {
  const optedOut = await h.createLead({ name: 'Opted Out', sms_opt_out: true });
  const dnc = await h.createLead({ name: 'Dnc Lead', status: 'dnc', dnc_flag: true });
  const stopped = await h.createLead({ name: 'Stopped' });
  await h.db.query("INSERT INTO sms_suppressions (phone, source) VALUES ($1, 'inbound_keyword')", [stopped.phone]);
  const noEmail = await h.createLead({ name: 'No Email' });
  const before = stub.requests.length;
  for (const [lead, re] of [[optedOut, /opted out of SMS/], [dnc, /Do Not Call/], [stopped, /replied STOP/]]) {
    const r = await rep.api.post(`/api/leads/${lead.id}/draft`, { channel: 'sms' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(r.body.error, re);
  }
  const e = await rep.api.post(`/api/leads/${noEmail.id}/draft`, { channel: 'email' });
  assert.equal(e.status, 409);
  assert.equal((await rep.api.post(`/api/leads/${ann.id}/draft`, { channel: 'fax' })).status, 400);
  assert.equal(stub.requests.length, before, 'no Groq call for a refused draft');
});

test('an SMS draft is capped at 320 characters, without placeholders; an email has a subject and body', async () => {
  const long = `Hi {{first_name}}, ${'following up on our call about lead follow-up support '.repeat(12)}`;
  stub.script([answer(JSON.stringify({ text: long }))]);
  const r = await rep.api.post(`/api/leads/${ann.id}/draft`, { channel: 'sms', intent: 'follow up on pricing' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.text.length <= extras.SMS_MAX, `${r.body.text.length} characters`);
  assert.ok(r.body.text.length > 200);
  assert.ok(!r.body.text.includes('{{'));
  assert.equal(r.body.channel, 'sms');
  const prompt = sent()[0];
  assert.equal(prompt.tools, undefined, 'a draft is one call, no tools');
  assert.ok(!prompt.messages[1].content.includes(ann.phone), 'privacy rules on the draft facts');
  assert.ok(!prompt.messages[1].content.includes('ann@example.com'));
  assert.match(prompt.messages[1].content, /follow up on pricing/);

  stub.script([answer('{"subject": "Quick follow-up", "body": "Hi Ann,\\nThanks for the chat.\\nTalha"}')]);
  const em = await rep.api.post(`/api/leads/${ann.id}/draft`, { channel: 'email' });
  assert.equal(em.status, 200);
  assert.deepEqual(em.body, { channel: 'email', subject: 'Quick follow-up', body: 'Hi Ann,\nThanks for the chat.\nTalha' });
  const { rows } = await h.db.query("SELECT count(*)::int AS n FROM assistant_log WHERE kind = 'draft' AND error IS NULL");
  assert.equal(rows[0].n, 2);
});

test('the brief: cached for the day, rebuilt on REFRESH and after the reporting day ends', async () => {
  const b = await h.createLead({ name: 'Bob Beta' });
  const c = await h.createLead({ name: 'Cid Gamma' });
  stub.script([answer(JSON.stringify({ note: 'Quiet day so far.', callFirst: [{ id: b.id, reason: 'Fresh lead in TX.' }, { id: 999999, reason: 'Invented' }] }))]);
  const first = await rep.api.get('/api/assistant/brief');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.cached, false);
  assert.equal(first.body.note, 'Quiet day so far.');
  assert.equal(first.body.callFirst[0].id, b.id);
  assert.equal(first.body.callFirst[0].reason, 'Fresh lead in TX.');
  assert.ok(!first.body.callFirst.some((p) => p.id === 999999), 'an invented id is dropped');
  assert.ok(first.body.callFirst.length >= 3, 'filled up to 3 from the queue');
  assert.equal(first.body.yesterday.goal, 100);
  assert.equal(first.body.yesterday.dials, 0);
  assert.equal(typeof first.body.due.callbacks, 'number');
  const calls = stub.requests.length;

  const second = await rep.api.get('/api/assistant/brief');
  assert.equal(second.body.cached, true);
  assert.equal(second.body.generatedAt, first.body.generatedAt);
  assert.equal(stub.requests.length, calls, 'served from the cache');

  // Per file: File 02 has its own brief.
  const other = await rep.api.get('/api/assistant/brief', { campaign: file2.id });
  assert.equal(other.body.cached, false);

  const refreshed = await rep.api.get('/api/assistant/brief?refresh=1');
  assert.equal(refreshed.body.cached, false);
  const afterRefresh = stub.requests.length;

  // The cache lasts until the reporting day ends.
  const until = new Date(refreshed.body.validUntil).getTime();
  assert.ok(until > Date.now() && until - Date.now() <= 25 * 3600 * 1000);
  h.setNowOffset(until - Date.now() + 60 * 1000); // just past the end of the day
  try {
    // A token signed at the shifted time (a 12 h login would have expired).
    const token = jwt.sign({ sub: rep.user.id, email: rep.user.email, role: 'rep' }, config.jwtSecret, { expiresIn: '1h' });
    const tomorrow = await h.client(token).get('/api/assistant/brief');
    assert.equal(tomorrow.status, 200, JSON.stringify(tomorrow.body));
    assert.equal(tomorrow.body.cached, false);
    assert.ok(stub.requests.length > afterRefresh, 'rebuilt the next day');
  } finally {
    h.resetClock();
  }
  assert.ok(c.id);
});
