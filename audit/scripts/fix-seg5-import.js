// Segment 5 import test (driven by fix-seg5-import.sh, which prepares the DB,
// the generated file and the backend). Runs, against the API:
//   1. upload + process the generated file (auto mapping unless MANUAL_MAPPING=1),
//      polling progress; checks the summary against <file>.expected.json and the
//      "every row accounted for" rule; checks the DB.
//   2. the same file again (expect 0 new leads).
//   3. a second generated file (<file>.cancel.*), cancelled mid-way.
//   4. a sample of imported leads through the dial path (mock adapter).
// Reports elapsed time, the backend's peak RSS (VmHWM) and request counts.
// Usage: DB=<db> BACKEND_PID=<pid> AUDIT_PASSWORD=<pw> node fix-seg5-import.js <label> <file> [cancelFile]
const fs = require('fs');
const path = require('path');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const API = process.env.API || 'http://localhost:4000';
const [label, file, cancelFile] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(`${file}.expected.json`, 'utf8'));
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const q = async (s, p) => (await sql.query(s, p)).rows;
const out = (s) => console.log(`[${label}] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token;
let requests = 0;

const memKb = (field) => {
  try {
    const m = fs.readFileSync(`/proc/${process.env.BACKEND_PID}/status`, 'utf8').match(new RegExp(`${field}:\\s+(\\d+)`));
    return m ? Number(m[1]) : null;
  } catch { return null; }
};
const mb = (kb) => (kb == null ? '?' : `${(kb / 1024).toFixed(0)} MB`);

async function call(method, p, body, { form } = {}) {
  requests += 1;
  const headers = { authorization: `Bearer ${token}` };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${p}`, { method, headers, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json, text };
}

async function upload(f) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
  return call('POST', '/api/imports/upload', undefined, { form });
}

function chooseMapping(up) {
  if (process.env.MANUAL_MAPPING !== '1') return up.json.mapping;
  // What a user would pick by hand in the preview when the auto mapping is
  // wrong: only real lead fields, and name from a single column.
  const m = { ...expected.mapping };
  if (m.first_name) { m.name = m.first_name; delete m.first_name; delete m.last_name; }
  delete m.zip;
  return m;
}

