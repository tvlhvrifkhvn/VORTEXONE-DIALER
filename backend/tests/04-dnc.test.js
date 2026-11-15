// DNC: a number on the DNC list can't be dialed by id, from the queue or from
// the dial pad; a DNC lead's number can't be changed; a lead edited to a DNC
// number can't be dialed. (The import side is in 05-import.)
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
});

async function putOnDncList(phone) {
  await h.db.query("INSERT INTO dnc_list (phone, source) VALUES ($1, 'manual') ON CONFLICT DO NOTHING", [phone]);
}

test('by id: a lead whose number is on the DNC list (flag not set) is refused', async () => {
  const lead = await h.createLead();
  await putOnDncList(lead.phone);
  const res = await h.dial(rep.api, lead.id);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /DNC/);
  const { rows } = await h.db.query('SELECT count(*)::int AS n FROM call_history WHERE lead_id = $1', [lead.id]);
  assert.equal(rows[0].n, 0);
});

test('by id: a lead marked DNC is refused', async () => {
  const lead = await h.createLead({ status: 'dnc', dnc_flag: true });
  const res = await h.dial(rep.api, lead.id);
  assert.equal(res.status, 409);
});

test('queue: a number on the DNC list is skipped and the lead marked DNC', async () => {
  await h.db.query("UPDATE leads SET status = 'cold' WHERE status IN ('new', 'in_queue')"); // only this lead is due
  const lead = await h.createLead();
  await putOnDncList(lead.phone);
  const res = await h.dial(rep.api);
  assert.equal(res.status, 404, JSON.stringify(res.body));
  const after = await h.getLead(lead.id);
  assert.equal(after.status, 'dnc');
  assert.equal(after.dnc_flag, true);
});

test('dial pad: a number on the DNC list is refused', async () => {
  const phone = h.nextPhone();
  await putOnDncList(phone);
  const res = await rep.api.post('/api/calls/manual/start', { toNumber: phone });
  assert.equal(res.status, 409);
  const { rows } = await h.db.query('SELECT count(*)::int AS n FROM call_history WHERE to_number = $1', [phone]);
  assert.equal(rows[0].n, 0);
});

test("a DNC lead's phone number can't be changed (409)", async () => {
  const lead = await h.createLead({ status: 'dnc', dnc_flag: true });
  const res = await rep.api.put(`/api/leads/${lead.id}`, { phone: h.nextPhone() });
  assert.equal(res.status, 409);
  assert.equal((await h.getLead(lead.id)).phone, lead.phone);
});

test("editing a lead's phone to a number on the DNC list is refused (409), the old number stays", async () => {
  const lead = await h.createLead();
  const dncPhone = h.nextPhone();
  await putOnDncList(dncPhone);
  const res = await rep.api.put(`/api/leads/${lead.id}`, { phone: dncPhone });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /DNC/);
  const after = await h.getLead(lead.id);
  assert.equal(after.phone, lead.phone);
  assert.equal(after.dnc_flag, false);
});
