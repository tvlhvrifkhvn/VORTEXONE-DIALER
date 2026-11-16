// C1A: campaigns ("files") and writes that carry them (docs/CRM_PLAN.md).
// I10 every lead has exactly one campaign; I11 every call row has one;
// each write path stores the right campaign; a paused or archived campaign
// refuses dialing and importing; a missing header answers 400; moveLead and
// setStatus rules; objection labels per campaign.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let supervisor;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
});

async function newFile(name, extra = {}) {
  const res = await supervisor.api.post('/api/campaigns', { name, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.campaign;
}

async function campaignOf(table, id) {
  return (await h.db.query(`SELECT campaign_id FROM ${table} WHERE id = $1`, [id])).rows[0].campaign_id;
}

test('migration 033 seeded File 01 "Real Estate" and the header defaults work', async () => {
  const res = await rep.api.get('/api/campaigns');
  assert.equal(res.status, 200);
  const file1 = res.body.campaigns.find((c) => c.file_number === 1);
  assert.equal(file1.name, 'Real Estate');
  assert.equal(file1.kind, 'real_estate');
  assert.equal(file1.company_label, 'Brokerage');
  assert.match(file1.ai_context, /real estate agents/);
});

test('a missing or unknown X-Campaign-Id answers 400 campaign_invalid', async () => {
  const lead = { name: 'No Header', phone: h.nextPhone(), state: 'TX' };
  const missing = await rep.api.post('/api/leads', lead, { campaign: null });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'campaign_invalid');
  const unknown = await rep.api.post('/api/leads', lead, { campaign: 9999 });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'campaign_invalid');
  const garbage = await rep.api.post('/api/calls', {}, { campaign: 'abc' });
  assert.equal(garbage.status, 400);
  assert.equal(garbage.body.code, 'campaign_invalid');
});

test('creating a file: supervisor only, next file number, unique slug, name checks', async () => {
  const denied = await rep.api.post('/api/campaigns', { name: 'Nope' });
  assert.equal(denied.status, 403);
  const roofing = await newFile('Roofing Supplement', { kind: 'roofing_supplement' });
  assert.equal(roofing.file_number, 2);
  assert.equal(roofing.slug, 'roofing-supplement');
  assert.equal(roofing.company_label, 'Company');
  assert.equal(roofing.status, 'active');
  const dup = await supervisor.api.post('/api/campaigns', { name: 'Roofing Supplement' });
  assert.equal(dup.status, 409);
  const badKind = await supervisor.api.post('/api/campaigns', { name: 'Odd', kind: 'spaceships' });
  assert.equal(badKind.status, 400);
  const edited = await supervisor.api.put(`/api/campaigns/${roofing.id}`, { name: 'Roofing', dailyGoal: 80, companyLabel: 'Company' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.campaign.daily_goal, 80);
  assert.equal(edited.body.campaign.slug, 'roofing-supplement'); // the slug stays
});

test('each write path stores the active campaign', async () => {
  const file = await newFile('Write Paths');
  const opts = { campaign: file.id };

  const lead = await rep.api.post('/api/leads', { name: 'Written Lead', phone: h.nextPhone(), state: 'TX' }, opts);
  assert.equal(lead.status, 201, JSON.stringify(lead.body));
  assert.equal(lead.body.lead.campaign_id, file.id);

  const manual = await rep.api.post('/api/calls/manual/start', { toNumber: h.nextPhone() }, opts);
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  assert.equal(await campaignOf('call_history', manual.body.call.id), file.id);

  const session = await rep.api.post('/api/sessions/start', { mode: 'multiline' }, opts);
  assert.equal(session.status, 201, JSON.stringify(session.body));
  assert.equal(await campaignOf('dialing_sessions', session.body.sessionId), file.id);

  const template = await rep.api.post('/api/sms/templates', { name: 'Hello', body: 'Hi {{first_name}}' }, opts);
  assert.equal(template.status, 201, JSON.stringify(template.body));
  assert.equal(await campaignOf('sms_templates', template.body.template.id), file.id);

  const type = await supervisor.api.post('/api/objections/types', { label: 'Too busy to talk' }, opts);
  assert.equal(type.status, 201, JSON.stringify(type.body));
  assert.equal(type.body.type.campaign_id, file.id);

  const form = new FormData();
  form.append('file', new Blob([`Name,Phone,State\nImported Person,(214) 555-7001,TX\n`], { type: 'text/csv' }), 'c1a.csv');
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form, campaign: file.id });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(await campaignOf('import_jobs', up.body.jobId), file.id);
  const proc = await supervisor.api.post('/api/imports/process', { jobId: up.body.jobId, sheets: up.body.sheetNames, mapping: up.body.mapping }, opts);
  assert.equal(proc.status, 200);
  await h.waitFor(async () => (await supervisor.api.get(`/api/imports/status/${up.body.jobId}`)).body.status === 'completed');
  const { rows } = await h.db.query("SELECT campaign_id FROM leads WHERE phone = '+12145557001'");
  assert.equal(rows[0].campaign_id, file.id);
});

test("a lead's call copies the lead's campaign", async () => {
  // C1B: dialing a lead from another file's header is refused (10-dialer-scoping).
  const file = await newFile('Copy From Lead');
  const lead = await h.createLead({ campaign_id: file.id });
  const call = await rep.api.post('/api/calls', { leadId: lead.id }, { campaign: file.id });
  assert.equal(call.status, 201, JSON.stringify(call.body));
  assert.equal(await campaignOf('call_history', call.body.call.id), file.id);
});

