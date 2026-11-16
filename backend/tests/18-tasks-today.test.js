// C3A: tasks and the Today lists (docs/CRM_PLAN.md).
// Due (before the end of the reporting day) and overdue (before now) with a
// controlled clock; the four Today lists and their totals; a task made with
// a disposition; Undo of that disposition keeps the task and says so.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tasks = require('../src/services/tasks');

let rep;
let stages;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  stages = Object.fromEntries((await rep.api.get('/api/pipeline/stages')).body.stages.map((s) => [s.name, s]));
});

after(() => h.resetClock());

const iso = (d) => new Date(d).toISOString();

test('task CRUD: create on a lead, update, complete, reopen, delete; bad input is a 400', async () => {
  const lead = await h.createLead();
  const due = iso(Date.now() + 3600e3);
  const made = await rep.api.post('/api/tasks', { leadId: lead.id, title: 'Send the deck', type: 'email', dueAt: due });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const t = made.body.task;
  assert.equal(t.campaign_id, 1);
  assert.equal(t.source, 'manual');
  assert.equal(t.user_id, rep.user.id);
  assert.equal((await rep.api.put(`/api/tasks/${t.id}`, { title: 'Send the new deck' })).body.task.title, 'Send the new deck');
  assert.ok((await rep.api.post(`/api/tasks/${t.id}/complete`, {})).body.task.done_at);
  assert.equal((await rep.api.post(`/api/tasks/${t.id}/reopen`, {})).body.task.done_at, null);
  const listed = await rep.api.get(`/api/tasks?leadId=${lead.id}`);
  assert.deepEqual(listed.body.tasks.map((x) => x.id), [t.id]);
  assert.equal((await rep.api.del(`/api/tasks/${t.id}`)).status, 200);
  assert.equal((await rep.api.get(`/api/tasks/${t.id}`)).status, 404);

  assert.equal((await rep.api.post('/api/tasks', { leadId: lead.id, title: '', dueAt: due })).status, 400);
  assert.equal((await rep.api.post('/api/tasks', { leadId: lead.id, title: 'x', dueAt: 'soon' })).status, 400);
  assert.equal((await rep.api.post('/api/tasks', { leadId: lead.id, title: 'x', type: 'fax', dueAt: due })).status, 400);
  const general = await rep.api.post('/api/tasks', { title: 'Plan the week', dueAt: due });
  assert.equal(general.status, 201);
  assert.equal(general.body.task.lead_id, null);
  assert.equal((await rep.api.post('/api/tasks', { title: 'No file', dueAt: due }, { campaign: 'ALL' })).status, 400);
});

test('due and overdue follow the clock (Node time, the reporting day)', async () => {
  await h.db.query('DELETE FROM tasks');
  const now = new Date();
  const end = await tasks.endOfToday(now);
  const lead = await h.createLead();
  const mk = (title, at) => rep.api.post('/api/tasks', { leadId: lead.id, title, dueAt: iso(at) });
  const laterToday = new Date((now.getTime() + end.getTime()) / 2);
  await mk('Overdue', now.getTime() - 3600e3);
  await mk('Later today', laterToday);
  await mk('Tomorrow', end.getTime() + 3600e3);

  const due = (await rep.api.get('/api/tasks')).body;
  assert.equal(due.total, 2);
  assert.deepEqual(due.items.map((t) => [t.title, t.overdue]), [['Overdue', true], ['Later today', false]]);

  try {
    // Move the clock past "later today" (still before the end of the day): both overdue.
    h.setNowOffset(laterToday.getTime() - now.getTime() + 60e3);
    const later = (await rep.api.get('/api/tasks')).body;
    assert.equal(later.overdue, 2);
  } finally {
    h.resetClock();
  }
  // Into tomorrow (past the login token's life, so through the service with an explicit now):
  // the "tomorrow" task is due, all three listed and overdue.
  const tomorrow = await tasks.listDue({ campaignId: 1, now: new Date(end.getTime() + 2 * 3600e3) });
  assert.equal(tomorrow.total, 3);
  assert.equal(tomorrow.overdue, 3);
});

