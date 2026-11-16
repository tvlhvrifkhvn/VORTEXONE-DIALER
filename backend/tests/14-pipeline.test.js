// C2A: the pipeline backend (docs/CRM_PLAN.md).
// I12 a lead's stage belongs to the lead's campaign; I13 every lead has a
// stage. The disposition rules (explicit stage wins; contacted -> the auto
// stage only from an earlier open stage; dnc -> lost "Do not call"); Undo
// restores stage, won_at and lost_reason; every move writes history; create,
// import and moving files set the first stage; the stage guards; the board.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const leadLifecycle = require('../src/services/leadLifecycle');

let rep;
let supervisor;
let stages; // File 01 stages by name

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
  const res = await rep.api.get('/api/pipeline/stages');
  assert.equal(res.status, 200);
  stages = Object.fromEntries(res.body.stages.map((s) => [s.name, s]));
});

async function historyOf(leadId) {
  return (await h.db.query('SELECT * FROM lead_stage_history WHERE lead_id = $1 ORDER BY id', [leadId])).rows;
}

async function dispose(leadId, disposition, extra = {}) {
  const call = await h.dial(rep.api, leadId);
  assert.equal(call.status, 201, JSON.stringify(call.body));
  const res = await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition, ...extra });
  return { res, callId: call.body.call.id };
}

test('templates: File 01 has the real estate stages; new files get their kind template', async () => {
  assert.deepEqual(
    Object.values(stages).sort((a, b) => a.position - b.position).map((s) => `${s.name}:${s.kind}${s.auto_on ? ':auto' : ''}`),
    ['New:open', 'Contacted:open:auto', 'Interested:open', 'Intro call booked:open', 'Proposal sent:open', 'Client:won', 'Lost:lost']
  );
  const roof = await supervisor.api.post('/api/campaigns', { name: 'Roof Pipe', kind: 'roofing_supplement' });
  const blank = await supervisor.api.post('/api/campaigns', { name: 'Blank Pipe', kind: 'custom' });
  const names = async (id) => (await rep.api.get('/api/pipeline/stages', { campaign: id })).body.stages.map((s) => s.name);
  assert.deepEqual(await names(roof.body.campaign.id), ['New', 'Contacted', 'Interested', 'Sample claim received', 'First claim in progress', 'Client', 'Lost']);
  assert.deepEqual(await names(blank.body.campaign.id), ['New', 'Contacted', 'Interested', 'Client', 'Lost']);
});

