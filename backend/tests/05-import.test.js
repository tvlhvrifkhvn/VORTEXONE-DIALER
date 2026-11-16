// Import: every row of the file lands in exactly one outcome bucket; a DNC row
// is blocked; importing the same file again adds no leads.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let supervisor;
let dncPhone;
let csv;

before(async () => {
  await h.setupFile();
  supervisor = await h.createUser({ role: 'supervisor' });
  dncPhone = h.nextPhone();
  await h.db.query("INSERT INTO dnc_list (phone, source) VALUES ($1, 'manual')", [dncPhone]);
  const local = (e164) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  const a = h.nextPhone();
  const b = h.nextPhone();
  const c = h.nextPhone();
  csv = [
    'Name,Phone,State',
    `Alice Import,${local(a)},TX`,
    `Bob Import,${local(b)},TX`,
    `Bob Import,${local(b)},TX`, // same person twice in the file
    'Carol NoPhone,,TX', // no number
    `Dan Dnc,${local(dncPhone)},TX`, // on the DNC list
    `Erin Import,${local(c)},CA`,
  ].join('\n');
});

/** Uploads the CSV, starts the job with the suggested mapping, waits for the summary. */
async function importCsv(text, name = 'verify.csv') {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/csv' }), name);
  const up = await supervisor.api.post('/api/imports/upload', undefined, { form });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const proc = await supervisor.api.post('/api/imports/process', {
    jobId: up.body.jobId,
    sheets: up.body.sheetNames,
    mapping: up.body.mapping,
  });
  assert.equal(proc.status, 200, JSON.stringify(proc.body));
  const status = await h.waitFor(async () => {
    const s = await supervisor.api.get(`/api/imports/status/${up.body.jobId}`);
    return ['completed', 'failed', 'cancelled'].includes(s.body.status) ? s.body : null;
  });
  assert.equal(status.status, 'completed', JSON.stringify(status));
  return status.resultSummary;
}

const BUCKETS = ['imported', 'noNumber', 'merged', 'alreadyInList', 'dncBlocked', 'invalid'];

test('the outcome counts add up to the rows of the file; the DNC row is blocked', async () => {
  const before = (await h.db.query('SELECT count(*)::int AS n FROM leads')).rows[0].n;
  const s = await importCsv(csv);
  const sum = BUCKETS.reduce((t, k) => t + s[k], 0);
  assert.equal(s.totalRows, 6);
  assert.equal(sum + s.notProcessed, s.totalRows, JSON.stringify(s));
  assert.equal(s.allRowsAccountedFor, true);
  assert.equal(s.dncBlocked, 1);
  assert.equal(s.merged, 1);
  const after = (await h.db.query('SELECT count(*)::int AS n FROM leads')).rows[0].n;
  assert.equal(after - before, s.imported + s.noNumber);
  const { rows } = await h.db.query('SELECT 1 FROM leads WHERE phone = $1', [dncPhone]);
  assert.equal(rows.length, 0);
});

test('importing the same file again adds 0 leads', async () => {
  const before = (await h.db.query('SELECT count(*)::int AS n FROM leads')).rows[0].n;
  const s = await importCsv(csv, 'verify-again.csv');
  assert.equal(s.imported, 0);
  assert.equal(s.noNumber, 0);
  assert.equal(s.allRowsAccountedFor, true);
  const after = (await h.db.query('SELECT count(*)::int AS n FROM leads')).rows[0].n;
  assert.equal(after, before);
});
