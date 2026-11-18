// C7B gate: every Settings section and every Files tab, both themes, at
// 1440×900, plus Settings at phone width (390×844). On desktop it also checks
// the Block 3 rule: the browser page itself doesn't scroll (each region does).
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c7b-shots.js [--themes ink,paper]
// Saves to audit/screenshots/c7b/<theme>-<shot>.jpg.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const themes = (arg('themes') || 'ink,paper').split(',');
const outDir = path.join(__dirname, '..', 'screenshots', 'c7b');
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  ['profile', '/settings'],
  ['dialing', '/settings/dialing'],
  ['reporting-day', '/settings/reporting-day'],
  ['files-basics', '/settings/files?tab=basics'],
  ['files-script', '/settings/files?tab=script'],
  ['files-stages', '/settings/files?tab=stages'],
  ['files-fields', '/settings/files?tab=fields'],
  ['files-new', '/settings/files?file=new'],
  ['objections', '/settings/objections'],
  ['integrations', '/settings/integrations'],
  ['spend-limits', '/settings/spend-limits'],
  ['activity', '/settings/activity'],
  ['old-campaigns-link', '/settings/campaigns'],
  ['old-hash-link', '/settings#spend-limits'],
];

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript((t) => localStorage.setItem('vortex.theme', t), theme);
    const page = await login(context);
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const [name, url] of SHOTS) {
      await page.goto(`${base}${url}`);
      await page.waitForSelector('[data-testid^="settings-"]');
      await page.waitForTimeout(400);
      const where = new URL(page.url()).pathname;
      const pageScrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 1);
      if (pageScrolls) failures += 1;
      await page.screenshot({ path: path.join(outDir, `${theme}-${name}.jpg`), quality: 70, type: 'jpeg' });
      console.log(`${theme.padEnd(5)} ${name.padEnd(18)} → ${where.padEnd(24)} page scrolls: ${pageScrolls ? 'YES (fail)' : 'no'}`);
    }
    console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    await context.close();
  }
  // Phone width: the rails stack under the main column and the page scrolls.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await login(phone);
  await page.goto(`${base}/settings/files`);
  await page.waitForSelector('[data-testid^="settings-"]');
  await page.screenshot({ path: path.join(outDir, 'ink-phone-settings.jpg'), quality: 70, type: 'jpeg', fullPage: true });
  console.log('phone  settings/files saved (full page)');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
