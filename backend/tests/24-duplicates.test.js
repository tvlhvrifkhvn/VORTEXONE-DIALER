// C6B: duplicates and merge (docs/CRM_PLAN.md). Candidates by email, name
// and company, name / state / office, also across files; a merge moves every
// child table's rows to the primary; fields, tags and attempts; DNC wins;
// in_progress is refused; invariants I1 to I15 hold after merges; the merged
// lead is never dialed or listed.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const duplicates = require('../src/services/duplicates');
const leadQueue = require('../src/services/leadQueue');
const dncCheck = require('../src/services/dncCheck');

let rep;
let file2;
let objectionType;

const count = async (sql, params = []) => (await h.db.query(sql, params)).rows[0].n;

/** One row in every child table for a lead (a call with a disposition, so I6 stays clean). */
async function giveHistory(lead) {
  const { rows: call } = await h.db.query(
    `INSERT INTO call_history (lead_id, user_id, started_at, ended_at, duration_seconds, disposition, disposition_at, campaign_id)
     VALUES ($1, $2, now() - interval '1 hour', now() - interval '59 minutes', 60, 'voicemail', now() - interval '59 minutes', $3) RETURNING id`,
    [lead.id, rep.user.id, lead.campaign_id]
  );
  await h.db.query("INSERT INTO callbacks (lead_id, scheduled_at, note) VALUES ($1, now() + interval '1 day', 'cb')", [lead.id]);
  const { rows: sms } = await h.db.query("INSERT INTO sms_messages (lead_id, direction, body) VALUES ($1, 'inbound', 'Hi there') RETURNING id", [lead.id]);
  await h.db.query("INSERT INTO sms_opt_events (lead_id, action, source, sms_message_id) VALUES ($1, 'opt_in', 'rep', $2)", [lead.id, sms[0].id]);
  await h.db.query("INSERT INTO email_messages (lead_id, direction, subject, body, status) VALUES ($1, 'outbound', 'Hello', 'Body', 'sent')", [lead.id]);
  await h.db.query('INSERT INTO call_objections (call_id, lead_id, objection_type_id) VALUES ($1, $2, $3)', [call[0].id, lead.id, objectionType]);
  await h.db.query('INSERT INTO lead_notes (lead_id, body) VALUES ($1, $2)', [lead.id, `note for ${lead.name}`]);
  await h.db.query("INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id, source) VALUES ($1, NULL, $2, 'create')", [lead.id, lead.pipeline_stage_id]);
  await h.db.query("INSERT INTO tasks (campaign_id, lead_id, title, due_at) VALUES ($1, $2, 'Follow up', now() + interval '2 days')", [lead.campaign_id, lead.id]);
}

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  file2 = await h.createCampaign({ name: 'Roofing' });
  objectionType = (await h.db.query("INSERT INTO objection_types (label) VALUES ('Too busy') RETURNING id")).rows[0].id;
  const supervisor = await h.createUser({ role: 'supervisor' }); // custom fields are a supervisor's
  const field = await supervisor.api.post('/api/campaigns/1/fields', { label: 'Budget', type: 'text' });
  assert.equal(field.status, 201, JSON.stringify(field.body));
});

test('candidates: same email, same name and company, same name / state / office; pairs across files say both files', async () => {
  const a = await h.createLead({ name: 'Dana Dup', email: 'dana@example.com', brokerage: 'Acme Realty' });
  const b = await h.createLead({ name: 'dana dup ', email: ' DANA@example.com', brokerage: 'acme realty' });
  const c = await h.createLead({ name: 'Eli Office', state: 'TX', office_key: 'acme|tx' });
  const d = await h.createLead({ name: 'Eli Office', state: 'TX', office_key: 'acme|tx', campaign_id: file2.id });
  await h.createLead({ name: 'Eli Office', state: 'CA', office_key: 'acme|tx' }); // another state: no

  const res = await rep.api.get('/api/leads/duplicates');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const pair = (x, y) => res.body.pairs.find((p) => p.key === `${Math.min(x, y)}-${Math.max(x, y)}`);
  assert.deepEqual(pair(a.id, b.id).reasons.sort(), ['Same email', 'Same name and company']);
  const cross = pair(c.id, d.id);
  assert.deepEqual(cross.reasons, ['Same name, state and office']);
  assert.equal(cross.crossFile, true);
  assert.deepEqual(cross.leads.map((l) => l.file_number).sort(), [1, 2]);
  // File 02's own view finds the cross-file pair too; ALL finds everything.
  const f2 = await rep.api.get('/api/leads/duplicates', { campaign: file2.id });
  assert.ok(f2.body.pairs.some((p) => p.key === cross.key));
  assert.ok(!f2.body.pairs.some((p) => p.key === pair(a.id, b.id).key));
  assert.ok((await rep.api.get('/api/leads/duplicates', { campaign: 'ALL' })).body.total >= 2);
});

