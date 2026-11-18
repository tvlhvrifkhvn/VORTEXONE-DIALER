// Segment 5 B.5 (F-33): a note added mid-call with "Add note" shows up in
// "Previous Notes" on the next call to the same lead.
// Mock forced to answered (stub). Between the two calls the lead is made
// dialable again by DIRECT SQL (status in_queue) — a test shortcut, since a
// logged call is not due again for hours.
// Usage: DB=<db> AUDIT_PASSWORD=<pw> node fix-seg5b-notes-ui.js <frontendBase> <leadId>
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base, leadId] = process.argv.slice(2);
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const say = (s) => console.log(s);
const NOTE = `Mid-call note ${Date.now()}: gatekeeper said call after 3pm`;
const DISPO_NOTE = 'Disposition note: asked about pricing';

(async () => {
  await sql.connect();
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);

  await p.goto(`${base}/call/${leadId}`);
  await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Add note' }).click();
  await p.fill('textarea[placeholder^="Note saves on its own"]', NOTE);
  await p.getByRole('button', { name: 'Save note' }).click();
  await p.waitForTimeout(1200);
  say(`call 1: mid-call note saved ("Note saved" shown = ${/Note saved/.test(await p.innerText('body'))})`);
  await p.fill('textarea[placeholder="What happened on this call?"]', DISPO_NOTE);
  await p.locator('button', { hasText: /^Spoke \/ Interested$/ }).first().click();
  await p.waitForTimeout(2000);
  const rows = (await sql.query('SELECT (SELECT count(*) FROM lead_notes WHERE lead_id = $1)::int AS notes, (SELECT string_agg(coalesce(disposition, \'-\'), \',\') FROM call_history WHERE lead_id = $1) AS calls', [leadId])).rows[0];
  say(`call 1 finished: lead_notes rows ${rows.notes}; calls ${rows.calls}`);

  await sql.query("UPDATE leads SET status = 'in_queue', next_action_at = NULL, locked_by = NULL, locked_at = NULL WHERE id = $1", [leadId]);
  await p.goto(`${base}/call/${leadId}`);
  await p.waitForTimeout(5000);
  try {
    await p.getByRole('button', { name: /Previous Notes/ }).click({ timeout: 5000 });
  } catch (e) {
    say(`call 2: could not open Previous Notes (${e.message.split('\n')[0]}); page shows: ${(await p.innerText('body')).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  await p.waitForTimeout(1500);
  const text = await p.innerText('body');
  say(`call 2, Previous Notes: mid-call note shown = ${text.includes(NOTE)}; call 1's disposition note shown = ${text.includes(DISPO_NOTE)}; labels: Note ×${await p.getByText('Note', { exact: true }).count()}, Call ×${await p.getByText('Call', { exact: true }).count()}`);
  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await b.close();
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
