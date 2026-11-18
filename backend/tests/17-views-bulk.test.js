// C2E: saved views and bulk actions (docs/CRM_PLAN.md).
// A saved view returns the same rows as the same filters sent by hand; the
// four new list filters; each bulk action; the 500 limit; in_progress leads
// are skipped and reported; views belong to one user and one file.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let other;
let supervisor;
let stages;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  other = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
  stages = Object.fromEntries((await rep.api.get('/api/pipeline/stages')).body.stages.map((s) => [s.name, s]));
});

const ids = (res) => res.body.leads.map((l) => l.id).sort((a, b) => a - b);

test('the new filters: tag, minimum attempts, no activity for N days, callback overdue', async () => {
  const tagged = await h.createLead({ tags: ['hot'] });
  const tried = await h.createLead({ attempts: 3 });
  const stale = await h.createLead();
  await h.db.query("UPDATE leads SET updated_at = now() - interval '20 days' WHERE id = $1", [stale.id]);
  const overdue = await h.createLead({ status: 'callback_scheduled', next_action_at: new Date(Date.now() - 3600e3) });
  const future = await h.createLead({ status: 'callback_scheduled', next_action_at: new Date(Date.now() + 3600e3) });

  const get = (q) => rep.api.get(`/api/leads?limit=10000&${q}`);
  assert.ok(ids(await get('tag=hot')).includes(tagged.id));
  assert.ok(!ids(await get('tag=hot')).includes(tried.id));
  const min = ids(await get('minAttempts=3'));
  assert.ok(min.includes(tried.id) && !min.includes(tagged.id));
  const quiet = ids(await get('noActivityDays=14'));
  assert.ok(quiet.includes(stale.id) && !quiet.includes(tagged.id));
  const od = ids(await get('callbackOverdue=true'));
  assert.ok(od.includes(overdue.id) && !od.includes(future.id));
  assert.equal((await get('minAttempts=abc')).status, 400);
  assert.equal((await get('callbackOverdue=maybe')).status, 400);
});

test('a saved view returns the same rows as the same filters sent by hand, with a live count', async () => {
  for (let i = 0; i < 3; i++) await h.createLead({ tags: ['vip'], attempts: 2, pipeline_stage_id: stages.Interested.id });
  await h.createLead({ tags: ['vip'], attempts: 0 });
  const filters = { tag: 'vip', minAttempts: 1, stageId: stages.Interested.id };
  const made = await rep.api.post('/api/views', { name: 'VIP tried', filters });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual(made.body.view.filters, { tag: 'vip', minAttempts: '1', stageId: String(stages.Interested.id) });

  const byHand = await rep.api.get(`/api/leads?limit=10000&tag=vip&minAttempts=1&stageId=${stages.Interested.id}`);
  const q = new URLSearchParams({ ...made.body.view.filters, limit: '10000' }).toString();
  const byView = await rep.api.get(`/api/leads?${q}`);
  assert.deepEqual(ids(byView), ids(byHand));
  assert.equal(ids(byHand).length, 3);

  const list = await rep.api.get('/api/views?counts=1');
  assert.equal(list.body.views.find((v) => v.name === 'VIP tried').count, 3);
  assert.equal((await rep.api.post('/api/views', { name: 'Bad', filters: { minAttempts: 'x' } })).status, 400);
  assert.equal((await rep.api.post('/api/views', { name: 'VIP tried', filters: {} })).status, 409);
});

test('views are per user and per file; rename, reorder, delete', async () => {
  const a = (await rep.api.post('/api/views', { name: 'Mine A', filters: { status: 'new' } })).body.view;
  const b = (await rep.api.post('/api/views', { name: 'Mine B', filters: {} })).body.view;
  assert.ok(!(await other.api.get('/api/views')).body.views.some((v) => v.id === a.id));
  assert.equal((await other.api.del(`/api/views/${a.id}`)).status, 404);
  const file2 = await h.createCampaign({ name: 'Views Two' });
  assert.equal((await rep.api.get('/api/views', { campaign: file2.id })).body.views.length, 0);

  assert.equal((await rep.api.put(`/api/views/${a.id}`, { name: 'Renamed' })).body.view.name, 'Renamed');
  const all = (await rep.api.get('/api/views')).body.views.map((v) => v.id);
  const re = await rep.api.post('/api/views/reorder', { ids: [...all].reverse() });
  assert.deepEqual(re.body.views.map((v) => v.id), [...all].reverse());
  assert.equal((await rep.api.del(`/api/views/${b.id}`)).status, 200);
  assert.ok(!(await rep.api.get('/api/views')).body.views.some((v) => v.id === b.id));
});

