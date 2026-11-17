// C6C: the activity log (a change is recorded, a GET is not, never a body,
// password or key; the lead timeline; the supervisor list; the 180-day purge),
// best time to call (the 30-call minimum, the local-hour math in two time
// zones), and the stage funnel on a scripted history.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const activityLog = require('../src/services/activityLog');
const bestTime = require('../src/services/bestTime');
const settings = require('../src/services/settings');

let rep;
let supervisor;

const waitForRows = (n) =>
  h.waitFor(async () => (await h.db.query('SELECT count(*)::int AS n FROM activity_log')).rows[0].n >= n, { timeoutMs: 5000, intervalMs: 50 });

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
});

test('activity: a change is recorded with its route pattern; a GET, a failed request and the login are not', async () => {
  await h.db.query('DELETE FROM activity_log');
  const lead = await h.createLead({ name: 'Logged Lead' });
  const secretNote = 'private note text that must not be logged';
  assert.equal((await rep.api.post(`/api/leads/${lead.id}/notes`, { body: secretNote })).status, 201);
  await waitForRows(1);
  await rep.api.get(`/api/leads/${lead.id}`);
  await rep.api.get('/api/leads');
  assert.equal((await rep.api.post(`/api/leads/${lead.id}/notes`, { body: '' })).status, 400);
  await h.createUser({ role: 'rep' }); // logs in
  await new Promise((r) => setTimeout(r, 200));

  const { rows } = await h.db.query('SELECT * FROM activity_log ORDER BY id');
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].method, 'POST');
  assert.equal(rows[0].route, '/api/leads/:id/notes');
  assert.equal(rows[0].entity_type, 'lead');
  assert.equal(rows[0].entity_id, lead.id);
  assert.equal(rows[0].status_code, 201);
  assert.equal(rows[0].summary, 'Added a note');
  assert.equal(rows[0].user_id, rep.user.id);
  assert.ok(!JSON.stringify(rows).includes(secretNote), 'never the body');

  // The lead's timeline shows it.
  const tl = await rep.api.get(`/api/leads/${lead.id}/timeline`);
  assert.ok(tl.body.timeline.some((e) => e.type === 'activity' && e.summary === 'Added a note' && e.user_name === rep.user.name));
});

test('activity: never a password or key, and only patterns in the route', async () => {
  await h.db.query('DELETE FROM activity_log');
  const key = 'gsk_verySecretKeyValue1234567890';
  assert.equal((await supervisor.api.put('/api/settings/groq-key', { value: key })).status, 200);
  const newPassword = 'Another-secret-pass-9';
  await rep.api.put('/api/auth/profile', { name: 'Rep Renamed', email: rep.user.email, password: newPassword });
  // A router mounted on a path with an id (/api/campaigns/:id/fields) still stores a pattern.
  assert.equal((await supervisor.api.post('/api/campaigns/1/fields', { label: 'Budget', type: 'text' })).status, 201);
  await waitForRows(2);
  await new Promise((r) => setTimeout(r, 200));
  const { rows } = await h.db.query('SELECT * FROM activity_log ORDER BY id');
  const text = JSON.stringify(rows);
  assert.ok(!text.includes(key) && !text.includes('gsk_'), 'no key');
  assert.ok(!text.includes(newPassword), 'no password');
  assert.ok(rows.some((r) => r.route === '/api/settings/:key' && r.summary === 'Changed a setting'));
  assert.ok(rows.some((r) => r.route === '/api/campaigns/:id/fields'), text);
  assert.ok(rows.every((r) => !/\/\d+(\/|$)/.test(r.route)), 'no real ids in a route');
  await settings.setSetting('groq-key', null);
});

