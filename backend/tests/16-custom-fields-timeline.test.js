// C2C: custom fields per campaign, the values on a lead, the import of a
// custom column, and the lead timeline (docs/CRM_PLAN.md).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let supervisor;
const fieldsUrl = (id = 1) => `/api/campaigns/${id}/fields`;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
  const add = async (body) => {
    const res = await supervisor.api.post(fieldsUrl(), body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.field;
  };
  await add({ label: 'Team size', type: 'number' });
  await add({ label: 'Roof Type', type: 'select', options: ['Asphalt', 'Metal'] });
  await add({ label: 'Inspected', type: 'boolean' });
  await add({ label: 'Renewal date', type: 'date' });
  await add({ label: 'Notes on office', key: 'office_notes', type: 'text', showInList: true });
});

test('definitions: keys from labels, guards, reps read only, reorder', async () => {
  const list = (await rep.api.get(fieldsUrl())).body.fields;
  assert.deepEqual(list.map((f) => f.key), ['team_size', 'roof_type', 'inspected', 'renewal_date', 'office_notes']);
  assert.equal(list[4].show_in_list, true);
  assert.equal((await rep.api.post(fieldsUrl(), { label: 'Nope' })).status, 403);
  assert.equal((await supervisor.api.post(fieldsUrl(), { label: 'Team size' })).status, 409);
  assert.equal((await supervisor.api.post(fieldsUrl(), { label: 'Pick', type: 'select', options: [] })).status, 400);
  assert.equal((await supervisor.api.post(fieldsUrl(), { label: 'Bad', key: '9bad' })).status, 400);
  assert.equal((await supervisor.api.post(fieldsUrl(), { label: 'Odd', type: 'color' })).status, 400);
  assert.equal((await supervisor.api.put(`${fieldsUrl()}/${list[0].id}`, { type: 'text' })).status, 400);
  const renamed = await supervisor.api.put(`${fieldsUrl()}/${list[0].id}`, { label: 'Agents on team' });
  assert.equal(renamed.body.field.label, 'Agents on team');
  const ids = list.map((f) => f.id);
  const re = await supervisor.api.post(`${fieldsUrl()}/reorder`, { ids: [ids[1], ids[0], ...ids.slice(2)] });
  assert.equal(re.status, 200);
  assert.deepEqual(re.body.fields.map((f) => f.key).slice(0, 2), ['roof_type', 'team_size']);
  assert.equal((await rep.api.get(fieldsUrl(999))).status, 404);
});

test('values: each type is checked; a patch merges; null clears; a bad value changes nothing', async () => {
  const lead = await h.createLead();
  const put = (custom, extra = {}) => rep.api.put(`/api/leads/${lead.id}`, { custom, ...extra });
  const ok = await put({ team_size: '12', roof_type: 'Metal', inspected: true, renewal_date: '2026-11-16', office_notes: 'Corner office' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.lead.custom, { team_size: 12, roof_type: 'Metal', inspected: true, renewal_date: '2026-11-16', office_notes: 'Corner office' });

  for (const [bad, why] of [
    [{ team_size: 'twelve' }, /Agents on team/],
    [{ roof_type: 'Slate' }, /Asphalt, Metal/],
    [{ inspected: 'yes' }, /true or false/],
    [{ renewal_date: '2026-02-30' }, /date/],
    [{ office_notes: 'x'.repeat(1001) }, /1000/],
    [{ nope: 1 }, /no field "nope"/],
  ]) {
    const res = await put(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(res.body.error, why);
  }
  const merged = await put({ inspected: false, office_notes: null }, { deal_value_cents: 450000 });
  assert.equal(merged.status, 200);
  assert.deepEqual(merged.body.lead.custom, { team_size: 12, roof_type: 'Metal', inspected: false, renewal_date: '2026-11-16' });
  assert.equal(Number(merged.body.lead.deal_value_cents), 450000);
  assert.equal((await put({}, { deal_value_cents: -1 })).status, 400);

  const listed = await rep.api.get('/api/leads?limit=10000');
  assert.deepEqual(listed.body.leads.find((l) => l.id === lead.id).custom.roof_type, 'Metal');
});

test('deleting a field removes its values from the leads', async () => {
  const field = (await supervisor.api.post(fieldsUrl(), { label: 'Temp', type: 'text' })).body.field;
  const lead = await h.createLead();
  await rep.api.put(`/api/leads/${lead.id}`, { custom: { temp: 'gone soon', roof_type: 'Asphalt' } });
  assert.equal((await supervisor.api.del(`${fieldsUrl()}/${field.id}`)).status, 200);
  assert.deepEqual((await h.getLead(lead.id)).custom, { roof_type: 'Asphalt' });
});

async function importCsv(text, name) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), name);
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  await supervisor.api.post('/api/imports/process', { jobId: up.body.jobId, sheets: up.body.sheetNames, mapping: up.body.mapping });
  const status = await h.waitFor(async () => {
    const s = await supervisor.api.get(`/api/imports/status/${up.body.jobId}`);
    return ['completed', 'failed'].includes(s.body.status) ? s.body : null;
  });
  assert.equal(status.status, 'completed', JSON.stringify(status));
  return { up: up.body, summary: status.resultSummary };
}

