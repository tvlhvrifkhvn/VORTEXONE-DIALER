// Segment 3 UI check (F-32): what does the call screen show when a
// disposition or hangup is refused with 403 / 409, and does it stay usable?
// Rep U1 = rep2 drives the browser; rep3 (U2) acts through the API.
// Test shortcuts (labelled): mock outcome forced to answered; locked_at
// backdated in SQL; for the 403 case the call's user_id is changed in SQL to
// U2, standing in for "this call belongs to another rep".
// Usage: DB=<db> node audit/scripts/fix-seg3-ui.js <frontendBase> <leadA> <leadB>
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base, leadA, leadB] = process.argv.slice(2);
const API = process.env.API || 'http://localhost:4000';
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const q = async (s, p) => (await sql.query(s, p)).rows;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sql.connect();
  const u2 = (await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'rep3@example.com', password: 'Rep3Pass!' }) })).json()).token;
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const errors = [];
  const responses = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', (r) => { if (/\/api\/(dispositions|calls\/\d+\/hangup)/.test(r.url())) responses.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`); });
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'rep2@example.com');
  await p.fill('input[type=password]', 'Rep2Pass!');
  await p.click('button[type=submit]');
  await p.waitForTimeout(2000);

  const shows = async (text) => (await p.innerText('body')).includes(text);
  const state = async () => ((await p.innerText('body')).match(/Ringing…|Connected|Call ended/) || ['?'])[0];

  // --- 409: U1 hung up, grace expired, U2 dialed the lead, U1 dispositions late
  await p.goto(`${base}/call/${leadA}`);
  await p.waitForTimeout(5000);
  console.log(`409 case, lead ${leadA}: UI state before = ${await state()}`);
  await p.getByRole('button', { name: 'End call' }).click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Hang up', exact: true }).click();
  await p.waitForTimeout(1000);
  await q("UPDATE leads SET locked_at = now() - interval '31 seconds' WHERE id = $1", [leadA]);
  await fetch(`${API}/api/leads?limit=1`, { headers: { authorization: `Bearer ${u2}` } }); // lazy sweep
  const d = await fetch(`${API}/api/calls`, { method: 'POST', headers: { authorization: `Bearer ${u2}`, 'content-type': 'application/json' }, body: JSON.stringify({ leadId: Number(leadA) }) });
  console.log(`   U2 dials lead ${leadA} via API -> ${d.status}`);
  await p.getByRole('button', { name: 'No Answer' }).click();
  await p.waitForTimeout(1500);
  console.log(`   after clicking No Answer: message "This lead is now with another rep." shown = ${await shows('This lead is now with another rep.')}`);
  console.log(`   No Answer button enabled again = ${await p.getByRole('button', { name: 'No Answer' }).isEnabled()}`);
  const leadRow = (await q('SELECT status, locked_by FROM leads WHERE id = $1', [leadA]))[0];
  console.log(`   lead ${leadA} after: ${leadRow.status} locked_by=${leadRow.locked_by} (U2 = 3)`);

  // --- 403: the open call now belongs to another rep
  await p.goto(`${base}/call/${leadB}`);
  await p.waitForTimeout(5000);
  console.log(`403 case, lead ${leadB}: UI state before = ${await state()}`);
  await q("UPDATE call_history SET user_id = 3 WHERE lead_id = $1 AND ended_at IS NULL AND disposition IS NULL", [leadB]);
  await p.getByRole('button', { name: 'No Answer' }).click();
  await p.waitForTimeout(1500);
  console.log(`   after clicking No Answer: message "This call belongs to another rep." shown = ${await shows('This call belongs to another rep.')}`);
  await p.getByRole('button', { name: 'End call' }).click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Hang up', exact: true }).click();
  await p.waitForTimeout(1500);
  console.log(`   after Hang up: 403 message shown = ${await shows('This call belongs to another rep.')}, UI state = ${await state()} (still polling: live state kept)`);
  console.log(`   No Answer button enabled again = ${await p.getByRole('button', { name: 'No Answer' }).isEnabled()}`);

  console.log('requests:', responses.join(' | '));
  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  await b.close();
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