test('I13: a lead added by hand or imported starts in the first stage, with a history row', async () => {
  const created = await rep.api.post('/api/leads', { name: 'Stage Create', phone: h.nextPhone(), state: 'TX' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.lead.pipeline_stage_id, stages.New.id);
  assert.deepEqual((await historyOf(created.body.lead.id)).map((r) => [r.from_stage_id, r.to_stage_id, r.source]), [[null, stages.New.id, 'create']]);

  const phone = h.nextPhone();
  const local = `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  const form = new FormData();
  form.append('file', new Blob([`Name,Phone,State\nStage Import,${local},TX`], { type: 'text/csv' }), 'stage.csv');
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  await supervisor.api.post('/api/imports/process', { jobId: up.body.jobId, sheets: up.body.sheetNames, mapping: up.body.mapping });
  await h.waitFor(async () => {
    const s = await supervisor.api.get(`/api/imports/status/${up.body.jobId}`);
    return s.body.status === 'completed' ? s.body : null;
  });
  const { rows } = await h.db.query('SELECT * FROM leads WHERE phone = $1', [phone]);
  assert.equal(rows[0].pipeline_stage_id, stages.New.id);
  const hist = await historyOf(rows[0].id);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].source, 'import');
  assert.equal(hist[0].user_id, supervisor.user.id);

  const missing = await h.db.query('SELECT count(*)::int AS n FROM leads WHERE pipeline_stage_id IS NULL');
  assert.equal(missing.rows[0].n, 0);
});

test('I12: a stage of another file is refused, by the API and by the database', async () => {
  const other = await h.createCampaign({ name: 'Other Pipe' });
  const otherFirst = (await h.db.query('SELECT id FROM pipeline_stages WHERE campaign_id = $1 ORDER BY position LIMIT 1', [other.id])).rows[0].id;
  const lead = await h.createLead();
  const res = await rep.api.post(`/api/leads/${lead.id}/stage`, { stageId: otherFirst });
  assert.equal(res.status, 400);
  await assert.rejects(
    () => h.db.query('UPDATE leads SET pipeline_stage_id = $2 WHERE id = $1', [lead.id, otherFirst]),
    /leads_stage_campaign_fkey/
  );
  const bad = await h.db.query(
    `SELECT count(*)::int AS n FROM leads l JOIN pipeline_stages s ON s.id = l.pipeline_stage_id WHERE s.campaign_id <> l.campaign_id`
  );
  assert.equal(bad.rows[0].n, 0);
});

test('contacted moves a lead from an earlier open stage to the auto stage, and no further back', async () => {
  const fresh = await h.createLead();
  assert.equal((await dispose(fresh.id, 'contacted')).res.status, 200);
  const moved = await h.getLead(fresh.id);
  assert.equal(moved.pipeline_stage_id, stages.Contacted.id);
  assert.deepEqual((await historyOf(fresh.id)).map((r) => [r.from_stage_id, r.to_stage_id, r.source, r.user_id]), [
    [stages.New.id, stages.Contacted.id, 'disposition', rep.user.id],
  ]);

  for (const name of ['Interested', 'Lost', 'Client']) {
    const lead = await h.createLead({ pipeline_stage_id: stages[name].id });
    assert.equal((await dispose(lead.id, 'contacted')).res.status, 200);
    assert.equal((await h.getLead(lead.id)).pipeline_stage_id, stages[name].id, name);
    assert.equal((await historyOf(lead.id)).length, 0, name);
  }
});

test('dnc moves the lead to Lost with reason "Do not call"; voicemail moves nothing', async () => {
  const lead = await h.createLead({ pipeline_stage_id: stages.Interested.id });
  assert.equal((await dispose(lead.id, 'dnc')).res.status, 200);
  const after = await h.getLead(lead.id);
  assert.equal(after.pipeline_stage_id, stages.Lost.id);
  assert.equal(after.lost_reason, 'Do not call');

  const vm = await h.createLead();
  assert.equal((await dispose(vm.id, 'voicemail')).res.status, 200);
  assert.equal((await h.getLead(vm.id)).pipeline_stage_id, stages.New.id);
  assert.equal((await historyOf(vm.id)).length, 0);
});

test('an explicit stage wins over the auto rules; a stage of another file fails the whole disposition', async () => {
  const lead = await h.createLead();
  const { res } = await dispose(lead.id, 'contacted', { stageId: stages['Intro call booked'].id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.lead.pipeline_stage_id, stages['Intro call booked'].id);

  const won = await h.createLead();
  const r2 = (await dispose(won.id, 'voicemail', { stageId: stages.Client.id })).res;
  assert.equal(r2.status, 200);
  assert.ok((await h.getLead(won.id)).won_at, 'won_at set on the won stage');

  const other = await h.createCampaign({ name: 'Explicit Other' });
  const otherStage = (await h.db.query('SELECT id FROM pipeline_stages WHERE campaign_id = $1 LIMIT 1', [other.id])).rows[0].id;
  const lead3 = await h.createLead();
  const { res: r3, callId } = await dispose(lead3.id, 'contacted', { stageId: otherStage });
  assert.equal(r3.status, 400);
  assert.equal((await h.getLead(lead3.id)).status, 'in_progress', 'the disposition rolled back');
  assert.equal((await h.db.query('SELECT disposition FROM call_history WHERE id = $1', [callId])).rows[0].disposition, null);
  await rep.api.post('/api/dispositions', { callId, disposition: 'voicemail' });
});

test('Undo restores the stage, won_at and lost_reason, with an undo history row', async () => {
  const lead = await h.createLead({ pipeline_stage_id: stages.Client.id });
  await h.db.query("UPDATE leads SET won_at = '2026-01-02T03:04:05Z' WHERE id = $1", [lead.id]);
  const { res, callId } = await dispose(lead.id, 'dnc');
  assert.equal(res.status, 200);
  assert.equal(res.body.lead.pipeline_stage_id, stages.Lost.id);
  assert.equal(res.body.lead.won_at, null);

  const undo = await rep.api.post(`/api/dispositions/${callId}/undo`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  const after = await h.getLead(lead.id);
  assert.equal(after.pipeline_stage_id, stages.Client.id);
  assert.equal(new Date(after.won_at).toISOString(), '2026-01-02T03:04:05.000Z');
  assert.equal(after.lost_reason, null);
  assert.deepEqual((await historyOf(lead.id)).map((r) => [r.from_stage_id, r.to_stage_id, r.source]), [
    [stages.Client.id, stages.Lost.id, 'disposition'],
    [stages.Lost.id, stages.Client.id, 'undo'],
  ]);
  assert.equal(after.status, 'in_progress');
  await rep.api.post('/api/dispositions', { callId, disposition: 'voicemail' });
});

test('a manual move writes history; the same stage writes none; won_at follows the won stage', async () => {
  const lead = await h.createLead();
  const move = (stageId, extra = {}) => rep.api.post(`/api/leads/${lead.id}/stage`, { stageId, ...extra });
  const r1 = await move(stages.Client.id);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.moved, true);
  assert.ok(r1.body.lead.won_at);
  assert.equal((await move(stages.Client.id)).body.moved, false);
  const r3 = await move(stages.Lost.id, { lostReason: 'Went with another VA' });
  assert.equal(r3.body.lead.won_at, null);
  assert.equal(r3.body.lead.lost_reason, 'Went with another VA');
  const r4 = await move(stages.Interested.id);
  assert.equal(r4.body.lead.lost_reason, null);
  const hist = await historyOf(lead.id);
  assert.deepEqual(hist.map((r) => [r.to_stage_id, r.source, r.user_id]), [
    [stages.Client.id, 'manual', rep.user.id],
    [stages.Lost.id, 'manual', rep.user.id],
    [stages.Interested.id, 'manual', rep.user.id],
  ]);
  // A stage move is the CRM's: the dialer's status is untouched.
  assert.equal((await h.getLead(lead.id)).status, 'in_queue');
});

test('DNC found by the queue or a slot moves the lead to Lost', async () => {
  const a = await h.createLead();
  const b = await h.createLead({ pipeline_stage_id: stages.Interested.id });
  await leadLifecycle.markDncFromQueue(a.id);
  await leadLifecycle.markDncFromSlot(b.id);
  for (const lead of [a, b]) {
    const after = await h.getLead(lead.id);
    assert.equal(after.status, 'dnc');
    assert.equal(after.pipeline_stage_id, stages.Lost.id);
    assert.equal(after.lost_reason, 'Do not call');
  }
});

test("moving a lead to another file puts it in that file's first stage", async () => {
  const other = await h.createCampaign({ name: 'Move Target', kind: 'roofing_supplement' });
  const first = (await h.db.query('SELECT id FROM pipeline_stages WHERE campaign_id = $1 ORDER BY position LIMIT 1', [other.id])).rows[0].id;
  const lead = await h.createLead({ pipeline_stage_id: stages.Client.id, won_at: new Date() });
  const res = await supervisor.api.post(`/api/leads/${lead.id}/move-campaign`, { campaignId: other.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.lead.pipeline_stage_id, first);
  assert.equal(res.body.lead.won_at, null);
  assert.deepEqual((await historyOf(lead.id)).map((r) => [r.from_stage_id, r.to_stage_id, r.source]), [[stages.Client.id, first, 'move']]);
});

test('stage guards: won and lost stay, a used stage stays, the first stage stays open; reps cannot edit', async () => {
  const file = await supervisor.api.post('/api/campaigns', { name: 'Guard Pipe', kind: 'custom' });
  const opts = { campaign: file.body.campaign.id };
  const list = async () => (await supervisor.api.get('/api/pipeline/stages', opts)).body.stages;
  let s = Object.fromEntries((await list()).map((x) => [x.name, x]));

  assert.equal((await rep.api.post('/api/pipeline/stages', { name: 'Nope' }, opts)).status, 403);
  const added = await supervisor.api.post('/api/pipeline/stages', { name: 'Demo booked' }, opts);
  assert.equal(added.status, 201);
  assert.deepEqual((await list()).map((x) => x.name), ['New', 'Contacted', 'Interested', 'Demo booked', 'Client', 'Lost']);
  assert.equal((await supervisor.api.post('/api/pipeline/stages', { name: 'demo  booked' }, opts)).status, 201, 'case differs');
  assert.equal((await supervisor.api.post('/api/pipeline/stages', { name: 'Demo booked' }, opts)).status, 409);

  assert.equal((await supervisor.api.del(`/api/pipeline/stages/${s.Client.id}`)).status, 409);
  assert.equal((await supervisor.api.del(`/api/pipeline/stages/${s.Lost.id}`)).status, 409);
  const lead = await h.createLead({ campaign_id: file.body.campaign.id, pipeline_stage_id: s.Interested.id });
  const used = await supervisor.api.del(`/api/pipeline/stages/${s.Interested.id}`);
  assert.equal(used.status, 409);
  assert.match(used.body.error, /1 lead/);
  await h.db.query('DELETE FROM leads WHERE id = $1', [lead.id]);
  assert.equal((await supervisor.api.del(`/api/pipeline/stages/${s.Interested.id}`)).status, 200);
  assert.deepEqual((await list()).map((x) => x.position), [1, 2, 3, 4, 5, 6]);

  const ids = (await list()).map((x) => x.id);
  const wonFirst = [s.Client.id, ...ids.filter((id) => id !== s.Client.id)];
  assert.equal((await supervisor.api.post('/api/pipeline/stages/reorder', { ids: wonFirst }, opts)).status, 409);
  assert.equal((await supervisor.api.post('/api/pipeline/stages/reorder', { ids: ids.slice(1) }, opts)).status, 400);
  const swapped = [ids[1], ids[0], ...ids.slice(2)];
  const re = await supervisor.api.post('/api/pipeline/stages/reorder', { ids: swapped }, opts);
  assert.equal(re.status, 200);
  assert.deepEqual(re.body.stages.map((x) => x.id), swapped);

  // Delete every open stage but one; the last open first stage can't go.
  s = Object.fromEntries((await list()).map((x) => [x.name, x]));
  for (const name of ['New', 'Demo booked', 'demo booked']) {
    assert.equal((await supervisor.api.del(`/api/pipeline/stages/${s[name].id}`)).status, 200, name);
  }
  assert.equal((await supervisor.api.del(`/api/pipeline/stages/${s.Contacted.id}`)).status, 409);
  assert.equal((await supervisor.api.put(`/api/pipeline/stages/${s.Contacted.id}`, { name: 'Spoke' })).body.stage.name, 'Spoke');
});

test('the board: every stage with its count and its most recently active leads; the list filters by stage', async () => {
  const file = await h.createCampaign({ name: 'Board Pipe' });
  const s = Object.fromEntries((await rep.api.get('/api/pipeline/stages', { campaign: file.id })).body.stages.map((x) => [x.name, x]));
  const leads = [];
  for (let i = 0; i < 4; i++) leads.push(await h.createLead({ campaign_id: file.id }));
  await rep.api.post(`/api/leads/${leads[0].id}/stage`, { stageId: s.Interested.id });
  await rep.api.post(`/api/leads/${leads[1].id}/stage`, { stageId: s.Interested.id });

  const board = await rep.api.get('/api/pipeline/board?perStage=1', { campaign: file.id });
  assert.equal(board.status, 200);
  const col = Object.fromEntries(board.body.stages.map((x) => [x.name, x]));
  assert.equal(col.New.count, 2);
  assert.equal(col.Interested.count, 2);
  assert.equal(col.Interested.leads.length, 1);
  assert.equal(col.Interested.leads[0].id, leads[1].id, 'the latest move first');
  assert.equal(col.Client.count, 0);
  assert.equal(board.body.stages.length, 5);

  const listed = await rep.api.get(`/api/leads?stageId=${s.Interested.id}`, { campaign: file.id });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.leads.map((l) => l.id).sort(), [leads[0].id, leads[1].id].sort());
  assert.equal(listed.body.leads[0].stage_name, 'Interested');
  assert.equal(listed.body.leads[0].stage_kind, 'open');
  assert.equal((await rep.api.get('/api/pipeline/board', { campaign: null })).status, 400);
});
