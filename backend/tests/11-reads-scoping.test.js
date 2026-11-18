// C1C: leads, import and reports inside one campaign, or ALL (docs/CRM_PLAN.md).
// The lead list filters by file (or ALL) and carries file_number; search
// stays global and names the file. Import: leads go to the job's file, a
// phone held in another file is skipped with "Already in FILE NN · NAME
// (same phone number)", the no-phone identity check stays inside the file,
// and every row is still accounted for. Reports: per-file counts add up to
// the ALL totals; the PDF builds for one file and for ALL.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const pdfExport = require('../src/services/pdfExport');
const reportingPeriod = require('../src/services/reportingPeriod');

let supervisor;
let file2;

before(async () => {
  await h.setupFile();
  supervisor = await h.createUser({ role: 'supervisor' });
  file2 = await h.createCampaign({ name: 'Roofing' });
});

const local = (e164) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;

async function importCsv(text, campaign, name = 'c1c.csv') {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), name);
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form, campaign });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const proc = await supervisor.api.post(
    '/api/imports/process',
    { jobId: up.body.jobId, sheets: up.body.sheetNames, mapping: up.body.mapping },
    { campaign }
  );
  assert.equal(proc.status, 200, JSON.stringify(proc.body));
  const status = await h.waitFor(async () => {
    const s = await supervisor.api.get(`/api/imports/status/${up.body.jobId}`, { campaign });
    return ['completed', 'failed', 'cancelled'].includes(s.body.status) ? s.body : null;
  });
  assert.equal(status.status, 'completed', JSON.stringify(status));
  return { summary: status.resultSummary, jobId: up.body.jobId };
}

const BUCKETS = ['imported', 'noNumber', 'merged', 'alreadyInList', 'dncBlocked', 'invalid'];

test('import into File 02: leads land there; a phone from File 01 is skipped with its file label', async () => {
  const taken = await h.createLead({ campaign_id: 1, name: 'Owned By One' });
  const fresh = h.nextPhone();
  // The same no-phone person exists in File 01 only: not a duplicate in File 02.
  await h.createLead({ campaign_id: 1, name: 'Nora Nophone', phone: null, state: 'TX', missing_phone: true });
  const csv = [
    'Name,Phone,State',
    `Fresh Roof,${local(fresh)},TX`,
    `Taken Roof,${local(taken.phone)},TX`,
    'Nora Nophone,,TX',
  ].join('\n');
  const { summary, jobId } = await importCsv(csv, file2.id);
  assert.equal(summary.allRowsAccountedFor, true, JSON.stringify(summary));
  assert.equal(BUCKETS.reduce((t, k) => t + summary[k], 0) + summary.notProcessed, summary.totalRows);
  assert.equal(summary.imported, 1);
  assert.equal(summary.noNumber, 1);
  assert.equal(summary.alreadyInList, 1);

  const { rows: reasons } = await h.db.query(
    "SELECT reason FROM import_rows WHERE job_id = $1 AND outcome = 'already_in_list'",
    [jobId]
  );
  assert.deepEqual(reasons.map((r) => r.reason), ['Already in FILE 01 · REAL ESTATE (same phone number)']);
  const { rows: landed } = await h.db.query(
    "SELECT campaign_id FROM leads WHERE phone = $1 OR (phone IS NULL AND name = 'Nora Nophone' AND campaign_id <> 1)",
    [fresh]
  );
  assert.equal(landed.length, 2);
  for (const r of landed) assert.equal(r.campaign_id, file2.id);
  assert.equal((await h.getLead(taken.id)).campaign_id, 1);

  // Inside its own file the no-phone identity check still holds.
  const again = await importCsv('Name,Phone,State\nNora Nophone,,TX', file2.id, 'again.csv');
  assert.equal(again.summary.alreadyInList, 1);
  assert.equal(again.summary.noNumber, 0);
});

test('the lead list is per file (or ALL) and carries file_number; search is global', async () => {
  const one = await h.createLead({ campaign_id: 1, name: 'Listed Alpha' });
  const two = await h.createLead({ campaign_id: file2.id, name: 'Listed Bravo' });
  const ids = (res) => res.body.leads.map((l) => l.id);
  const l1 = await supervisor.api.get('/api/leads?limit=10000');
  const l2 = await supervisor.api.get('/api/leads?limit=10000', { campaign: file2.id });
  const all = await supervisor.api.get('/api/leads?limit=10000', { campaign: 'ALL' });
  assert.equal(l1.status, 200);
  assert.ok(ids(l1).includes(one.id) && !ids(l1).includes(two.id));
  assert.ok(ids(l2).includes(two.id) && !ids(l2).includes(one.id));
  assert.equal(all.body.total, l1.body.total + l2.body.total);
  assert.equal(l2.body.leads.find((l) => l.id === two.id).file_number, 2);
  assert.equal((await supervisor.api.get('/api/leads', { campaign: null })).status, 400);

  const found = await supervisor.api.get('/api/leads/search?q=Listed');
  assert.equal(found.status, 200);
  const bravo = found.body.leads.find((l) => l.id === two.id);
  assert.equal(bravo.file_number, 2);
  assert.equal(bravo.campaign_name, 'Roofing');
  assert.ok(found.body.leads.some((l) => l.id === one.id));
});

test('per-file report counts add up to the ALL totals', async () => {
  const plan = [
    [1, 'contacted'], [1, 'voicemail'], [1, 'no_answer'],
    [file2.id, 'contacted'], [file2.id, 'dnc'],
  ];
  for (const [campaign, disposition] of plan) {
    const lead = await h.createLead({ campaign_id: campaign });
    const call = await supervisor.api.post('/api/calls', { leadId: lead.id }, { campaign });
    assert.equal(call.status, 201, JSON.stringify(call.body));
    const res = await supervisor.api.post('/api/dispositions', { callId: call.body.call.id, disposition });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  const get = (path, campaign) => supervisor.api.get(path, { campaign }).then((r) => {
    assert.equal(r.status, 200, `${path} ${campaign}`);
    return r.body;
  });
  const [t1, t2, tAll] = await Promise.all([1, file2.id, 'ALL'].map((c) => get('/api/reports/today', c)));
  for (const k of ['dials', 'contacts', 'voicemails', 'noAnswers', 'dnc']) {
    assert.equal(t1[k] + t2[k], tAll[k], k);
  }
  assert.equal(t2.dials, 2);
  assert.equal(t2.dnc, 1);

  const [s1, s2, sAll] = await Promise.all([1, file2.id, 'ALL'].map((c) => get('/api/reports/per-state', c)));
  const sum = (b) => b.states.reduce((t, s) => [t[0] + s.dials, t[1] + s.contacts], [0, 0]);
  assert.deepEqual(sum(s1).map((v, i) => v + sum(s2)[i]), sum(sAll));
  assert.equal((await supervisor.api.get('/api/reports/today', { campaign: null })).status, 400);
});

test('the PDF builds for one file and for ALL (header names the file)', async () => {
  const period = await reportingPeriod.resolvePeriod();
  const one = await pdfExport.buildDailyReportBuffer(period, 'Verify', file2.id);
  const all = await pdfExport.buildDailyReportBuffer(period, 'Verify', 'ALL');
  for (const buf of [one, all]) assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  const res = await supervisor.api.get('/api/exports/daily-pdf', { campaign: 'ALL' });
  assert.equal(res.status, 200);
  const res2 = await supervisor.api.get('/api/exports/daily-pdf', { campaign: file2.id });
  assert.equal(res2.status, 200);
});
