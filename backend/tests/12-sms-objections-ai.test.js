// C1D: SMS, objections and AI context per campaign (docs/CRM_PLAN.md).
// Templates and objection types: the campaign's own plus the shared ones.
// Inbox: by campaign or ALL; texts from unknown numbers show everywhere.
// AI: a local Groq stub records the prompts. A File 01 prompt carries the
// real-estate context; a second campaign's prompt carries its own context
// and no real-estate wording.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const h = require('./helpers');
const aiContext = require('../src/services/aiContext');
const rebuttalCoach = require('../src/services/rebuttalCoach');
const aiCsvMapper = require('../src/services/aiCsvMapper');

let supervisor;
let file2;
let stub;
const prompts = [];

// Real-estate wording that must never reach another campaign's prompt.
const REAL_ESTATE = /real[\s-]?estate|realtor|realty|keller williams|coldwell|license #/i;
const ROOFING_CONTEXT = 'We help roofing contractors file insurance supplements for storm-damage claims.';

before(async () => {
  await h.setupFile();
  supervisor = await h.createUser({ role: 'supervisor' });
  file2 = await h.createCampaign({ name: 'Roofing', kind: 'roofing_supplement' });
  await h.db.query("UPDATE campaigns SET ai_context = $2, company_label = 'Company' WHERE id = $1", [file2.id, ROOFING_CONTEXT]);

  // The Groq stub: records every chat request, answers with something parseable.
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      prompts.push((json.messages || []).map((m) => m.content).join('\n'));
      const content = '{"summary": "Spoke before.", "opener": "Hi again.", "mapping": {}, "confidence": {}}';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'stub', object: 'chat.completion', created: 0, model: 'stub',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  // run.js turns import AI off for every file; this file needs it, against the stub only.
  process.env.IMPORT_AI = 'on';
});

after(() => new Promise((r) => stub.close(r)));

test('templates: each file lists its own plus the shared ones', async () => {
  const a = await supervisor.api.post('/api/sms/templates', { name: 'One', body: 'Hi {{first_name}}' });
  const b = await supervisor.api.post('/api/sms/templates', { name: 'Two', body: 'Hello {{first_name}}' }, { campaign: file2.id });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const { rows } = await h.db.query("INSERT INTO sms_templates (name, body) VALUES ('Shared', 'Hey') RETURNING id");
  const ids = async (campaign) => (await supervisor.api.get('/api/sms/templates', { campaign })).body.templates.map((t) => t.id);
  const one = await ids(1);
  const two = await ids(file2.id);
  const idOf = (r) => (r.body.template || r.body).id;
  assert.ok(one.includes(idOf(a)) && !one.includes(idOf(b)) && one.includes(rows[0].id));
  assert.ok(two.includes(idOf(b)) && !two.includes(idOf(a)) && two.includes(rows[0].id));
});

test('objection types: own plus shared; the same label in two files; the report is per file', async () => {
  const t1 = await supervisor.api.post('/api/objections/types', { label: 'Too busy' });
  const t2 = await supervisor.api.post('/api/objections/types', { label: 'Too busy' }, { campaign: file2.id });
  assert.equal(t1.status, 201);
  assert.equal(t2.status, 201);
  const { rows } = await h.db.query("INSERT INTO objection_types (label, sort_order) VALUES ('Shared one', 99) RETURNING id");
  const list = async (campaign) => (await supervisor.api.get('/api/objections/types', { campaign })).body.types.map((t) => t.id);
  const one = await list(1);
  const two = await list(file2.id);
  assert.ok(one.includes(t1.body.type.id) && !one.includes(t2.body.type.id) && one.includes(rows[0].id));
  assert.ok(two.includes(t2.body.type.id) && !two.includes(t1.body.type.id) && two.includes(rows[0].id));

  const rep2 = await supervisor.api.get('/api/objections/report', { campaign: file2.id });
  assert.equal(rep2.status, 200);
  const reportIds = rep2.body.objections.map((o) => o.id);
  assert.ok(!reportIds.includes(t1.body.type.id));
  assert.equal((await supervisor.api.get('/api/objections/hints', { campaign: null })).status, 400);
});

