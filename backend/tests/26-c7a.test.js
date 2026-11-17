// C7A: GET /api/views/counts returns, in one request, the same count for every
// saved view as the single-view route (GET /api/views?counts=1) and as the
// lead list's total for that view's filters. (The 600/min default and the
// RATE_LIMIT_API_MAX override are checked in 01-auth-settings.)
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let file2;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  file2 = await h.createCampaign({ name: 'Roofing' });
  for (let i = 0; i < 12; i += 1) {
    await h.createLead({ name: `Count Lead ${i}`, state: i % 3 ? 'TX' : 'CA', areaCode: i % 3 ? '214' : '415', tags: i < 4 ? ['vip'] : [], status: i % 4 === 0 ? 'new' : 'in_queue', attempts: i % 5 });
  }
  await h.createLead({ name: 'Other File Lead', campaign_id: file2.id, tags: ['vip'] });
});

test('one counts request gives every view the same number as the single-view route and the list', async () => {
  const filters = [
    { tag: 'vip' },
    { state: 'CA' },
    { status: 'new' },
    { search: 'Count Lead 1' },
    { minAttempts: '3', state: 'TX' },
  ];
  for (const [i, f] of filters.entries()) {
    const r = await rep.api.post('/api/views', { name: `View ${i}`, filters: f });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const counts = await rep.api.get('/api/views/counts');
  assert.equal(counts.status, 200, JSON.stringify(counts.body));
  assert.equal(counts.body.counts.length, 5);
  const single = await rep.api.get('/api/views?counts=1');
  const byId = new Map(counts.body.counts.map((c) => [c.id, c.count]));
  for (const v of single.body.views) {
    assert.equal(byId.get(v.id), v.count, `view ${v.name}`);
    const qs = new URLSearchParams(v.filters).toString();
    const list = await rep.api.get(`/api/leads?${qs}&limit=1`);
    assert.equal(byId.get(v.id), list.body.total, `list total for ${v.name}`);
  }
  assert.equal(byId.get(single.body.views[0].id), 4, 'vip in File 01 only');
  // Per file: File 02 has no views of this user.
  assert.deepEqual((await rep.api.get('/api/views/counts', { campaign: file2.id })).body.counts, []);
});
