// C6A: tag search, the three task views around midnight with a controlled
// clock, reminders (due-soon and "reminded today"), and the CSV export (the
// same rows as the list for the same filter; the injection guard).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('csv-parse/sync');
const h = require('./helpers');
const settings = require('../src/services/settings');
const taskViews = require('../src/services/taskViews');
const tasks = require('../src/services/tasks');

let rep;
let file2;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  file2 = await h.createCampaign({ name: 'Roofing' });
  // A fixed reporting day: UTC, starting at midnight.
  await settings.setSetting('reporting_timezone', 'UTC');
  await settings.setSetting('day_start_time', '00:00');
});

after(() => h.resetClock());

test('the lead search box and the global search also match tags (contains, case-insensitive)', async () => {
  const tagged = await h.createLead({ name: 'Tagged Person', tags: ['Hot-Lead', 'spanish'] });
  await h.createLead({ name: 'Plain Person', tags: ['cold'] });
  const other = await h.createLead({ name: 'Other File', campaign_id: file2.id, tags: ['HOT-lead'] });
  const list = await rep.api.get('/api/leads?search=hot');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.leads.map((l) => l.id), [tagged.id]);
  const all = await rep.api.get('/api/leads?search=t-le', { campaign: 'ALL' });
  assert.deepEqual(all.body.leads.map((l) => l.id).sort(), [tagged.id, other.id].sort());
  const global = await rep.api.get('/api/leads/search?q=SPAN');
  assert.deepEqual(global.body.leads.map((l) => l.id), [tagged.id]);
  // Names, phones and companies still match as before.
  assert.equal((await rep.api.get('/api/leads?search=plain')).body.leads.length, 1);
});

test('the three task views around midnight (reporting timezone UTC)', async () => {
  const lead = await h.createLead({ name: 'Task Lead' });
  const midnight = Date.UTC(2030, 0, 2); // 2030-01-02 00:00 UTC
  const at = (ms) => new Date(midnight + ms);
  const min = 60 * 1000;
  const mk = async (title, due) => (await tasks.create({ leadId: lead.id, title, dueAt: due.toISOString() })).id;
  const a = await mk('A before 23:58', at(-2 * min));
  const b = await mk('B at 23:59:30', at(-30 * 1000));
  const c = await mk('C at 00:00:30', at(30 * 1000));
  const d = await mk('D on Jan 3', at(34 * 60 * min));
  const e = await mk('E on Jan 6', at(4 * 24 * 60 * min));
  const ids = (r) => r.items.map((t) => t.id);

  // 23:59 on Jan 1.
  let now = at(-min);
  assert.deepEqual(ids(await taskViews.list({ view: 'overdue', campaignId: 1, now })), [a]);
  assert.deepEqual(ids(await taskViews.list({ view: 'today', campaignId: 1, now })), [a, b]);
  let up = await taskViews.list({ view: 'upcoming', campaignId: 1, now });
  assert.deepEqual(ids(up), [c, d, e]);
  // Grouped by local date.
  assert.deepEqual(up.groups.map((g) => [g.date, g.items.map((t) => t.id)]), [['2030-01-02', [c]], ['2030-01-03', [d]], ['2030-01-06', [e]]]);

  // 00:01 on Jan 2: yesterday's are only overdue now; C is today's.
  now = at(min);
  assert.deepEqual(ids(await taskViews.list({ view: 'overdue', campaignId: 1, now })), [a, b, c]);
  assert.deepEqual(ids(await taskViews.list({ view: 'today', campaignId: 1, now })), [c]);
  up = await taskViews.list({ view: 'upcoming', campaignId: 1, now });
  assert.deepEqual(ids(up), [d, e]);
  // from/to narrow the upcoming view (local dates).
  assert.deepEqual(ids(await taskViews.list({ view: 'upcoming', campaignId: 1, now, from: '2030-01-04' })), [e]);
  assert.deepEqual(ids(await taskViews.list({ view: 'upcoming', campaignId: 1, now, to: '2030-01-03' })), [d]);
  // Per file, and ALL.
  assert.deepEqual(ids(await taskViews.list({ view: 'today', campaignId: file2.id, now })), []);
  assert.deepEqual(ids(await taskViews.list({ view: 'today', campaignId: 'ALL', now })), [c]);
  // A done task leaves every view.
  await tasks.complete(c);
  assert.deepEqual(ids(await taskViews.list({ view: 'overdue', campaignId: 1, now })), [a, b]);

  // The route.
  const r = await rep.api.get('/api/tasks?view=upcoming');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.groups));
  assert.equal((await rep.api.get('/api/tasks?view=later')).status, 400);
  assert.equal((await rep.api.get('/api/tasks?view=upcoming&from=tomorrow')).status, 400);
  await h.db.query('DELETE FROM tasks');
});

