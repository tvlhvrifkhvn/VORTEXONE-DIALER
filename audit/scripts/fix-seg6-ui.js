// Segment 6 browser check (production build). The DB has NO calling-hours
// setting row (the default). Checks:
//   Settings: what the page says about calling hours; flipping the switch
//             (without pressing Save) — what is stored, and does a closed
//             lead dial right after
//   Dashboard: "Dialable now" / "Waiting for their hours" cards
//   Lead list: the lead's local time next to the state
//   Call screen: the lead's local time in the header
// Usage: DB=<db> AUDIT_PASSWORD=<pw> node fix-seg6-ui.js <frontendBase> <closedLeadId> <openLeadId>
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base, closedLead, openLead] = process.argv.slice(2);
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const say = (s) => console.log(s);
const setting = async () => (await sql.query("SELECT value FROM settings WHERE key = 'calling_hours_enforced'")).rows[0]?.value ?? '(no row)';

(async () => {
  await sql.connect();
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const bad = [];
  p.on('response', (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);

  // Settings
  await p.goto(base + '/settings');
  await p.waitForTimeout(2000);
  const sw = p.locator('label', { hasText: 'Enforce calling hours' }).getByRole('switch');
  const banner = async () => ((await p.getByTestId('calling-hours-state').count()) ? (await p.getByTestId('calling-hours-state').locator('p').first().innerText()) : '(no ON/OFF line)');
  say(`settings: stored value ${await setting()}; switch aria-checked=${await sw.getAttribute('aria-checked')}; page says: ${await banner()}`);

  // Flip OFF with the switch only (no Save), then dial a closed lead via the API
  await sw.click();
  await p.waitForTimeout(800);
  say(`switch clicked once: stored value ${await setting()}; switch aria-checked=${await sw.getAttribute('aria-checked')}; page says: ${await banner()}`);
  // back to ON
  await sw.click();
  await p.waitForTimeout(800);
  say(`switch clicked again: stored value ${await setting()}; switch aria-checked=${await sw.getAttribute('aria-checked')}; page says: ${await banner()}`);
  if ((await setting()) !== 'true') {
    // base: the switch alone saves nothing; switch ON and press Save for the checks below
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
    await p.getByRole('button', { name: 'Save defaults' }).click();
    await p.waitForTimeout(800);
    say(`after "Save defaults": stored value ${await setting()}`);
  }

  // Dashboard
  await p.goto(base + '/');
  await p.waitForTimeout(3000);
  const body = await p.innerText('body');
  const card = (label) => {
    const m = body.match(new RegExp(`${label}\\s*\\n\\s*(\\d+)(?:\\s*\\n\\s*([^\\n]*))?`, 'i'));
    return m ? `${m[1]}${m[2] ? ` (${m[2].trim()})` : ''}` : '(not shown)';
  };
  say(`dashboard: "Dialable now" = ${card('Dialable now')}; "Waiting for their hours" = ${card('Waiting for their hours')}`);
  const times = body.match(/\d{1,2}:\d{2}\s?[AP]M [A-Z]{2,5}( · closed)?/g) || [];
  say(`lead list: local times shown: ${times.length} (e.g. ${[...new Set(times)].slice(0, 4).join(' | ') || '-'})`);

  // Call screen for an open lead (the call is placed)
  await p.goto(`${base}/call/${openLead}`);
  await p.waitForTimeout(4000);
  const hdr = (await p.innerText('body')).match(/Attempt \d+ \/ \d+\s*([^\n]*)/);
  say(`call screen (open lead ${openLead}): header after "Attempt": ${hdr ? JSON.stringify(hdr[1].trim()) : '(not found)'}; error shown: ${/Outside calling hours|Time zone unknown/.test(await p.innerText('body'))}`);
  // Call screen for a closed lead (should be refused)
  await p.goto(`${base}/call/${closedLead}`);
  await p.waitForTimeout(4000);
  const t = await p.innerText('body');
  say(`call screen (closed lead ${closedLead}): refusal shown = ${/Outside calling hours/.test(t)}; calls to it: ${(await sql.query('SELECT count(*)::int n FROM call_history WHERE lead_id = $1', [closedLead])).rows[0].n}`);

  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}; 5xx responses: ${bad.length ? bad.join(' | ') : 'none'}`);
  await b.close();
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
