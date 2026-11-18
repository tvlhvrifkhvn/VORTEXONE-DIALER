// Locks: parallel "next lead" requests never share a lead; parallel requests
// for one lead have one winner; the stale-lock sweep frees an old lock; a
// soft-deleted lead is never dialed.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const leadQueue = require('../src/services/leadQueue');

let reps;

before(async () => {
  await h.setupFile();
  reps = [];
  for (let i = 0; i < 20; i++) reps.push(await h.createUser({ role: 'rep' }));
});

test('20 parallel "next lead" requests get 20 different leads', async () => {
  for (let i = 0; i < 25; i++) await h.createLead();
  const results = await Promise.all(reps.map((r) => h.dial(r.api)));
  for (const res of results) assert.equal(res.status, 201, JSON.stringify(res.body));
  const ids = results.map((res) => res.body.lead.id);
  assert.equal(new Set(ids).size, 20);
  const { rows } = await h.db.query("SELECT count(*)::int AS n FROM leads WHERE status = 'in_progress'");
  assert.equal(rows[0].n, 20);
});

test('10 parallel requests for one lead: exactly one winner', async () => {
  const lead = await h.createLead();
  const results = await Promise.all(reps.slice(0, 10).map((r) => h.dial(r.api, lead.id)));
  const won = results.filter((r) => r.status === 201);
  const refused = results.filter((r) => r.status === 409);
  assert.equal(won.length, 1, results.map((r) => r.status).join(','));
  assert.equal(refused.length, 9);
  const { rows } = await h.db.query('SELECT count(*)::int AS n FROM call_history WHERE lead_id = $1', [lead.id]);
  assert.equal(rows[0].n, 1);
});

test('the stale-lock sweep frees a lock older than 30 s with no live call', async () => {
  const lead = await h.createLead();
  await h.db.query(
    "UPDATE leads SET status = 'in_progress', locked_by = $2, locked_at = now() - interval '2 minutes' WHERE id = $1",
    [lead.id, reps[0].user.id]
  );
  const released = await leadQueue.releaseStaleLocks();
  assert.ok(released.includes(lead.id));
  const after = await h.getLead(lead.id);
  assert.equal(after.status, 'in_queue');
  assert.equal(after.locked_by, null);
});

test('a soft-deleted lead is never dialed (queue or by id)', async () => {
  const lead = await h.createLead();
  await h.db.query('UPDATE leads SET deleted_at = now() WHERE id = $1', [lead.id]);
  const queued = await leadQueue.candidates({ campaignId: 1, limit: 1000 });
  assert.ok(!queued.some((l) => l.id === lead.id));
  const byId = await h.dial(reps[0].api, lead.id);
  assert.equal(byId.status, 404);
  assert.equal((await h.getLead(lead.id)).status, 'in_queue');
});