test('inbox: by file or ALL; a text from an unknown number shows in every view', async () => {
  const l1 = await h.createLead({ campaign_id: 1 });
  const l2 = await h.createLead({ campaign_id: file2.id });
  for (const lead of [l1, l2]) {
    await h.db.query("INSERT INTO sms_messages (lead_id, direction, body, is_read) VALUES ($1, 'inbound', 'hello', false)", [lead.id]);
  }
  await h.db.query("INSERT INTO sms_messages (lead_id, direction, body, is_read, from_number) VALUES (NULL, 'inbound', 'who is this', false, '+15550009999')");
  const inbox = async (campaign) => (await supervisor.api.get('/api/sms/inbox', { campaign })).body;
  const [i1, i2, iAll] = await Promise.all([inbox(1), inbox(file2.id), inbox('ALL')]);
  const leadIds = (b) => b.leads.map((l) => l.leadId);
  assert.deepEqual(leadIds(i1), [l1.id]);
  assert.deepEqual(leadIds(i2), [l2.id]);
  assert.deepEqual(leadIds(iAll).sort(), [l1.id, l2.id].sort());
  for (const b of [i1, i2, iAll]) assert.equal(b.unmatched.length, 1);
});

test('AI: File 01 prompts carry the real-estate context, unchanged in meaning', async () => {
  const ctx = await aiContext.forCampaignId(1);
  assert.equal(ctx.companyKey, 'brokerage');
  assert.equal(ctx.leadNoun, 'agent');
  const msgs = rebuttalCoach.buildMessages('Too busy', [], ctx);
  assert.match(msgs[0].content, /real estate agents/);
  assert.match(msgs[1].content, /Objection the agent raised/);
  assert.match(aiCsvMapper.buildCleaningPrompt([], ctx), /Keller Williams/);

  prompts.length = 0;
  const form = new FormData();
  form.append('file', new Blob(['Name,Phone,State\nA B,(214) 555-0101,TX'], { type: 'text/csv' }), 'ai1.csv');
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(prompts.length, 1, 'the upload asked the Groq stub for a mapping');
  assert.match(prompts[0], /real estate agents/);
});

test("AI: a second file's prompts carry its own context and no real-estate wording", async () => {
  const ctx = await aiContext.forCampaignId(file2.id);
  const texts = [
    rebuttalCoach.buildMessages('Too busy', [], ctx).map((m) => m.content).join('\n'),
    aiCsvMapper.buildPrompt(['Name', 'Phone'], [], ctx),
    aiCsvMapper.buildCleaningPrompt([], ctx),
    aiCsvMapper.buildStateGuessPrompt([{ index: 0, name: 'A', address: '', brokerage: 'X' }], ctx),
  ];

  // Through the app: an import upload and a pre-call brief for a File 02 lead.
  prompts.length = 0;
  const form = new FormData();
  form.append('file', new Blob(['Name,Phone,State\nC D,(415) 555-0102,CA'], { type: 'text/csv' }), 'ai2.csv');
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form, campaign: file2.id });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const lead = await h.createLead({ campaign_id: file2.id, brokerage: 'Acme Roofing' });
  await h.db.query(
    "INSERT INTO call_history (lead_id, user_id, from_number, was_mock, disposition, disposition_at, telephony_state, campaign_id) VALUES ($1, $2, '+15550000000', true, 'voicemail', now(), 'ended', $3)",
    [lead.id, supervisor.user.id, file2.id]
  );
  const brief = await supervisor.api.get(`/api/leads/${lead.id}/brief`);
  assert.equal(brief.status, 200, JSON.stringify(brief.body));
  assert.equal(prompts.length, 2, 'upload mapping + brief');
  texts.push(...prompts);

  for (const text of texts) {
    assert.ok(text.includes(ROOFING_CONTEXT), `missing the campaign context:\n${text.slice(0, 300)}`);
    assert.doesNotMatch(text, REAL_ESTATE);
  }
  assert.match(prompts[1], /"company": "Acme Roofing"/);
});
