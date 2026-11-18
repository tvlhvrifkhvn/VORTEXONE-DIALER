// C7E: pipeline board search. Each stage returns only the matching cards and
// its count of matches; the matching is the lead search's (name, company,
// phone digits, tag); LOAD MORE pages within the matches; no search = the
// whole board as before.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let stage;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  const { rows } = await h.db.query('SELECT id, name FROM pipeline_stages WHERE campaign_id = 1 ORDER BY position');
  stage = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  const add = (name, stageName, extra = {}) => h.createLead({ name, pipeline_stage_id: stage[stageName], ...extra });
  await add('Alice Acme', 'New', { brokerage: 'Acme Realty' });
  await add('Bob Acme', 'New', { brokerage: 'Acme Realty' });
  await add('Carol Other', 'New', { brokerage: 'Other Homes' });
  await add('Dave Acme', 'Interested', { brokerage: 'ACME realty' });
  await add('Erin Tagged', 'Interested', { tags: ['acme-referral'] });
  await add('Frank Phone', 'Contacted', { phone: '+12145559876' });
  for (let i = 0; i < 4; i += 1) await add(`Many Acme ${i}`, 'Contacted', { brokerage: 'Acme Realty' });
});

const col = (board, name) => board.stages.find((s) => s.id === stage[name]);

test('board search: only matching cards per stage, with counts of matches', async () => {
  const res = await rep.api.get('/api/pipeline/board?search=acme');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.search, 'acme');
  assert.deepEqual(col(res.body, 'New').leads.map((l) => l.name).sort(), ['Alice Acme', 'Bob Acme']);
  assert.equal(col(res.body, 'New').count, 2);
  // Company (case-insensitive) and tag both match.
  assert.deepEqual(col(res.body, 'Interested').leads.map((l) => l.name).sort(), ['Dave Acme', 'Erin Tagged']);
  assert.equal(col(res.body, 'Interested').count, 2);
  assert.equal(col(res.body, 'Contacted').count, 4);
  assert.equal(col(res.body, 'Client').count, 0);
  assert.deepEqual(col(res.body, 'Client').leads, []);
  // Every stage is still there (empty columns too) and cards carry their tags.
  assert.equal(res.body.stages.length, 7);
  assert.deepEqual(col(res.body, 'Interested').leads.find((l) => l.name === 'Erin Tagged').tags, ['acme-referral']);
});

test('board search: phone last digits; LOAD MORE pages within the matches; no search = the whole board', async () => {
  const phone = await rep.api.get('/api/pipeline/board?search=9876');
  assert.deepEqual(phone.body.stages.flatMap((s) => s.leads.map((l) => l.name)), ['Frank Phone']);
  assert.equal(col(phone.body, 'Contacted').count, 1);

  const page1 = await rep.api.get(`/api/pipeline/board?search=acme&perStage=2&stageId=${stage.Contacted}`);
  const page2 = await rep.api.get(`/api/pipeline/board?search=acme&perStage=2&stageId=${stage.Contacted}&offset=2`);
  assert.equal(page1.body.stages[0].leads.length, 2);
  assert.equal(page2.body.stages[0].leads.length, 2);
  assert.equal(page1.body.stages[0].count, 4);
  const names = [...page1.body.stages[0].leads, ...page2.body.stages[0].leads].map((l) => l.name);
  assert.equal(new Set(names).size, 4);
  assert.ok(names.every((n) => n.startsWith('Many Acme')));

  const all = await rep.api.get('/api/pipeline/board');
  assert.equal(all.body.search, null);
  assert.equal(col(all.body, 'New').count, 3);
  assert.equal(col(all.body, 'Contacted').count, 5);
  // A search with % or _ is taken literally.
  assert.equal((await rep.api.get('/api/pipeline/board?search=%25')).body.stages.reduce((n, s) => n + s.count, 0), 0);
});
