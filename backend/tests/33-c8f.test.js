// C8F: the manual dial pad. Touch tones (validation, 501 without provider
// support), the RECORD switch (stored), live notes (saved, max 5,000, the
// 24-hour limit), the recent list, the lead match and the one-time note copy,
// and the rules that don't change: a manual call never changes a lead's
// status or attempts, and a DNC number is still refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const mockAdapter = require('../src/telephony/mockAdapter');

let rep;
let other;

before(async () => {
  await h.setupFile(); // calls answered, calling hours off
  rep = await h.createUser({ role: 'rep' });
  other = await h.createUser({ role: 'rep' });
});
after(() => h.setOutcome(null));

async function startManual(api, toNumber) {
  const res = await api.post('/api/calls/manual/start', { toNumber });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.call;
}
const hangup = (api, id) => api.post(`/api/calls/${id}/hangup`, {});

test('digits: [0-9*#] 1 to 32 are sent while live; anything else is 400; another rep gets 403; ended is 409', async () => {
  const call = await startManual(rep.api, h.nextPhone());
  assert.deepEqual((await rep.api.post(`/api/calls/${call.id}/digits`, { digits: '12*#' })).body, { sent: '12*#' });
  for (const bad of ['', '12a', '1'.repeat(33), 5]) {
    assert.equal((await rep.api.post(`/api/calls/${call.id}/digits`, { digits: bad })).status, 400, String(bad));
  }
  assert.equal((await other.api.post(`/api/calls/${call.id}/digits`, { digits: '1' })).status, 403);
  await hangup(rep.api, call.id);
  assert.equal((await rep.api.post(`/api/calls/${call.id}/digits`, { digits: '1' })).status, 409);
});

test('without provider support, digits and recording answer 501 "Not available with this provider yet"', async () => {
  const call = await startManual(rep.api, h.nextPhone());
  const { sendDigits, setRecording } = mockAdapter;
  delete mockAdapter.sendDigits;
  delete mockAdapter.setRecording;
  try {
    const d = await rep.api.post(`/api/calls/${call.id}/digits`, { digits: '1' });
    assert.equal(d.status, 501);
    assert.equal(d.body.error, 'Not available with this provider yet');
    assert.equal((await rep.api.post(`/api/calls/${call.id}/recording`, { on: true })).status, 501);
  } finally {
    Object.assign(mockAdapter, { sendDigits, setRecording });
    await hangup(rep.api, call.id);
  }
});

test('the recording switch is stored on the call (live only; `on` must be a boolean)', async () => {
  const call = await startManual(rep.api, h.nextPhone());
  assert.equal((await rep.api.post(`/api/calls/${call.id}/recording`, { on: 'yes' })).status, 400);
  assert.equal((await rep.api.post(`/api/calls/${call.id}/recording`, { on: true })).body.recording, true);
  assert.equal((await h.db.query('SELECT recording FROM call_history WHERE id = $1', [call.id])).rows[0].recording, true);
  await rep.api.post(`/api/calls/${call.id}/recording`, { on: false });
  assert.equal((await h.db.query('SELECT recording FROM call_history WHERE id = $1', [call.id])).rows[0].recording, false);
  await hangup(rep.api, call.id);
  assert.equal((await rep.api.post(`/api/calls/${call.id}/recording`, { on: true })).status, 409);
});

test('notes save during and after the call, up to 5,000 characters, until 24 hours after it ended', async () => {
  const call = await startManual(rep.api, h.nextPhone());
  assert.equal((await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'Gatekeeper, call back Friday' })).status, 200);
  assert.equal((await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'x'.repeat(5001) })).status, 400);
  await hangup(rep.api, call.id);
  assert.equal((await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'Edited after' })).status, 200);
  assert.equal((await h.db.query('SELECT notes FROM call_history WHERE id = $1', [call.id])).rows[0].notes, 'Edited after');
  await h.db.query("UPDATE call_history SET ended_at = now() - interval '25 hours' WHERE id = $1", [call.id]);
  assert.equal((await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'Too late' })).status, 409);
});

test('the recent list: the last 10 manual calls, newest first, with the matched lead', async () => {
  const lead = await h.createLead({ name: 'Recent Match' });
  for (let i = 0; i < 11; i += 1) await hangup(rep.api, (await startManual(rep.api, h.nextPhone())).id);
  const last = await startManual(rep.api, lead.phone);
  await hangup(rep.api, last.id);
  const { calls } = (await rep.api.get('/api/calls/manual/recent')).body;
  assert.equal(calls.length, 10);
  assert.equal(calls[0].id, last.id);
  assert.equal(calls[0].number, lead.phone);
  assert.deepEqual(calls[0].lead, { id: lead.id, name: 'Recent Match' });
  assert.ok(calls.every((c) => 'durationSeconds' in c && c.startedAt));
  assert.ok(!(await other.api.get('/api/calls/manual/recent')).body.calls.some((c) => c.id === last.id), 'only your own calls');
});

test('lead match: the call shows the lead; its notes are added once as "Manual call · m:ss · notes"; status and attempts never change', async () => {
  const lead = await h.createLead({ name: 'Matched Lead', status: 'in_queue', attempts: 2 });
  const call = await startManual(rep.api, lead.phone);
  assert.equal((await rep.api.get(`/api/calls/${call.id}/lead`)).body.lead.id, lead.id);
  await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'Wants pricing by email' });
  await h.db.query("UPDATE call_history SET started_at = now() - interval '75 seconds' WHERE id = $1", [call.id]);
  await hangup(rep.api, call.id);

  const notes = async () => (await h.db.query('SELECT body FROM lead_notes WHERE lead_id = $1', [lead.id])).rows.map((r) => r.body);
  assert.deepEqual(await notes(), ['Manual call · 1:15 · Wants pricing by email']);
  // Editing the notes later keeps one note, now with the new text.
  await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'Wants pricing by email, Tuesday' });
  await hangup(rep.api, call.id); // a second end changes nothing
  assert.deepEqual(await notes(), ['Manual call · 1:15 · Wants pricing by email, Tuesday']);

  const afterCall = await h.getLead(lead.id);
  assert.equal(afterCall.status, 'in_queue');
  assert.equal(afterCall.attempts, 2);
  assert.equal(afterCall.notes_count, 1);
});

test('no lead: nothing is copied; saving the number as a lead afterwards gets the notes once', async () => {
  const phone = h.nextPhone();
  const call = await startManual(rep.api, phone);
  assert.equal((await rep.api.get(`/api/calls/${call.id}/lead`)).body.lead, null);
  await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'New prospect' });
  await hangup(rep.api, call.id);
  const created = await rep.api.post('/api/leads', { name: 'Saved From Pad', phone, state: 'TX' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const res = await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'New prospect' });
  assert.equal(res.body.copiedTo, created.body.lead.id);
  await rep.api.put(`/api/calls/${call.id}/notes`, { notes: 'New prospect' });
  const { rows } = await h.db.query('SELECT body FROM lead_notes WHERE lead_id = $1', [created.body.lead.id]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /^Manual call · \d+:\d\d · New prospect$/);
});

test('a DNC number is still refused on the dial pad', async () => {
  const phone = h.nextPhone();
  await h.db.query("INSERT INTO dnc_list (phone, source) VALUES ($1, 'manual') ON CONFLICT DO NOTHING", [phone]);
  assert.equal((await rep.api.post('/api/calls/manual/start', { toNumber: phone })).status, 409);
});