test('bulk stage move: one transaction, history source bulk, in_progress and other-file leads skipped', async () => {
  const leads = [await h.createLead(), await h.createLead(), await h.createLead()];
  const busy = await h.createLead();
  const dial = await h.dial(rep.api, busy.id);
  assert.equal(dial.status, 201);
  const file2 = await h.createCampaign({ name: 'Bulk Other' });
  const foreign = await h.createLead({ campaign_id: file2.id });

  const res = await rep.api.post('/api/leads/bulk/stage', {
    leadIds: [...leads.map((l) => l.id), busy.id, foreign.id, 999999],
    stageId: stages['Proposal sent'].id,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.updated.sort(), leads.map((l) => l.id).sort());
  const reasons = Object.fromEntries(res.body.skipped.map((s) => [s.id, s.reason]));
  assert.equal(reasons[busy.id], 'being dialed right now');
  assert.equal(reasons[foreign.id], 'in another file');
  assert.equal(reasons[999999], 'not found');
  for (const l of leads) {
    assert.equal((await h.getLead(l.id)).pipeline_stage_id, stages['Proposal sent'].id);
    const hist = (await h.db.query('SELECT source, user_id FROM lead_stage_history WHERE lead_id = $1', [l.id])).rows;
    assert.deepEqual(hist, [{ source: 'bulk', user_id: rep.user.id }]);
  }
  assert.equal((await h.getLead(busy.id)).pipeline_stage_id, stages.New.id);
  await rep.api.post('/api/dispositions', { callId: dial.body.call.id, disposition: 'voicemail' });
});

test('bulk tags add and remove; bulk file move is supervisor only and lands in the first stage', async () => {
  const leads = [await h.createLead(), await h.createLead()];
  const leadIds = leads.map((l) => l.id);
  const added = await rep.api.post('/api/leads/bulk/tag', { leadIds, tag: 'Q4 push', action: 'add' });
  assert.deepEqual(added.body.updated.sort(), leadIds.sort());
  for (const id of leadIds) assert.deepEqual((await h.getLead(id)).tags, ['Q4 push']);
  await rep.api.post('/api/leads/bulk/tag', { leadIds, tag: 'Q4 push', action: 'remove' });
  for (const id of leadIds) assert.deepEqual((await h.getLead(id)).tags, []);
  assert.equal((await rep.api.post('/api/leads/bulk/tag', { leadIds, tag: 'x', action: 'toggle' })).status, 400);

  const target = await h.createCampaign({ name: 'Bulk Target', kind: 'roofing_supplement' });
  const first = (await h.db.query('SELECT id FROM pipeline_stages WHERE campaign_id = $1 ORDER BY position LIMIT 1', [target.id])).rows[0].id;
  assert.equal((await rep.api.post('/api/leads/bulk/campaign', { leadIds, campaignId: target.id })).status, 403);
  const moved = await supervisor.api.post('/api/leads/bulk/campaign', { leadIds, campaignId: target.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  for (const id of leadIds) {
    const l = await h.getLead(id);
    assert.equal(l.campaign_id, target.id);
    assert.equal(l.pipeline_stage_id, first);
  }
  const again = await supervisor.api.post('/api/leads/bulk/campaign', { leadIds, campaignId: target.id });
  assert.equal(again.body.skipped.length, 2);
});

test('the 500 limit', async () => {
  const many = Array.from({ length: 501 }, (_, i) => i + 1);
  const res = await rep.api.post('/api/leads/bulk/tag', { leadIds: many, tag: 'x', action: 'add' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /500/);
  const ok = await rep.api.post('/api/leads/bulk/tag', { leadIds: many.slice(0, 500), tag: 'x', action: 'add' });
  assert.equal(ok.status, 200);
});