const local = (e164) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;

test('import: a custom column lands in leads.custom; an unreadable cell is dropped; the accounting holds', async () => {
  const a = h.nextPhone();
  const b = h.nextPhone();
  const csv = [
    'Name,Phone,State,Roof Type,Team Size,Inspected',
    `Custom One,${local(a)},TX,metal,"1,200",yes`,
    `Custom Two,${local(b)},TX,Slate,many,`,
  ].join('\n');
  const { up, summary } = await importCsv(csv, 'custom.csv');
  assert.equal(up.mapping['custom.roof_type'], 'Roof Type');
  assert.equal(up.mapping['custom.team_size'], 'Team Size');
  assert.equal(up.mapping['custom.inspected'], 'Inspected');
  assert.ok(up.fields.includes('custom.renewal_date'));
  assert.equal(summary.imported, 2);
  assert.equal(summary.allRowsAccountedFor, true);
  const one = (await h.db.query('SELECT custom FROM leads WHERE phone = $1', [a])).rows[0].custom;
  const two = (await h.db.query('SELECT custom FROM leads WHERE phone = $1', [b])).rows[0].custom;
  assert.deepEqual(one, { roof_type: 'Metal', team_size: 1200, inspected: true });
  assert.deepEqual(two, {});
});

test('the timeline lists every event kind, newest first', async () => {
  const phone = h.nextPhone();
  await importCsv(`Name,Phone,State\nTimeline Person,${local(phone)},TX`, 'timeline.csv');
  const lead = (await h.db.query('SELECT * FROM leads WHERE phone = $1', [phone])).rows[0];
  const tick = () => new Promise((r) => setTimeout(r, 15));

  await tick();
  const call = await h.dial(rep.api, lead.id);
  assert.equal(call.status, 201);
  await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition: 'contacted' }); // call + stage change
  await tick();
  assert.equal((await rep.api.post(`/api/leads/${lead.id}/notes`, { body: 'Wants a demo' })).status, 201);
  await tick();
  await h.db.query("INSERT INTO sms_messages (lead_id, direction, body) VALUES ($1, 'outbound', 'Hi there')", [lead.id]);
  await tick();
  await h.db.query("INSERT INTO email_messages (lead_id, subject, body) VALUES ($1, 'Intro', 'Hello')", [lead.id]);
  await tick();
  assert.equal((await rep.api.post(`/api/sms/opt-out/${lead.id}`, {})).status, 200);

  const res = await rep.api.get(`/api/leads/${lead.id}/timeline`);
  assert.equal(res.status, 200);
  const items = res.body.timeline;
  // C6C: the note added through the API also shows as an activity row.
  assert.deepEqual([...new Set(items.map((i) => i.type))].sort(), ['activity', 'call', 'email', 'import', 'note', 'sms', 'sms_opt', 'stage']);
  for (let i = 1; i < items.length; i++) {
    assert.ok(new Date(items[i - 1].timestamp) >= new Date(items[i].timestamp), `out of order at ${i}`);
  }
  assert.equal(items[items.length - 1].type, 'import');
  const stage = items.find((i) => i.type === 'stage');
  assert.equal(stage.from_stage, 'New');
  assert.equal(stage.to_stage, 'Contacted');
  assert.equal(stage.source, 'disposition');
  assert.equal(stage.user_name, rep.user.name);
  for (const key of ['calls', 'messages', 'notes', 'emails']) assert.ok(Array.isArray(res.body[key]), key);
});