test('Today: callbacks, tasks, unread texts and stale leads, each with its total, per file or ALL', async () => {
  await h.db.query('DELETE FROM tasks');
  const now = Date.now();
  const cbOverdue = await h.createLead({ status: 'callback_scheduled', next_action_at: new Date(now - 600e3) });
  await h.createLead({ status: 'callback_scheduled', next_action_at: new Date(now + 30 * 24 * 3600e3) });
  const texted = await h.createLead();
  await h.db.query("INSERT INTO sms_messages (lead_id, direction, body, is_read) VALUES ($1, 'inbound', 'hi', false), ($1, 'inbound', 'there', false)", [texted.id]);
  const staleLead = await h.createLead({ pipeline_stage_id: stages.Interested.id });
  const staleWithTask = await h.createLead({ pipeline_stage_id: stages.Interested.id });
  const freshInterested = await h.createLead({ pipeline_stage_id: stages.Interested.id });
  const notPastAuto = await h.createLead({ pipeline_stage_id: stages.Contacted.id });
  await h.db.query("UPDATE leads SET updated_at = now() - interval '10 days' WHERE id = ANY($1)", [[staleLead.id, staleWithTask.id, notPastAuto.id]]);
  await rep.api.post('/api/tasks', { leadId: staleWithTask.id, title: 'Chase', dueAt: iso(now + 5 * 24 * 3600e3) });
  await rep.api.post('/api/tasks', { leadId: texted.id, title: 'Reply', dueAt: iso(now - 60e3) });

  const res = await rep.api.get('/api/today');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const t = res.body;
  assert.deepEqual(t.callbacks.items.map((c) => [c.id, c.overdue]), [[cbOverdue.id, true]]);
  assert.equal(t.callbacks.total, 1);
  assert.equal(t.tasks.total, 1);
  assert.equal(t.tasks.items[0].title, 'Reply');
  assert.equal(t.unreadTexts.total, 1);
  assert.equal(t.unreadTexts.items[0].unread, 2);
  assert.deepEqual(t.stale.items.map((s) => s.id), [staleLead.id]);
  assert.ok(!t.stale.items.some((s) => [freshInterested.id, notPastAuto.id, staleWithTask.id].includes(s.id)));

  const file2 = await h.createCampaign({ name: 'Today Two' });
  await h.createLead({ campaign_id: file2.id, status: 'callback_scheduled', next_action_at: new Date(now - 60e3) });
  const t2 = (await rep.api.get('/api/today', { campaign: file2.id })).body;
  assert.equal(t2.callbacks.total, 1);
  assert.equal(t2.tasks.total, 0);
  const all = (await rep.api.get('/api/today', { campaign: 'ALL' })).body;
  assert.equal(all.callbacks.total, 2);
});

test('the Today lists are capped at 50 and keep the full total', async () => {
  const now = Date.now();
  const lead = await h.createLead();
  await h.db.query(
    `INSERT INTO tasks (campaign_id, lead_id, title, due_at) SELECT 1, $1, 'Bulk ' || g, $2 FROM generate_series(1, 60) g`,
    [lead.id, new Date(now - 3600e3)]
  );
  const t = (await rep.api.get('/api/today')).body;
  assert.equal(t.tasks.items.length, 50);
  assert.ok(t.tasks.total >= 60);
});

test('a task made with a disposition; Undo keeps it and says so; it shows in the timeline', async () => {
  const lead = await h.createLead();
  const call = await h.dial(rep.api, lead.id);
  assert.equal(call.status, 201);
  const due = iso(Date.now() + 2 * 24 * 3600e3);
  const bad = await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'contacted', task: { title: '', due_at: due } });
  assert.equal(bad.status, 400);
  assert.equal((await h.getLead(lead.id)).status, 'in_progress', 'a bad task stops the outcome before it is saved');

  const res = await rep.api.post('/api/dispositions', {
    callId: call.body.call.id,
    disposition: 'contacted',
    task: { title: 'Send pricing', due_at: due, type: 'email' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.task.source, 'disposition');
  assert.equal(res.body.task.lead_id, lead.id);
  assert.equal(res.body.task.type, 'email');

  const undo = await rep.api.post(`/api/dispositions/${call.body.call.id}/undo`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.deepEqual(undo.body.keptTasks.map((k) => k.title), ['Send pricing']);
  assert.match(undo.body.message, /stays/);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM tasks WHERE lead_id = $1', [lead.id])).rows[0].n, 1);

  const tl = (await rep.api.get(`/api/leads/${lead.id}/timeline`)).body.timeline;
  const task = tl.find((e) => e.type === 'task');
  assert.equal(task.title, 'Send pricing');
  assert.equal(task.task_type, 'email');
  await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'voicemail' });
});