test('activity: Settings list is supervisor only, filters by user and date; rows older than 180 days are purged', async () => {
  assert.equal((await rep.api.get('/api/activity')).status, 403);
  const all = await supervisor.api.get('/api/activity');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 2);
  const mine = await supervisor.api.get(`/api/activity?userId=${supervisor.user.id}`);
  assert.ok(mine.body.items.length > 0 && mine.body.items.every((r) => r.user_id === supervisor.user.id));
  assert.ok(mine.body.users.some((u) => u.id === supervisor.user.id));
  assert.equal((await supervisor.api.get('/api/activity?from=2000-01-01&to=2000-01-02')).body.total, 0);
  assert.equal((await supervisor.api.get('/api/activity?from=yesterday')).status, 400);

  await h.db.query(
    "INSERT INTO activity_log (user_id, method, route, status_code, summary, created_at) VALUES ($1, 'POST', '/api/x', 200, 'old', now() - interval '181 days'), ($1, 'POST', '/api/x', 200, 'recent', now() - interval '179 days')",
    [rep.user.id]
  );
  assert.equal(await activityLog.purgeOld(), 1);
  const { rows } = await h.db.query("SELECT summary FROM activity_log WHERE route = '/api/x'");
  assert.deepEqual(rows.map((r) => r.summary), ['recent']);
});

/** n placed calls for a lead at an instant; the first `contacts` are contacted. */
async function calls(lead, at, n, contacts) {
  for (let i = 0; i < n; i += 1) {
    await h.db.query(
      `INSERT INTO call_history (lead_id, campaign_id, started_at, ended_at, duration_seconds, disposition, disposition_at)
       VALUES ($1, $2, $3, $3, 30, $4, $3)`,
      [lead.id, lead.campaign_id, at, i < contacts ? 'contacted' : 'no_answer']
    );
  }
}

const hourIn = (zone, at) => Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(at));

test('best time: local-hour math in two time zones and the 30-call minimum', async () => {
  // A morning instant 10 days ago, 16:30 UTC: 10:30 in Texas (Central) or 9:30 in daylight time; 8:30 or 9:30 in California.
  const day = new Date(Date.now() - 10 * 864e5);
  const a = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 16, 30));
  const b = new Date(a.getTime() + 4 * 3600e3); // four hours later
  const tx = await h.createLead({ name: 'Texas Lead', state: 'TX' });
  const ca = await h.createLead({ name: 'California Lead', state: 'CA', areaCode: '415' });

  await calls(tx, a, 19, 10);
  await calls(tx, b, 10, 1);
  let r = await bestTime.forLead(tx.id);
  assert.equal(r.lead.calls, 29);
  assert.equal(r.lead.enough, false);
  assert.equal(r.text, bestTime.NOT_ENOUGH, 'below 30 calls: not enough data');

  await calls(tx, a, 1, 0); // the 30th call
  r = await bestTime.forLead(tx.id);
  assert.equal(r.lead.calls, 30);
  assert.equal(r.lead.enough, true);
  const txHourA = hourIn('America/Chicago', a);
  assert.equal(r.lead.best.hour, txHourA, 'the best hour is in Texas local time');
  assert.equal(r.lead.best.rate, 50); // 10 of 20
  assert.equal(r.lead.hours.find((x) => x.hour === hourIn('America/Chicago', b)).calls, 10);
  assert.match(r.text, /50% connect \(30 calls in 90 days, this lead\)/);

  // The same instants for California read two hours earlier.
  await calls(ca, a, 20, 15);
  await calls(ca, b, 10, 0);
  const rc = await bestTime.forLead(ca.id);
  assert.equal(rc.lead.best.hour, hourIn('America/Los_Angeles', a));
  assert.equal(txHourA - rc.lead.best.hour, 2, 'Central is two hours ahead of Pacific');
  assert.equal(rc.lead.best.rate, 75);

  // Calls older than 90 days, outside 8:00–21:00 local, or refused by the provider don't count.
  const old = new Date(Date.now() - 91 * 864e5);
  await calls(ca, old, 5, 5);
  const night = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9, 0)); // 1am / 2am in California
  await calls(ca, night, 5, 5);
  await h.db.query("INSERT INTO call_history (lead_id, campaign_id, started_at, telephony_state, disposition) VALUES ($1, $2, $3, 'failed', 'contacted')", [ca.id, ca.campaign_id, a]);
  assert.equal((await bestTime.forLead(ca.id)).lead.calls, 30);

  // Reports: one row per state; through the API too.
  const res = await rep.api.get('/api/reports/best-hours');
  assert.equal(res.status, 200);
  const states = Object.fromEntries(res.body.states.map((s) => [s.state, s]));
  assert.equal(states.TX.best.hour, txHourA);
  assert.equal(states.CA.best.hour, hourIn('America/Los_Angeles', a));
  const lead = await rep.api.get(`/api/leads/${tx.id}/best-time`);
  assert.equal(lead.status, 200);
  assert.equal(lead.body.stateCode, 'TX');
  // The pre-call brief carries the same line.
  const brief = await rep.api.get(`/api/leads/${tx.id}/brief?ai=0`);
  assert.equal(brief.body.instant.details.bestTime, r.text);
});

