// Dispositions: each one sets the documented status, attempts and next
// action; max attempts makes the lead cold; Undo works inside its window and
// is refused after it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
});
after(() => h.resetClock());

/** Dials a fresh lead and logs a disposition on it. */
async function dialAndDispose(disposition, { leadFields = {}, extra = {} } = {}) {
  const lead = await h.createLead(leadFields);
  const call = await h.dial(rep.api, lead.id);
  assert.equal(call.status, 201, `dial: ${JSON.stringify(call.body)}`);
  const res = await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition, ...extra });
  assert.equal(res.status, 200, `${disposition}: ${JSON.stringify(res.body)}`);
  return { lead: await h.getLead(lead.id), callId: call.body.call.id };
}

const nearly = (date, targetMs, toleranceMs = 120000) => Math.abs(new Date(date).getTime() - targetMs) < toleranceMs;

test('contacted: status contacted, attempts 1, no next action', async () => {
  const { lead } = await dialAndDispose('contacted');
  assert.equal(lead.status, 'contacted');
  assert.equal(lead.attempts, 1);
  assert.equal(lead.next_action_at, null);
  assert.equal(lead.locked_by, null);
});

for (const disposition of ['voicemail', 'no_answer']) {
  test(`${disposition}: requeued 4 hours out, attempts 1`, async () => {
    const { lead } = await dialAndDispose(disposition);
    assert.equal(lead.status, disposition);
    assert.equal(lead.attempts, 1);
    assert.ok(nearly(lead.next_action_at, Date.now() + 4 * 3600 * 1000), `next_action_at ${lead.next_action_at}`);
  });
}

test('no_contact_number: that number is marked bad, no next action', async () => {
  const { lead } = await dialAndDispose('no_contact_number');
  assert.equal(lead.status, 'no_contact_number');
  assert.equal(lead.next_action_at, null);
});

test('no_contact_person: cold with reason no_contact_person', async () => {
  const { lead } = await dialAndDispose('no_contact_person');
  assert.equal(lead.status, 'cold');
  assert.equal(lead.cold_reason, 'no_contact_person');
  assert.ok(lead.cold_at);
});

test('dnc: status dnc, flag set, number on the DNC list', async () => {
  const { lead } = await dialAndDispose('dnc');
  assert.equal(lead.status, 'dnc');
  assert.equal(lead.dnc_flag, true);
  const { rows } = await h.db.query('SELECT 1 FROM dnc_list WHERE phone = $1', [lead.phone]);
  assert.equal(rows.length, 1);
});

test('callback_scheduled: next action is the chosen time', async () => {
  const at = new Date(Date.now() + 2 * 3600 * 1000);
  const { lead } = await dialAndDispose('callback_scheduled', { extra: { scheduledAt: at.toISOString() } });
  assert.equal(lead.status, 'callback_scheduled');
  assert.ok(nearly(lead.next_action_at, at.getTime(), 2000));
});

test('max attempts: a voicemail on the last attempt makes the lead cold', async () => {
  const { lead } = await dialAndDispose('voicemail', { leadFields: { max_attempts: 1 } });
  assert.equal(lead.status, 'cold');
  assert.equal(lead.cold_reason, 'max_attempts');
  assert.equal(lead.next_action_at, null);
});

test('Undo inside the window restores the snapshot (voicemail)', async () => {
  const { lead: before, callId } = await dialAndDispose('voicemail');
  assert.ok(before.next_action_at);
  const res = await rep.api.post(`/api/dispositions/${callId}/undo`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const lead = await h.getLead(before.id);
  assert.equal(lead.status, 'in_progress');
  assert.equal(lead.locked_by, rep.user.id);
  assert.equal(lead.next_action_at, null);
  assert.equal(lead.attempts, 1);
});

test('Undo inside the window restores a DNC (flag cleared, list row removed)', async () => {
  const { lead: before, callId } = await dialAndDispose('dnc');
  const res = await rep.api.post(`/api/dispositions/${callId}/undo`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const lead = await h.getLead(before.id);
  assert.equal(lead.status, 'in_progress');
  assert.equal(lead.dnc_flag, false);
  const { rows } = await h.db.query('SELECT 1 FROM dnc_list WHERE phone = $1', [lead.phone]);
  assert.equal(rows.length, 0);
});

test('Undo after the window is refused (410) and changes nothing', async () => {
  const { lead: before, callId } = await dialAndDispose('no_answer');
  h.setNowOffset(60 * 1000); // controlled clock: one minute later (window is 10 s)
  try {
    const res = await rep.api.post(`/api/dispositions/${callId}/undo`);
    assert.equal(res.status, 410);
  } finally {
    h.resetClock();
  }
  const lead = await h.getLead(before.id);
  assert.equal(lead.status, 'no_answer');
});
