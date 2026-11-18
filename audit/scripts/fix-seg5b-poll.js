// Segment 5 B.2 (F-50): the call screen must not freeze or lose a disposition.
// Mock outcome forced to answered (stub). Scenarios, each on its own lead:
//   A  stay on the live call, click "Spoke / Interested" at ~57 s (the audit's 429 window)
//   B  stay 185 s on the live call, sampling the visible status every 15 s, then click
//   C  the first two POST /api/dispositions are made to fail in the browser
//      (a 429 with Retry-After: 1, then a network error); expect an automatic retry,
//      "Not saved yet" shown meanwhile, exactly one disposition saved
// Usage: DB=<db> AUDIT_PASSWORD=<pw> node fix-seg5b-poll.js <frontendBase> <leadA> <leadB> <leadC> [scenarios]
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base, leadA, leadB, leadC, which = 'ABC'] = process.argv.slice(2);
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const q = async (s, p) => (await sql.query(s, p)).rows;
const say = (s) => console.log(s);

async function session() {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);
  return { b, p };
}

function watch(p) {
  const t0 = Date.now();
  const w = { counts: {}, first429: null, polls: 0, lastPoll: null, dispositionPosts: [], errors: [] };
  p.on('pageerror', (e) => w.errors.push(e.message));
  p.on('response', (r) => {
    const u = new URL(r.url()).pathname;
    if (!u.startsWith('/api/')) return;
    const s = r.status();
    w.counts[s] = (w.counts[s] || 0) + 1;
    if (r.request().method() === 'GET' && /^\/api\/calls\/\d+$/.test(u)) {
      w.polls += 1;
      w.lastPoll = ((Date.now() - t0) / 1000).toFixed(0);
    }
    if (s === 429 && !w.first429) w.first429 = `${((Date.now() - t0) / 1000).toFixed(0)}s ${r.request().method()} ${u}`;
    if (r.request().method() === 'POST' && u === '/api/dispositions') w.dispositionPosts.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  });
  w.t0 = t0;
  return w;
}

const stateOf = async (p) => ((await p.innerText('body')).match(/Ringing…|Connected|Call ended/) || ['?'])[0];

async function clickAndCheck(p, w, leadId, label) {
  const before = w.dispositionPosts.length;
  await p.locator('button', { hasText: /^Spoke \/ Interested$/ }).first().click();
  await p.waitForTimeout(1500);
  const visible = ((await p.innerText('body')).match(/Not saved yet[^\n]*|Logged as[^\n]*|Too many requests[^\n]*|Couldn't save[^\n]*/) || ['(nothing)'])[0];
  await p.waitForTimeout(8000);
  const rows = await q('SELECT id, disposition FROM call_history WHERE lead_id = $1 ORDER BY id', [leadId]);
  const later = ((await p.innerText('body')).match(/Logged as[^\n]*|Too many requests[^\n]*|Couldn't save[^\n]*|Not saved yet[^\n]*/) || ['(nothing)'])[0];
  say(`  ${label}: clicked at ${((Date.now() - w.t0) / 1000 - 9.5).toFixed(0)}s; right after: "${visible}"; 8 s later: "${later}"`);
  say(`  ${label}: POST /api/dispositions seen by the browser: ${w.dispositionPosts.slice(before).join(', ') || 'none'}; DB calls on lead ${leadId}: ${rows.map((r) => `${r.id}:${r.disposition || 'NULL'}`).join(', ')}`);
}

(async () => {
  await sql.connect();
  if (which.includes('A')) {
    const { b, p } = await session();
    const w = watch(p);
    await p.goto(`${base}/call/${leadA}`);
    await p.waitForTimeout(6000);
    say(`A (click at ~57 s): state at 6 s: ${await stateOf(p)}`);
    await p.waitForTimeout(51000);
    say(`  A: state at ~57 s: ${await stateOf(p)}; GET /api/calls/:id polls so far: ${w.polls}, last at ${w.lastPoll}s; responses ${JSON.stringify(w.counts)}; first 429: ${w.first429 || 'none'}`);
    await clickAndCheck(p, w, leadA, 'A');
    say(`  A: page errors: ${w.errors.length ? w.errors.join(' | ') : 'none'}`);
    await b.close();
  }
  if (which.includes('B')) {
    const { b, p } = await session();
    const w = watch(p);
    await p.goto(`${base}/call/${leadB}`);
    const samples = [];
    for (let t = 15; t <= 180; t += 15) {
      await p.waitForTimeout(15000);
      samples.push(`${t}s:${await stateOf(p)}`);
    }
    await p.waitForTimeout(5000);
    say(`B (185 s live call): status every 15 s: ${samples.join(' ')}`);
    say(`  B: GET /api/calls/:id polls in 185 s: ${w.polls}, last one at ${w.lastPoll}s; responses ${JSON.stringify(w.counts)}; first 429: ${w.first429 || 'none'}`);
    await clickAndCheck(p, w, leadB, 'B');
    say(`  B: page errors: ${w.errors.length ? w.errors.join(' | ') : 'none'}`);
    await b.close();
  }
  if (which.includes('C')) {
    const { b, p } = await session();
    const w = watch(p);
    let forced = 0;
    await p.route('**/api/dispositions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      forced += 1;
      if (forced === 1) return route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Too many requests — slow down and try again shortly.' }) });
      if (forced === 2) return route.abort('failed');
      return route.continue();
    });
    await p.goto(`${base}/call/${leadC}`);
    await p.waitForTimeout(6000);
    say(`C (forced 429, then a network error, on the disposition): state at 6 s: ${await stateOf(p)}`);
    await clickAndCheck(p, w, leadC, 'C');
    say(`  C: disposition POSTs attempted by the page: ${forced} (1st forced 429, 2nd forced network error)`);
    say(`  C: page errors: ${w.errors.length ? w.errors.join(' | ') : 'none'}`);
    await b.close();
  }
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