test('reminders: due within 15 minutes or already due, once a day per item, again after a reschedule', async () => {
  const lead = await h.createLead({ name: 'Remind Me' });
  const now = new Date();
  const soon = await tasks.create({ leadId: lead.id, title: 'Soon', dueAt: new Date(now.getTime() + 10 * 60000).toISOString() });
  const due = await tasks.create({ leadId: lead.id, title: 'Due', dueAt: new Date(now.getTime() - 60000).toISOString() });
  await tasks.create({ leadId: lead.id, title: 'Later', dueAt: new Date(now.getTime() + 3 * 3600000).toISOString() });
  const cb = await h.createLead({ name: 'Callback Lead', status: 'callback_scheduled', next_action_at: new Date(now.getTime() + 5 * 60000) });

  const res = await rep.api.get('/api/tasks/due-soon');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const keys = res.body.items.map((i) => `${i.kind}:${i.id}`);
  assert.deepEqual(keys.sort(), [`task:${soon.id}`, `task:${due.id}`, `callback:${cb.id}`].sort());
  // A task id and a lead id can be the same number: always match on kind too.
  const find = (items, kind, id) => items.find((i) => i.kind === kind && i.id === id);
  assert.equal(find(res.body.items, 'task', due.id).due, true);
  assert.equal(find(res.body.items, 'task', soon.id).due, false);

  const item = find(res.body.items, 'task', soon.id);
  assert.equal((await rep.api.post('/api/tasks/due-soon/ack', { kind: 'task', id: soon.id, dueAt: item.due_at })).status, 200);
  let again = (await rep.api.get('/api/tasks/due-soon')).body.items.map((i) => `${i.kind}:${i.id}`);
  assert.ok(!again.includes(`task:${soon.id}`), 'reminded today: not repeated');
  assert.ok(again.includes(`callback:${cb.id}`), 'the callback with the same number is still due');
  // Another user still gets it.
  const other = await h.createUser({ role: 'rep' });
  assert.ok((await other.api.get('/api/tasks/due-soon')).body.items.some((i) => i.id === soon.id && i.kind === 'task'));
  // Rescheduled: a new due time reminds again.
  await tasks.update(soon.id, { dueAt: new Date(now.getTime() + 12 * 60000).toISOString() });
  again = (await rep.api.get('/api/tasks/due-soon')).body.items.map((i) => `${i.kind}:${i.id}`);
  assert.ok(again.includes(`task:${soon.id}`));
  assert.equal((await rep.api.post('/api/tasks/due-soon/ack', { kind: 'meeting', id: 1, dueAt: now.toISOString() })).status, 400);
  await h.db.query('DELETE FROM tasks');
});

test('CSV export: the same rows as the list for the same filter, current file or ALL, and from a saved view', async () => {
  for (let i = 0; i < 7; i += 1) await h.createLead({ name: `Export Lead ${i}`, state: i % 2 ? 'CA' : 'TX', tags: i < 3 ? ['vip'] : [] });
  await h.createLead({ name: 'Export Other File', campaign_id: file2.id, tags: ['vip'] });
  const csvIds = async (path, campaign) => {
    const res = await h.request(rep.api.token, 'GET', path, undefined, { campaign });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = parse(res.body.raw.replace(/^﻿/, ''), { columns: true });
    return rows.map((r) => Number(r.id)).sort((x, y) => x - y);
  };
  const listIds = async (query, campaign) =>
    (await rep.api.get(`/api/leads?${query}&limit=200`, { campaign })).body.leads.map((l) => l.id).sort((x, y) => x - y);

  for (const [query, campaign] of [['tag=vip', 1], ['tag=vip', 'ALL'], ['search=export', 1], ['state=CA&search=export', 1], ['', 'ALL']]) {
    assert.deepEqual(await csvIds(`/api/leads/export.csv?${query}`, campaign), await listIds(query, campaign), `${query} in ${campaign}`);
  }
  // A saved view.
  const view = await rep.api.post('/api/views', { name: 'VIPs', filters: { tag: 'vip' } });
  assert.equal(view.status, 201, JSON.stringify(view.body));
  assert.deepEqual(await csvIds(`/api/leads/export.csv?viewId=${view.body.view.id}`, 1), await listIds('tag=vip', 1));
  assert.equal((await h.request(rep.api.token, 'GET', '/api/leads/export.csv?stageId=abc', undefined, { campaign: 1 })).status, 400);
});

test('CSV export: cells starting with = + - @ are prefixed with an apostrophe', async () => {
  const evil = await h.createLead({ name: '=HYPERLINK("http://x","click")', brokerage: '@SUM(1+1)', address: '-2+3', tags: ['+cmd'] });
  const res = await h.request(rep.api.token, 'GET', '/api/leads/export.csv?search=HYPERLINK', undefined, { campaign: 1 });
  const rows = parse(res.body.raw.replace(/^﻿/, ''), { columns: true });
  const row = rows.find((r) => Number(r.id) === evil.id);
  assert.equal(row.name, `'=HYPERLINK("http://x","click")`);
  assert.equal(row.company, "'@SUM(1+1)");
  assert.equal(row.address, "'-2+3");
  assert.equal(row.tags, "'+cmd");
  assert.equal(row.phone, `'${evil.phone}`, 'a +1… phone is guarded too');
});
