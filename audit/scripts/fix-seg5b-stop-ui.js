// Segment 5 B.4 UI check: a manual Stop on the multi-line screen keeps the
// call the rep is talking on, lets them log it, then shows the summary.
// Mock forced to answered (stub): 3 lines → 1 active + 2 held.
// Usage: DB=<db> AUDIT_PASSWORD=<pw> node fix-seg5b-stop-ui.js <frontendBase>
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base] = process.argv.slice(2);
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const q = async (s) => (await sql.query(s)).rows;
const say = (s) => console.log(s);

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
  await p.getByRole('button', { name: '3', exact: true }).click();
  await p.getByRole('button', { name: /Start dialing session/ }).click();
  await p.waitForTimeout(7000);
  const calls = async () =>
    (await q("SELECT id, telephony_state, ended_at IS NOT NULL AS ended, was_abandoned, coalesce(disposition,'-') AS disp FROM call_history ORDER BY id"))
      .map((c) => `${c.id}:${c.telephony_state}${c.ended ? '/ended' : '/open'}${c.was_abandoned ? '/abandoned' : ''}/${c.disp}`)
      .join(' ');
  say(`before Stop: ${await calls()}`);
  await p.getByRole('button', { name: 'End session' }).click();
  await p.waitForTimeout(2000);
  const body = await p.innerText('body');
  say(`after Stop: banner "Dialing stopped. Finish the call you're on" shown = ${/Dialing stopped\. Finish the call you're on/.test(body)}; summary already open = ${/Session summary/.test(body)}; End session button still shown = ${(await p.getByRole('button', { name: 'End session' }).count()) > 0}`);
  say(`after Stop: ${await calls()}`);
  await p.locator('button', { hasText: /^Spoke \/ Interested$/ }).first().click();
  await p.waitForTimeout(3000);
  const body2 = await p.innerText('body');
  say(`after logging the kept call: summary shown = ${/Session summary/.test(body2)}; abandoned note: "${(body2.match(/\d+ calls? (was|were) abandoned[^\n]*/) || ['(none)'])[0]}"`);
  say(`after logging: ${await calls()}`);
  const s = await q("SELECT count(*)::int AS open FROM dialing_sessions WHERE ended_at IS NULL");
  const l = await q("SELECT count(*)::int AS n FROM leads WHERE status = 'in_progress'");
  say(`DB: open dialing sessions ${s[0].open}; leads in_progress ${l[0].n}; page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await b.close();
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
