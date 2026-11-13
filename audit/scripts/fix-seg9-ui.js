// Segment 9 browser check (production build), owner = supervisor, rep2 = rep.
//   1. old browser-only values are moved to the server once (and never
//      overwrite a value the server already has)
//   2. settings saved in one browser profile show in another
//   3. Settings: the Groq key shows only "Configured ✓ (ending ····xxxx)";
//      a rep can't change global settings
// Usage: DB=<db> AUDIT_PASSWORD=<pw> node fix-seg9-ui.js <frontendBase>
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base] = process.argv.slice(2);
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const say = (s) => console.log(s);
const serverPrefs = async (email) => {
  try {
    const { rows } = await sql.query('SELECT key, value FROM user_settings WHERE user_id = (SELECT id FROM users WHERE email = $1) ORDER BY key', [email]);
    return rows.map((r) => `${r.key}=${String(r.value).slice(0, 30)}`).join(', ') || '(none)';
  } catch { return '(no user_settings table)'; }
};
const errors = [];
async function session(browser, email, password, localValues) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/login');
  if (localValues) await p.evaluate((v) => Object.entries(v).forEach(([k, val]) => localStorage.setItem(k, val)), localValues);
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', password);
  await p.click('button[type=submit]');
  await p.waitForTimeout(2500);
  return { ctx, p };
}
const goalText = async (p) => ((await p.innerText('body')).match(/\d+ \/ \d+ dials today/) || ['(not shown)'])[0];
const local = (p, k) => p.evaluate((key) => localStorage.getItem(key), k);

(async () => {
  await sql.connect();
  const b = await chromium.launch();
  const OWNER = 'vortexoneagency@gmail.com';
  const PW = process.env.AUDIT_PASSWORD;

  // 1. one-time move
  const a = await session(b, OWNER, PW, { vortex_dialer_daily_goal: '777', vortex_pitch_script: 'Local script from browser A', vortex_dialer_default_lines: '2' });
  await a.p.waitForTimeout(1000);
  say(`1a. browser A had local goal 777 / script / lines 2, server had none -> server now: ${await serverPrefs(OWNER)}; local goal left in A: ${await local(a.p, 'vortex_dialer_daily_goal')}; dashboard: ${await goalText(a.p)}`);
  const a2 = await session(b, OWNER, PW, { vortex_dialer_daily_goal: '555' });
  await a2.p.waitForTimeout(1000);
  say(`1b. browser A2 had local goal 555, server already 777 -> server now: ${await serverPrefs(OWNER)}; dashboard in A2: ${await goalText(a2.p)}`);
  await a2.ctx.close();

  // 2. save in A, read in B
  await a.p.goto(base + '/settings');
  await a.p.waitForTimeout(2000);
  const goalInput = a.p.locator('label:has-text("Default daily goal") + input, label:has-text("Default daily goal") ~ input').first();
  await goalInput.fill('321');
  await a.p.locator('label:has-text("Default simultaneous lines") ~ select').first().selectOption('1');
  await a.p.getByRole('button', { name: 'Save defaults' }).click();
  await a.p.waitForTimeout(1000);
  await a.p.locator('textarea').first().fill('Script saved in browser A');
  await a.p.getByRole('button', { name: 'Save script' }).click();
  await a.p.waitForTimeout(1000);
  say(`2a. saved in browser A (goal 321, lines 1, script) -> server: ${await serverPrefs(OWNER)}`);
  const bb = await session(b, OWNER, PW);
  say(`2b. a second browser profile B: dashboard ${await goalText(bb.p)}`);
  await bb.p.goto(base + '/settings');
  await bb.p.waitForTimeout(2000);
  say(`2c. B Settings: script box "${(await bb.p.locator('textarea').first().inputValue()).slice(0, 40)}", goal field ${await bb.p.locator('label:has-text("Default daily goal") ~ input').first().inputValue()}, lines ${await bb.p.locator('label:has-text("Default simultaneous lines") ~ select').first().inputValue()}`);

  // 3. key display + rep view
  const status = (await bb.p.getByTestId('groq-key-status').count()) ? await bb.p.getByTestId('groq-key-status').innerText() : '(no status line)';
  const keyField = await bb.p.locator('input[type=password]').last().inputValue();
  say(`3a. owner Settings: Groq key status "${status}"; key field holds a value: ${keyField.length > 0 ? `YES (${keyField.length} chars)` : 'no'}`);
  const r = await session(b, 'rep2@example.com', 'Rep2Pass!');
  await r.p.goto(base + '/settings');
  await r.p.waitForTimeout(2000);
  const dis = async (loc) => ((await loc.count()) ? String(await loc.first().isDisabled()) : '(not found)');
  say(`3b. rep Settings: calling-hours switch disabled: ${await dis(r.p.getByRole('switch', { name: '' }).or(r.p.locator('button[role=switch]')))}; max attempts disabled: ${await dis(r.p.locator('input[type=number][max="10"]'))}; Groq field disabled: ${await dis(r.p.locator('input[type=password]'))}; reporting timezone disabled: ${await dis(r.p.locator('#reporting-timezone'))}`);
  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await b.close();
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
