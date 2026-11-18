// C6B gate screenshots, one theme per run (the app's 100 requests/minute):
// the DUPLICATES view, the merge Dialog (field choices and what moves), and
// the merged lead's page. Needs at least one duplicate pair in the database.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c6b-shots.js --theme ink|paper [--merge]
// --merge also confirms the first pair and shoots the merged lead's page.
// Saves to audit/screenshots/c6b/<theme>-<shot>.jpg; prints console errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const theme = arg('theme') || 'ink';
const doMerge = argv.includes('--merge');
const outDir = path.join(__dirname, '..', 'screenshots', 'c6b');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((t) => localStorage.setItem('vortex.theme', t), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const shot = (name, full = false) => page.screenshot({ path: path.join(outDir, `${theme}-${name}.jpg`), quality: 70, type: 'jpeg', fullPage: full });

  await page.goto(`${base}/leads`);
  await page.getByRole('button', { name: 'Duplicates', exact: true }).click();
  await page.getByRole('button', { name: 'Review merge' }).first().waitFor();
  await page.getByTestId('duplicates').scrollIntoViewIfNeeded();
  await shot('duplicates');
  await page.getByRole('button', { name: 'Review merge' }).first().click();
  await page.getByText('What moves to').waitFor();
  await shot('merge-dialog');

  if (doMerge) {
    const keepName = await page.locator('[role=dialog] p.text-sm >> nth=0').innerText();
    await page.getByRole('dialog').getByRole('button', { name: 'Merge', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await shot('after-merge');
    console.log(`merged: ${keepName.slice(0, 80)}`);
  }
  console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
