// Invariants I1 to I8 (audit/scripts/invariants.sql) hold after a mixed run
// of calls: every disposition, an Undo, a hang-up, a dial-pad call and a
// stale lock that the sweep releases.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const leadQueue = require('../src/services/leadQueue');

let reps;

before(async () => {
  await h.setupFile();
  reps = [await h.createUser({ role: 'rep' }), await h.createUser({ role: 'rep' })];

  const steps = ['contacted', 'voicemail', 'no_answer', 'no_contact_number', 'no_contact_person', 'dnc', 'callback_scheduled', 'voicemail'];
  for (const [i, disposition] of steps.entries()) {
    const api = reps[i % 2].api;
    const lead = await h.createLead({ max_attempts: i === steps.length - 1 ? 1 : 5 });
    const call = await h.dial(api, lead.id);
    assert.equal(call.status, 201);
    const extra = disposition === 'callback_scheduled' ? { scheduledAt: new Date(Date.now() + 3600e3).toISOString() } : {};
    const res = await api.post('/api/dispositions', { callId: call.body.call.id, disposition, ...extra });
    assert.equal(res.status, 200);
  }
  // Undo one disposition, then log another.
  const undoLead = await h.createLead();
  const undoCall = await h.dial(reps[0].api, undoLead.id);
  await reps[0].api.post('/api/dispositions', { callId: undoCall.body.call.id, disposition: 'no_answer' });
  assert.equal((await reps[0].api.post(`/api/dispositions/${undoCall.body.call.id}/undo`)).status, 200);
  await reps[0].api.post('/api/dispositions', { callId: undoCall.body.call.id, disposition: 'contacted' });
  // Hang up without a disposition.
  const hangLead = await h.createLead();
  const hangCall = await h.dial(reps[1].api, hangLead.id);
  assert.equal((await reps[1].api.post(`/api/calls/${hangCall.body.call.id}/hangup`)).status, 200);
  // A dial-pad call.
  assert.equal((await reps[1].api.post('/api/calls/manual/start', { toNumber: h.nextPhone() })).status, 201);
  // A lock left behind long ago, then the sweep.
  const stale = await h.createLead();
  await h.db.query("UPDATE leads SET status = 'in_progress', locked_by = $2, locked_at = now() - interval '5 minutes' WHERE id = $1", [stale.id, reps[0].user.id]);
  await leadQueue.releaseStaleLocks();
});

async function count(sql) {
  return (await h.db.query(sql)).rows[0].n;
}

test('I1: every lead has a status from the allowed list', async () => {
  assert.equal(
    await count(`SELECT count(*)::int AS n FROM leads WHERE status IS NULL OR status NOT IN
      ('new','in_queue','in_progress','contacted','voicemail','no_answer','callback_scheduled','no_contact_number','no_contact_person','dnc','cold')`),
    0
  );
});

test('I2 and I3: no in_progress lead has a lock older than 30 s', async () => {
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE status = 'in_progress' AND locked_at < now() - interval '30 seconds'"), 0);
});

test('I4: no orphan call rows', async () => {
  assert.equal(await count('SELECT count(*)::int AS n FROM call_history c WHERE c.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = c.lead_id)'), 0);
});

test('I5: no call left open without a disposition for over 5 minutes', async () => {
  assert.equal(await count("SELECT count(*)::int AS n FROM call_history WHERE disposition IS NULL AND ended_at IS NULL AND started_at < now() - interval '5 minutes'"), 0);
});

test('I6: no lead has more than one open call', async () => {
  assert.equal(await count('SELECT count(*)::int AS n FROM (SELECT lead_id FROM call_history WHERE lead_id IS NOT NULL AND disposition IS NULL GROUP BY lead_id HAVING count(*) > 1) x'), 0);
});

test('I7: attempts never exceed max_attempts', async () => {
  assert.equal(await count('SELECT count(*)::int AS n FROM leads WHERE attempts > max_attempts'), 0);
});

test('I8: DNC flag, status and DNC list agree; phones are E.164', async () => {
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE dnc_flag AND status <> 'dnc'"), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE status = 'dnc' AND NOT dnc_flag"), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM leads l WHERE NOT l.dnc_flag AND EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone)'), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE phone IS NOT NULL AND phone !~ '^\\+1[2-9][0-9]{9}$'"), 0);
});

test('the mixed run did what it says (sanity)', async () => {
  assert.ok((await count('SELECT count(*)::int AS n FROM call_history')) >= 11);
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE status = 'cold' AND cold_reason = 'max_attempts'"), 1);
});
