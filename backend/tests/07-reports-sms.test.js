// Reports: the totals equal the call rows, and a failed dial isn't counted.
// SMS: an inbound STOP opts the lead out and suppresses the number; START
// reverses it.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
});

test('report totals equal the call rows; a failed dial is not counted', async () => {
  const plan = ['contacted', 'contacted', 'voicemail', 'no_answer', 'dnc'];
  for (const disposition of plan) {
    const lead = await h.createLead();
    const call = await h.dial(rep.api, lead.id);
    assert.equal(call.status, 201);
    const res = await rep.api.post('/api/dispositions', { callId: call.body.call.id, disposition });
    assert.equal(res.status, 200);
  }
  // A dial the provider refused: kept as a 'failed' row, not a placed call.
  const lead = await h.createLead();
  await h.db.query(
    "INSERT INTO call_history (lead_id, user_id, from_number, was_mock, telephony_state) VALUES ($1, $2, '+15550000000', true, 'failed')",
    [lead.id, rep.user.id]
  );

  const stats = await rep.api.get('/api/reports/today');
  assert.equal(stats.status, 200);
  const { rows } = await h.db.query(
    `SELECT count(*) FILTER (WHERE telephony_state IS DISTINCT FROM 'failed')::int AS placed,
            count(*) FILTER (WHERE disposition = 'contacted')::int AS contacts,
            count(*)::int AS all_rows
     FROM call_history`
  );
  assert.equal(rows[0].all_rows, plan.length + 1);
  assert.equal(stats.body.dials, rows[0].placed);
  assert.equal(stats.body.dials, plan.length);
  assert.equal(stats.body.contacts, rows[0].contacts);
  assert.equal(stats.body.voicemails, 1);
  assert.equal(stats.body.noAnswers, 1);
  assert.equal(stats.body.dnc, 1);
});

async function inbound(from, body, id) {
  return h.request(null, 'POST', '/api/sms/inbound', { from, to: '+15550001111', body, providerMessageId: id }, {
    headers: { 'x-webhook-secret': process.env.SMS_WEBHOOK_SECRET },
  });
}

test('inbound STOP opts the lead out and suppresses the number', async () => {
  const lead = await h.createLead();
  const res = await inbound(lead.phone, 'STOP', 'verify-stop-1');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await h.getLead(lead.id)).sms_opt_out, true);
  const { rows } = await h.db.query('SELECT 1 FROM sms_suppressions WHERE phone = $1', [lead.phone]);
  assert.equal(rows.length, 1);
});

test('inbound START reverses it', async () => {
  const lead = await h.createLead();
  await inbound(lead.phone, 'STOP', 'verify-stop-2');
  const res = await inbound(lead.phone, 'START', 'verify-start-2');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await h.getLead(lead.id)).sms_opt_out, false);
  const { rows } = await h.db.query('SELECT 1 FROM sms_suppressions WHERE phone = $1', [lead.phone]);
  assert.equal(rows.length, 0);
});

test('the inbound webhook refuses a request without the secret (401)', async () => {
  const lead = await h.createLead();
  const res = await h.request(null, 'POST', '/api/sms/inbound', { from: lead.phone, body: 'STOP', providerMessageId: 'x' });
  assert.equal(res.status, 401);
  assert.equal((await h.getLead(lead.id)).sms_opt_out, false);
});
