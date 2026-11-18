// Clearing a scheduled callback: the lead goes back to in_queue, dialable now
// (next_action_at NULL), its open callbacks rows are done; any other status is
// refused (409), so a locked or DNC lead is never touched.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
});

test('DELETE /leads/:id/callback puts the lead back in the queue and closes its callback', async () => {
  const lead = await h.createLead({});
  const when = new Date(Date.now() + 3 * 3600e3).toISOString();
  assert.equal((await rep.api.post(`/api/leads/${lead.id}/callback`, { scheduledAt: when })).status, 200);
  const res = await rep.api.del(`/api/leads/${lead.id}/callback`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.lead.status, 'in_queue');
  assert.equal(res.body.lead.next_action_at, null);
  const open = await h.db.query('SELECT count(*)::int AS n FROM callbacks WHERE lead_id = $1 AND done = false', [lead.id]);
  assert.equal(open.rows[0].n, 0);
});

test('a lead without a scheduled callback (DNC, in progress) is refused and left as it was', async () => {
  for (const status of ['dnc', 'in_progress', 'in_queue']) {
    const lead = await h.createLead({ status, ...(status === 'dnc' ? { dnc_flag: true } : {}) });
    assert.equal((await rep.api.del(`/api/leads/${lead.id}/callback`)).status, 409);
    assert.equal((await h.getLead(lead.id)).status, status);
  }
});
