// C7C: a list is a tag. Adding leads to a list adds `list:<name>` to them
// (and nothing else); list counts per file and ALL; the list's tag works as
// the lead list's tag filter; bad names are refused.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let file2;
let leads;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  file2 = await h.createCampaign({ name: 'Roofing' });
  leads = [];
  for (let i = 0; i < 4; i += 1) leads.push(await h.createLead({ name: `List Lead ${i}`, tags: i === 0 ? ['hot'] : [] }));
  leads.push(await h.createLead({ name: 'Other File', campaign_id: file2.id }));
});

test('adding to a list adds the tag list:<name>, keeps other tags, and is the same as tagging by hand', async () => {
  const res = await rep.api.post('/api/leads/lists/add', { leadIds: [leads[0].id, leads[1].id], name: '  Open  house  ' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.tag, 'list:Open house');
  assert.deepEqual((await h.getLead(leads[0].id)).tags, ['hot', 'list:Open house']);
  assert.deepEqual((await h.getLead(leads[1].id)).tags, ['list:Open house']);
  // Adding again doesn't duplicate; a lead tagged by hand is in the list too.
  await rep.api.post('/api/leads/lists/add', { leadIds: [leads[0].id], name: 'Open house' });
  assert.deepEqual((await h.getLead(leads[0].id)).tags, ['hot', 'list:Open house']);
  assert.equal((await rep.api.post(`/api/leads/${leads[2].id}/tags`, { tag: 'list:Open house' })).status, 201);
  // The list's tag is the leads list's tag filter.
  const filtered = await rep.api.get(`/api/leads?tag=${encodeURIComponent('list:Open house')}&limit=50`);
  assert.deepEqual(filtered.body.leads.map((l) => l.id).sort(), [leads[0].id, leads[1].id, leads[2].id].sort());
});

test('list counts per file and ALL; bad names are refused', async () => {
  await rep.api.post('/api/leads/lists/add', { leadIds: [leads[3].id], name: 'Follow up' });
  await rep.api.post('/api/leads/lists/add', { leadIds: [leads[4].id], name: 'Follow up' });
  const file1 = await rep.api.get('/api/leads/lists');
  assert.equal(file1.status, 200);
  assert.deepEqual(file1.body.lists, [
    { name: 'Follow up', tag: 'list:Follow up', count: 1 },
    { name: 'Open house', tag: 'list:Open house', count: 3 },
  ]);
  const all = await rep.api.get('/api/leads/lists', { campaign: 'ALL' });
  assert.equal(all.body.lists.find((l) => l.name === 'Follow up').count, 2);
  // Ordinary tags are not lists; a deleted lead leaves the count.
  assert.ok(!all.body.lists.some((l) => l.name === 'hot'));
  await rep.api.del(`/api/leads/${leads[1].id}`);
  assert.equal((await rep.api.get('/api/leads/lists')).body.lists.find((l) => l.name === 'Open house').count, 2);

  assert.equal((await rep.api.post('/api/leads/lists/add', { leadIds: [leads[0].id], name: '   ' })).status, 400);
  assert.equal((await rep.api.post('/api/leads/lists/add', { leadIds: [leads[0].id], name: 'x'.repeat(36) })).status, 400);
  assert.equal((await rep.api.post('/api/leads/lists/add', { leadIds: [], name: 'Empty' })).status, 400);
});