test('merge: every child table moves to the primary; fields, tags, attempts; the secondary is soft-deleted with merged_into', async () => {
  const p = await h.createLead({ name: 'Paula Primary', email: null, address: '1 Main St, Dallas, TX', brokerage: 'Keep Realty', tags: ['hot'], attempts: 1, max_attempts: 5, custom: { budget: 'low' } });
  const s = await h.createLead({ name: 'Paula P.', email: 'paula@example.com', address: '9 Side St, Austin, TX', brokerage: 'Other Realty', tags: ['HOT', 'spanish'], attempts: 3, max_attempts: 4, custom: { budget: 'high' }, campaign_id: file2.id });
  await giveHistory(p);
  await giveHistory(s);
  const before = {};
  for (const t of duplicates.CHILD_TABLES) {
    before[t.table] = {
      p: await count(`SELECT count(*)::int AS n FROM ${t.table} WHERE lead_id = $1`, [p.id]),
      s: await count(`SELECT count(*)::int AS n FROM ${t.table} WHERE lead_id = $1`, [s.id]),
    };
  }
  assert.ok(Object.entries(before).every(([table, c]) => table === 'dnc_list' || c.s > 0), 'the secondary has rows in every child table');

  const pre = await rep.api.get(`/api/leads/merge-preview?primaryId=${p.id}&secondaryId=${s.id}`);
  assert.equal(pre.status, 200);
  assert.ok(pre.body.moves.some((m) => m.table === 'call_history' && m.count === 1));
  assert.equal(pre.body.dncWins, false);

  const res = await rep.api.post('/api/leads/merge', {
    primaryId: p.id, secondaryId: s.id, fieldChoices: { address: 'secondary', 'custom.budget': 'secondary' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  for (const t of duplicates.CHILD_TABLES) {
    const pNow = await count(`SELECT count(*)::int AS n FROM ${t.table} WHERE lead_id = $1`, [p.id]);
    const sNow = await count(`SELECT count(*)::int AS n FROM ${t.table} WHERE lead_id = $1`, [s.id]);
    const note = t.table === 'lead_notes' ? 1 : 0; // + the merge note
    assert.equal(pNow, before[t.table].p + before[t.table].s + note, `${t.table} moved to the primary`);
    assert.equal(sNow, 0, `${t.table}: nothing left on the secondary`);
  }
  const merged = await h.getLead(p.id);
  assert.equal(merged.name, 'Paula Primary', 'the primary wins by default');
  assert.equal(merged.email, 'paula@example.com', 'an empty primary value takes the secondary\'s');
  assert.equal(merged.address, '9 Side St, Austin, TX', 'fieldChoices: secondary');
  assert.equal(merged.brokerage, 'Keep Realty');
  assert.deepEqual(merged.custom, { budget: 'high' });
  assert.deepEqual(merged.tags, ['hot', 'spanish'], 'tags joined, case-insensitive');
  assert.equal(merged.attempts, 3);
  assert.equal(merged.max_attempts, 5);
  assert.equal(merged.campaign_id, 1, 'the primary keeps its file');
  // Tasks follow the primary's file; calls keep the file they were made from.
  assert.equal(await count('SELECT count(*)::int AS n FROM tasks WHERE lead_id = $1 AND campaign_id <> 1', [p.id]), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM call_history WHERE lead_id = $1 AND campaign_id = $2', [p.id, file2.id]), 1);
  const gone = await h.getLead(s.id);
  assert.ok(gone.deleted_at);
  assert.equal(gone.merged_into, p.id);
  const { rows: notes } = await h.db.query("SELECT body FROM lead_notes WHERE lead_id = $1 AND body LIKE 'Merged lead%'", [p.id]);
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, new RegExp(`#${s.id}`));
  assert.ok(notes[0].body.includes(s.phone), "the note records the secondary's phone");

  // Bad requests.
  assert.equal((await rep.api.post('/api/leads/merge', { primaryId: p.id, secondaryId: p.id })).status, 400);
  assert.equal((await rep.api.post('/api/leads/merge', { primaryId: p.id, secondaryId: s.id })).status, 404, 'already merged');
  const x = await h.createLead({ name: 'X' });
  assert.equal((await rep.api.post('/api/leads/merge', { primaryId: p.id, secondaryId: x.id, fieldChoices: { phone: 'secondary' } })).status, 400);
});

test('merge: DNC wins (the primary becomes DNC and lost; both numbers on the list)', async () => {
  const p = await h.createLead({ name: 'Clean Primary' });
  const s = await h.createLead({ name: 'Dnc Secondary', status: 'dnc', dnc_flag: true });
  await dncCheck.addToDncList(s.phone, { leadId: s.id });
  const res = await rep.api.post('/api/leads/merge', { primaryId: p.id, secondaryId: s.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dnc, true);
  const merged = await h.getLead(p.id);
  assert.equal(merged.status, 'dnc');
  assert.equal(merged.dnc_flag, true);
  const { rows: stage } = await h.db.query('SELECT kind FROM pipeline_stages WHERE id = $1', [merged.pipeline_stage_id]);
  assert.equal(stage[0].kind, 'lost');
  assert.equal(await dncCheck.isOnDncList(p.phone), true);
  assert.equal(await dncCheck.isOnDncList(s.phone), true);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_stage_history WHERE lead_id = $1 AND source = 'merge'", [p.id]), 1);
});

test('merge: refused while either lead is in_progress; nothing moves', async () => {
  const p = await h.createLead({ name: 'Busy Primary' });
  const s = await h.createLead({ name: 'Busy Secondary' });
  await giveHistory(s);
  await h.db.query("UPDATE leads SET status = 'in_progress', locked_by = $2, locked_at = now() WHERE id = $1", [s.id, rep.user.id]);
  const res = await rep.api.post('/api/leads/merge', { primaryId: p.id, secondaryId: s.id });
  assert.equal(res.status, 409);
  assert.equal((await h.getLead(s.id)).deleted_at, null);
  assert.equal(await count('SELECT count(*)::int AS n FROM lead_notes WHERE lead_id = $1', [s.id]), 1);
  await h.db.query("UPDATE leads SET status = 'in_queue', locked_by = NULL, locked_at = NULL WHERE id = $1", [s.id]);
  const swapped = await rep.api.post('/api/leads/merge', { primaryId: s.id, secondaryId: p.id });
  assert.equal(swapped.status, 200, 'once free, it merges');
});

test('the merged lead is never dialed or listed', async () => {
  const p = await h.createLead({ name: 'Keep Me' });
  const s = await h.createLead({ name: 'Merge Me Away' });
  assert.equal((await rep.api.post('/api/leads/merge', { primaryId: p.id, secondaryId: s.id })).status, 200);
  const list = await rep.api.get('/api/leads?search=Merge%20Me&limit=200');
  assert.ok(!list.body.leads.some((l) => l.id === s.id));
  assert.ok(!(await rep.api.get('/api/leads/search?q=Merge%20Me')).body.leads.some((l) => l.id === s.id));
  assert.ok(!(await leadQueue.candidates({ campaignId: 1, limit: 1000 })).some((l) => l.id === s.id));
  const dial = await h.dial(rep.api, s.id);
  assert.ok(dial.status >= 400, `dialing a merged lead is refused (${dial.status})`);
  // Its page says where it went.
  assert.equal((await rep.api.get(`/api/leads/${s.id}`)).body.lead.merged_into, p.id);
});

test('invariants I1 to I15 hold after the merges', async () => {
  // I1
  assert.equal(await count(`SELECT count(*)::int AS n FROM leads WHERE status IS NULL OR status NOT IN
    ('new','in_queue','in_progress','contacted','voicemail','no_answer','callback_scheduled','no_contact_number','no_contact_person','dnc','cold')`), 0);
  // I2, I3
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE status = 'in_progress' AND locked_at < now() - interval '30 seconds'"), 0);
  // I4
  assert.equal(await count('SELECT count(*)::int AS n FROM call_history c WHERE c.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = c.lead_id)'), 0);
  // I5
  assert.equal(await count("SELECT count(*)::int AS n FROM call_history WHERE disposition IS NULL AND ended_at IS NULL AND started_at < now() - interval '5 minutes'"), 0);
  // I6
  assert.equal(await count('SELECT count(*)::int AS n FROM (SELECT lead_id FROM call_history WHERE lead_id IS NOT NULL AND disposition IS NULL GROUP BY lead_id HAVING count(*) > 1) x'), 0);
  // I7
  assert.equal(await count('SELECT count(*)::int AS n FROM leads WHERE attempts > max_attempts'), 0);
  // I8
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE dnc_flag AND status <> 'dnc'"), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE status = 'dnc' AND NOT dnc_flag"), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM leads l WHERE NOT l.dnc_flag AND EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone)'), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM leads WHERE phone IS NOT NULL AND phone !~ '^\\+1[2-9][0-9]{9}$'"), 0);
  // I10, I11
  assert.equal(await count('SELECT count(*)::int AS n FROM leads l WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = l.campaign_id)'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM call_history ch WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ch.campaign_id)'), 0);
  // I12, I13
  assert.equal(await count('SELECT count(*)::int AS n FROM leads WHERE pipeline_stage_id IS NULL'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM leads l JOIN pipeline_stages s ON s.id = l.pipeline_stage_id WHERE s.campaign_id <> l.campaign_id'), 0);
  // I14: each file's queue only holds its own, live leads.
  for (const campaignId of [1, file2.id]) {
    const queue = await leadQueue.candidates({ campaignId, limit: 1000 });
    assert.ok(queue.every((l) => l.campaign_id === campaignId && !l.deleted_at), `queue of file ${campaignId}`);
  }
  // I15: the DNC check ignores the campaign.
  const { rows } = await h.db.query('SELECT phone FROM dnc_list LIMIT 1');
  assert.equal(await dncCheck.isOnDncList(rows[0].phone), true);
  // Tasks of a lead are in the lead's file.
  assert.equal(await count('SELECT count(*)::int AS n FROM tasks t JOIN leads l ON l.id = t.lead_id WHERE t.campaign_id <> l.campaign_id AND l.deleted_at IS NULL'), 0);
});