test('a paused file refuses dialing and importing (409); an archived one is invalid (400)', async () => {
  const paused = await newFile('Paused File');
  assert.equal((await supervisor.api.post(`/api/campaigns/${paused.id}/status`, { status: 'paused' })).status, 200);
  const opts = { campaign: paused.id };
  for (const [path, body] of [
    ['/api/calls', {}],
    ['/api/calls/manual/start', { toNumber: h.nextPhone() }],
    ['/api/calls/multiline/start', { lineCount: 1, leadIds: [] }],
    ['/api/sessions/start', { mode: 'multiline' }],
    ['/api/imports/process', { jobId: 1 }],
  ]) {
    const res = await rep.api.post(path, body, opts);
    assert.equal(res.status, 409, path);
    assert.equal(res.body.code, 'campaign_paused', path);
  }
  const form = new FormData();
  form.append('file', new Blob(['Name,Phone,State\nA,(214) 555-7002,TX\n'], { type: 'text/csv' }), 'paused.csv');
  assert.equal((await supervisor.api.post('/api/imports/upload', undefined, { form, campaign: paused.id })).status, 409);
  // A paused file still accepts other writes (e.g. a template).
  assert.equal((await rep.api.post('/api/sms/templates', { name: 'P', body: 'x' }, opts)).status, 201);

  const archived = await newFile('Archived File');
  assert.equal((await supervisor.api.post(`/api/campaigns/${archived.id}/status`, { status: 'archived' })).status, 200);
  const res = await rep.api.post('/api/leads', { name: 'X', phone: h.nextPhone(), state: 'TX' }, { campaign: archived.id });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'campaign_invalid');
});

test('moveLead: supervisor only; refused while dialing; old calls keep their campaign', async () => {
  const target = await newFile('Move Target');
  const lead = await h.createLead();
  const call = await h.dial(rep.api, lead.id);
  assert.equal(call.status, 201);
  // In progress: refused.
  const busy = await supervisor.api.post(`/api/leads/${lead.id}/move-campaign`, { campaignId: target.id });
  assert.equal(busy.status, 409);
  await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'no_answer' });
  const denied = await rep.api.post(`/api/leads/${lead.id}/move-campaign`, { campaignId: target.id });
  assert.equal(denied.status, 403);
  const moved = await supervisor.api.post(`/api/leads/${lead.id}/move-campaign`, { campaignId: target.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.lead.campaign_id, target.id);
  assert.equal(await campaignOf('call_history', call.body.call.id), 1);
  const unknown = await supervisor.api.post(`/api/leads/${lead.id}/move-campaign`, { campaignId: 9999 });
  assert.equal(unknown.status, 404);
});

test('setStatus: refused while a lead is being dialed; the last active file cannot be archived', async () => {
  const file = await newFile('Status Rules');
  const lead = await h.createLead({ campaign_id: file.id });
  const call = await rep.api.post('/api/calls', { leadId: lead.id }, { campaign: file.id });
  assert.equal(call.status, 201);
  assert.equal((await supervisor.api.post(`/api/campaigns/${file.id}/status`, { status: 'paused' })).status, 409);
  await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'contacted' });
  assert.equal((await supervisor.api.post(`/api/campaigns/${file.id}/status`, { status: 'paused' })).status, 200);
  assert.equal((await supervisor.api.post(`/api/campaigns/${file.id}/status`, { status: 'active' })).status, 200);
  assert.equal((await rep.api.post(`/api/campaigns/${file.id}/status`, { status: 'paused' })).status, 403);
  assert.equal((await supervisor.api.post(`/api/campaigns/${file.id}/status`, { status: 'gone' })).status, 400);

  // Leave File 01 as the only active file, then try to archive it.
  await h.db.query("UPDATE campaigns SET status = 'paused' WHERE file_number <> 1 AND status = 'active'");
  const last = await supervisor.api.post('/api/campaigns/1/status', { status: 'archived' });
  assert.equal(last.status, 409);
  await h.db.query("UPDATE campaigns SET status = 'active' WHERE id = $1", [file.id]);
  assert.equal((await supervisor.api.post('/api/campaigns/1/status', { status: 'archived' })).status, 200);
  assert.equal((await supervisor.api.post('/api/campaigns/1/status', { status: 'active' })).status, 200);
});

test('objection labels: one per file, the same label in two files, shared labels unique', async () => {
  const a = await newFile('Labels A');
  const b = await newFile('Labels B');
  const add = (label, campaign) => supervisor.api.post('/api/objections/types', { label }, { campaign });
  assert.equal((await add('Already have help', a.id)).status, 201);
  assert.equal((await add('Already have help', b.id)).status, 201);
  assert.equal((await add('Already have help', a.id)).status, 409);
  await h.db.query("INSERT INTO objection_types (label, sort_order, campaign_id) VALUES ('Shared one', 99, NULL)");
  await assert.rejects(
    h.db.query("INSERT INTO objection_types (label, sort_order, campaign_id) VALUES ('Shared one', 100, NULL)"),
    /duplicate key/
  );
});

test('I10 and I11: every lead and every call row has an existing campaign', async () => {
  const count = async (sql) => (await h.db.query(sql)).rows[0].n;
  assert.equal(await count('SELECT count(*)::int AS n FROM leads WHERE campaign_id IS NULL'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM leads l WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = l.campaign_id)'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM call_history WHERE campaign_id IS NULL'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM call_history ch WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ch.campaign_id)'), 0);
  assert.ok((await count('SELECT count(*)::int AS n FROM call_history')) >= 4);
  const notNull = await h.db.query(
    `SELECT table_name, is_nullable FROM information_schema.columns
     WHERE column_name = 'campaign_id' AND table_name IN ('leads', 'call_history', 'dialing_sessions', 'import_jobs')`
  );
  assert.equal(notNull.rows.length, 4);
  for (const r of notNull.rows) assert.equal(r.is_nullable, 'NO', r.table_name);
});