test('stage funnel: reached, conversion, wins, lost and cost per win on a scripted history', async () => {
  const file = await h.createCampaign({ name: 'Funnel File', kind: 'real_estate' });
  const { rows: st } = await h.db.query('SELECT id, name, kind, position FROM pipeline_stages WHERE campaign_id = $1 ORDER BY position', [file.id]);
  const byName = Object.fromEntries(st.map((s) => [s.name, s.id]));
  const lead = async (name) => h.createLead({ name, campaign_id: file.id });
  const [A, B, C, D, E] = [await lead('A'), await lead('B'), await lead('C'), await lead('D'), await lead('E')];
  const move = (l, to, ago = '1 minute') =>
    h.db.query(`INSERT INTO lead_stage_history (lead_id, to_stage_id, source, created_at) VALUES ($1, $2, 'manual', now() - $3::interval)`, [l.id, byName[to], ago]);
  for (const l of [A, B, C, D]) await move(l, 'New');
  await move(A, 'Contacted');
  await move(A, 'Interested');
  await move(B, 'Contacted');
  await move(C, 'Client'); // straight to won: counts as having reached every stage before it
  await move(D, 'Lost'); // lost is never progress
  await move(E, 'Proposal sent', '3 days'); // outside today's period

  // Call costs today in this file: 2 calls, 250 cents each, once rates are set.
  await settings.setSetting('rate_per_call_cents', '250');
  for (let i = 0; i < 2; i += 1) {
    await h.db.query(
      `INSERT INTO call_history (lead_id, campaign_id, started_at, ended_at, duration_seconds, disposition, billed_seconds, cost_est_cents)
       VALUES ($1, $2, now() - interval '5 minutes', now() - interval '4 minutes', 60, 'no_answer', 60, 250)`,
      [A.id, file.id]
    );
  }

  const res = await rep.api.get('/api/reports/funnel', { campaign: file.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const f = res.body.files[0];
  assert.deepEqual(
    f.stages.map((s) => [s.name, s.reached, s.conversionPct]),
    [
      ['New', 4, null],
      ['Contacted', 3, 75],
      ['Interested', 2, 66.7],
      ['Intro call booked', 1, 50],
      ['Proposal sent', 1, 100],
      ['Client', 1, 100],
    ]
  );
  assert.equal(f.wins, 1);
  assert.equal(f.lost, 1);
  assert.equal(f.ratesSet, true);
  assert.equal(f.spentCents, 500);
  assert.equal(f.costPerWinCents, 500);

  // ALL lists every file; with no rates the cost per win is not shown.
  await settings.setSetting('rate_per_call_cents', null);
  const all = await rep.api.get('/api/reports/funnel', { campaign: 'ALL' });
  const again = all.body.files.find((x) => x.campaignId === file.id);
  assert.equal(again.costPerWinCents, null);
  assert.equal(again.ratesSet, false);
  assert.ok(all.body.files.length >= 2);
  // A bad period is a 400.
  assert.equal((await rep.api.get('/api/reports/funnel?date=nope', { campaign: file.id })).status, 400);
});
