// C2B: the two API additions the pipeline screens need. A column's LOAD MORE
// (board with stageId + offset) pages through one stage without repeats; the
// deal value saves in cents, clears with null, and leaves the dialer's
// fields (status, updated_at) alone.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let stages;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  stages = Object.fromEntries((await rep.api.get('/api/pipeline/stages')).body.stages.map((s) => [s.name, s]));
});

test('LOAD MORE: one stage, paged by offset, every lead once', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await h.createLead({ pipeline_stage_id: stages.Interested.id })).id);
  const page = async (offset) =>
    (await rep.api.get(`/api/pipeline/board?perStage=2&stageId=${stages.Interested.id}&offset=${offset}`)).body;
  const p1 = await page(0);
  assert.equal(p1.stages.length, 1);
  assert.equal(p1.stages[0].count, 5);
  const seen = [];
  for (const offset of [0, 2, 4]) seen.push(...(await page(offset)).stages[0].leads.map((l) => l.id));
  assert.deepEqual(seen.sort(), ids.sort());
  const other = await h.createCampaign({ name: 'Other Board' });
  const otherStage = (await h.db.query('SELECT id FROM pipeline_stages WHERE campaign_id = $1 LIMIT 1', [other.id])).rows[0].id;
  assert.equal((await rep.api.get(`/api/pipeline/board?stageId=${otherStage}`)).status, 400);
});

test('deal value: cents saved and cleared; status and updated_at untouched; bad values 400', async () => {
  const lead = await h.createLead();
  const set = (v) => rep.api.put(`/api/leads/${lead.id}/deal`, { dealValueCents: v });
  const r1 = await set(250000);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(Number(r1.body.lead.deal_value_cents), 250000);
  assert.equal(r1.body.lead.status, lead.status);
  assert.equal(new Date(r1.body.lead.updated_at).getTime(), new Date(lead.updated_at).getTime());
  assert.equal((await set(null)).body.lead.deal_value_cents, null);
  assert.equal((await set(-5)).status, 400);
  assert.equal((await set(12.5)).status, 400);
  assert.equal((await rep.api.put('/api/leads/999999/deal', { dealValueCents: 1 })).status, 404);
});
