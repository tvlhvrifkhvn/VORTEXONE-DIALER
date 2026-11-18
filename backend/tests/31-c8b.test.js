// C8B: Today's TO DO rows show the name and the company, so /api/today and
// the task views carry the lead's company (brokerage) with each row.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
const iso = (ms) => new Date(ms).toISOString();

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
});

test('today callbacks, replies, gone-quiet leads and tasks carry the company', async () => {
  const now = Date.now();
  const cb = await h.createLead({ brokerage: 'Keller Realty', status: 'callback_scheduled', next_action_at: new Date(now - 60e3) });
  const texted = await h.createLead({ brokerage: 'Lone Star Homes' });
  await h.db.query("INSERT INTO sms_messages (lead_id, direction, body, is_read) VALUES ($1, 'inbound', 'hi', false)", [texted.id]);
  await rep.api.post('/api/tasks', { leadId: texted.id, title: 'Reply', dueAt: iso(now - 60e3) });
  await rep.api.post('/api/tasks', { leadId: cb.id, title: 'Later', dueAt: iso(now + 3 * 24 * 3600e3) });

  const t = (await rep.api.get('/api/today')).body;
  assert.equal(t.callbacks.items.find((c) => c.id === cb.id).company, 'Keller Realty');
  assert.equal(t.unreadTexts.items.find((r) => r.id === texted.id).company, 'Lone Star Homes');
  assert.equal(t.tasks.items[0].lead_company, 'Lone Star Homes');

  const up = (await rep.api.get('/api/tasks?view=upcoming')).body;
  const later = (up.items || []).find((i) => i.title === 'Later');
  assert.ok(later, JSON.stringify(up).slice(0, 300));
  assert.equal(later.lead_company, 'Keller Realty');
});