async function runImport(f, { cancelWhen } = {}) {
  const t0 = Date.now();
  const r0 = requests;
  const up = await upload(f);
  if (up.status !== 201) return { up, elapsed: (Date.now() - t0) / 1000 };
  const mapping = chooseMapping(up);
  const pr = await call('POST', '/api/imports/process', { jobId: up.json.jobId, mapping });
  const polls = [];
  let st;
  let cancelResp = null;
  for (;;) {
    // The cancel test polls fast so it can land in the middle of an import.
    await sleep(cancelWhen ? 100 : 1000);
    st = await call('GET', `/api/imports/status/${up.json.jobId}`);
    const j = st.json;
    polls.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${j.percentage}% ${j.phase || ''} ${j.phaseLabel || ''} status=${j.status}`.replace(/\s+/g, ' '));
    if (cancelWhen && !cancelResp && cancelWhen(j)) {
      const written = (await q('SELECT count(*)::int n FROM leads'))[0].n;
      cancelResp = { at: polls[polls.length - 1], leadsBefore: written, resp: await call('POST', `/api/imports/cancel/${up.json.jobId}`) };
    }
    if (!['pending', 'processing'].includes(j.status)) break;
    if (Date.now() - t0 > 30 * 60 * 1000) { polls.push('TIMEOUT'); break; }
  }
  return { up, pr, mapping, final: st.json, polls, cancelResp, elapsed: (Date.now() - t0) / 1000, requests: requests - r0 };
}

const BUCKETS = ['imported', 'merged', 'alreadyInList', 'dncBlocked', 'noNumber', 'invalid'];
const bucketsOf = (s) => (s ? Object.fromEntries(BUCKETS.map((b) => [b, s[b]])) : {});

(async () => {
  await sql.connect();
  const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'vortexoneagency@gmail.com', password: process.env.AUDIT_PASSWORD }) });
  token = (await login.json()).token;
  if (!token) throw new Error('login failed');

  const leads0 = (await q('SELECT count(*)::int n FROM leads'))[0].n;
  const maxId0 = (await q('SELECT coalesce(max(id),0)::int n FROM leads'))[0].n;
  const hwm0 = memKb('VmHWM');
  out(`file ${path.basename(file)}: ${expected.totalRows} rows, ${fs.statSync(file).size} bytes; leads in DB before: ${leads0}; backend RSS before ${mb(memKb('VmRSS'))}`);

  // ---- 1. first import
  const a = await runImport(file);
  out(`upload -> HTTP ${a.up.status}${a.up.status !== 201 ? ` ${a.up.text.slice(0, 160)}` : ''}`);
  if (a.up.status === 201) {
    const auto = a.up.json.mapping || {};
    const want = expected.mapping;
    const mapOk = Object.entries(want).every(([k, v]) => auto[k] === v);
    out(`auto mapping (AI off): ${JSON.stringify(auto)}`);
    out(`auto mapping matches the expected columns: ${mapOk ? 'yes' : 'NO'}${process.env.MANUAL_MAPPING === '1' ? ' (MANUAL_MAPPING=1: processed with a hand-picked mapping)' : ''}`);
    out(`process -> HTTP ${a.pr.status}; final status=${a.final.status} after ${a.elapsed.toFixed(1)} s, ${a.requests} requests (${a.polls.length} status polls)`);
    const show = a.polls.length > 12 ? [...a.polls.slice(0, 6), '…', ...a.polls.slice(-5)] : a.polls;
    show.forEach((p) => out(`   poll ${p}`));
    const s = a.final.resultSummary;
    out(`summary: ${JSON.stringify(s ? { totalRows: s.totalRows, ...bucketsOf(s), unreadable: s.unreadable, withExtension: s.withExtension, skippedDnc: s.skippedDnc, skippedDuplicate: s.skippedDuplicate, skippedInvalid: s.skippedInvalid, mergedDuplicates: s.mergedDuplicates, importedWithoutPhone: s.importedWithoutPhone } : a.final.errorMessage || null)}`);
    out(`expected: ${JSON.stringify({ totalRows: expected.totalRows, ...bucketsOf(expected), unreadable: expected.unreadable, withExtension: expected.withExtension })}`);
    if (s && 'merged' in s) {
      const sum = BUCKETS.reduce((t, b) => t + (s[b] || 0), 0);
      out(`accounting rule: ${BUCKETS.join(' + ')} = ${sum} vs total ${s.totalRows} -> ${sum === s.totalRows ? 'OK' : 'BROKEN'}`);
      const diffs = BUCKETS.filter((b) => s[b] !== expected[b]).map((b) => `${b} ${s[b]} vs ${expected[b]}`);
      out(`buckets vs expected: ${diffs.length ? 'DIFF ' + diffs.join(', ') : 'all equal'}`);
    }
    if (s && 'merged' in s) {
      const csv = await call('GET', `/api/imports/${a.up.json.jobId}/skipped.csv`);
      const lines = csv.text.trim().split('\n');
      const skippedTotal = s.merged + s.alreadyInList + s.dncBlocked + s.invalid;
      out(`skipped-rows CSV: HTTP ${csv.status}, ${lines.length - 1} rows (skipped buckets: ${skippedTotal}) -> ${lines.length - 1 === skippedTotal ? 'OK' : 'MISMATCH'}; header: ${lines[0].slice(0, 90)}`);
      out(`invalid reasons: ${JSON.stringify(s.invalidReasons)}`);
    }
    const leads1 = (await q('SELECT count(*)::int n FROM leads'))[0].n;
    out(`DB: leads +${leads1 - leads0}; peak backend RSS ${mb(memKb('VmHWM'))} (was ${mb(hwm0)} before the import)`);
    const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name IN ('extension','original_phone')")).map((r) => r.column_name);
    if (cols.length === 2) {
      const ext = (await q('SELECT count(*)::int n FROM leads WHERE id > $1 AND extension IS NOT NULL', [maxId0]))[0].n;
      const unr = (await q("SELECT count(*)::int n FROM leads WHERE phone IS NULL AND original_phone IS NOT NULL AND original_phone <> ''"))[0].n;
      out(`DB: new leads with an extension: ${ext} (expected ${expected.withExtension}); phoneless leads keeping their unreadable raw text: ${unr} (expected ${expected.unreadable})`);
    } else out('DB: leads has no extension/original_phone columns (pre-fix schema)');
    const dncDialable = (await q("SELECT count(*)::int n FROM leads l JOIN dnc_list d ON d.phone = l.phone WHERE NOT l.dnc_flag AND l.status IN ('new','in_queue')"))[0].n;
    out(`DB: dialable leads whose phone is on the DNC list: ${dncDialable}`);
  }

  // ---- 2. same file again
  if (a.up.status === 201 && a.final.status === 'completed') {
    const leadsA = (await q('SELECT count(*)::int n FROM leads'))[0].n;
    const b = await runImport(file);
    const leadsB = (await q('SELECT count(*)::int n FROM leads'))[0].n;
    const s = b.final.resultSummary || {};
    out(`re-import same file: status=${b.final.status} in ${b.elapsed.toFixed(1)} s; new leads in DB: ${leadsB - leadsA}; summary ${JSON.stringify(bucketsOf(s))}${'merged' in s ? ` sum=${BUCKETS.reduce((t, k) => t + (s[k] || 0), 0)}/${s.totalRows}` : ` imported=${s.imported}`}`);
  }

  // ---- 3. cancel mid-way
  if (cancelFile) {
    const before = (await q('SELECT count(*)::int n FROM leads'))[0].n;
    const c = await runImport(cancelFile, { cancelWhen: (j) => (j.phase === 'saving' && j.savedRows > 0) || (j.phase == null && j.percentage >= 30) });
    const after = (await q('SELECT count(*)::int n FROM leads'))[0].n;
    const job = c.up.status === 201 ? (await q('SELECT status, result_summary FROM import_jobs WHERE id = $1', [c.up.json.jobId]))[0] : null;
    if (c.up.status !== 201) out(`cancel test: upload refused -> HTTP ${c.up.status} ${c.up.text.slice(0, 160)}`);
    else if (!c.cancelResp) out(`cancel test: the import finished before a mid-way point was seen (status ${c.final.status}); polls: ${c.polls.join(' | ')}`);
    else {
      out(`cancel test: cancel sent at [${c.cancelResp.at}] -> HTTP ${c.cancelResp.resp.status} ${c.cancelResp.resp.text.slice(0, 200)}`);
      out(`cancel test: job ended status=${job && job.status}; leads written by this job: ${after - before}; reported written: ${job && job.result_summary ? job.result_summary.written ?? job.result_summary.imported : 'n/a'}`);
    }
  }

  // ---- 4. dial a sample of imported leads (mock adapter, forced answered)
  const hasExt = (await q("SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='extension'")).length > 0;
  const sample = await q(
    `SELECT id, phone${hasExt ? ', extension' : ''} FROM leads
     WHERE id > $1 AND phone IS NOT NULL AND status = 'new'
       AND state IN ('TX','NY','FL','IL','GA','PA','OH','NC','MI','NJ','MA','VA','TN','MO')
     ORDER BY ${hasExt ? '(extension IS NULL), ' : ''}id LIMIT 5`,
    [maxId0]
  ).catch((e) => { out(`dial sample query failed: ${e.message}`); return []; });
  const dialed = [];
  for (const l of sample) {
    const r = await call('POST', '/api/calls', { leadId: l.id });
    dialed.push(`${l.id}${l.extension ? ` (ext ${l.extension})` : ''}:${r.status}`);
    if (r.status === 201) {
      await sleep(400);
      await call('POST', '/api/dispositions', { callId: r.json.call.id, disposition: 'contacted' });
    }
  }
  out(`dial sample (${sample.length} imported leads): ${dialed.join(' ') || 'none'}`);
  out(`requests in total: ${requests}`);
  await sql.end();
})().catch((e) => { console.error(`[${label}] HARNESS ERROR: ${e.message}`); process.exit(1); });
