// C8F gate screenshots: the dial pad before a call (RECENT), during a call
// (a number that belongs to a lead: the lead, NOTES saving, the RECORD
// reminder, REC on) and after it (a number with no lead: SAVE AS LEAD), both
// themes, 1440×900. Checks: nothing scrolls during a call, NOTES says Saved.
// The mock answers about a third of calls; a call that doesn't connect is
// redialed (up to 12 tries).
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c8f-shots.js --lead-phone 4155550101 [--themes ink,paper]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const leadPhone = (arg('lead-phone') || '').replace(/\D/g, '').slice(-10);
const outDir = path.join(__dirname, '..', 'screenshots', 'c8f');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (const theme of (arg('themes') || 'ink,paper').split(',')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript((t) => {
      localStorage.setItem('vortex.theme', t);
      localStorage.removeItem('vortex.recordConsentAck');
    }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${base}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    const shot = async (name) => {
      await page.mouse.move(700, 895);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, `${theme}-${name}.jpg`), quality: 72, type: 'jpeg' });
    };
    const scrolls = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

    await page.goto(`${base}/call/manual`);
    await page.getByTestId('dial-recent').waitFor();
    await page.waitForTimeout(600);
    await shot('before');

    // During: a lead's number, until the mock connects.
    let connected = false;
    for (let i = 0; i < 12 && !connected; i += 1) {
      await page.getByLabel('Phone number').fill(leadPhone);
      await page.getByTestId('dial-pad').getByRole('button', { name: /^Call$/ }).click();
      await page.getByTestId('dial-status').waitFor();
      connected = await page.getByText(/^Connected$/i).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
      if (!connected) {
        await page.getByRole('button', { name: /^New call$/ }).click({ timeout: 10000 }).catch(async () => {
          await page.getByRole('button', { name: /^Hang up$/ }).click();
          await page.getByRole('button', { name: /^New call$/ }).click();
        });
      }
    }
    if (!connected) throw new Error('the mock never connected');
    await page.getByRole('button', { name: '2 ABC' }).click();
    await page.getByRole('button', { name: 'Pound' }).click();
    await page.getByLabel('Call notes').fill('Asked for pricing; call back Tuesday.');
    await page.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: /^Record$/ }).click();
    await page.getByText('Recording laws differ by state', { exact: false }).waitFor();
    await shot('record-reminder');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.waitForTimeout(500);
    const during = await scrolls();
    if (during > 0) failed = true;
    console.log(`${theme} during a call: page scroll ${during}px → ${during > 0 ? 'FAIL' : 'PASS'}`);
    await shot('during');
    await page.getByRole('button', { name: /^Hang up$/ }).click();
    await page.waitForTimeout(800);
    await shot('after-lead');
    await page.getByRole('button', { name: /^New call$/ }).click();

    // After: a number without a lead.
    await page.getByLabel('Phone number').fill('2125550199');
    await page.getByTestId('dial-pad').getByRole('button', { name: /^Call$/ }).click();
    await page.getByTestId('dial-status').waitFor();
    await page.getByLabel('Call notes').fill('New prospect, owns a team of 6.');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^Hang up$/ }).click({ timeout: 4000 }).catch(() => {});
    await page.getByRole('button', { name: /^New call$/ }).waitFor();
    await page.getByRole('button', { name: /^Save as lead$/ }).click();
    await shot('after-save-as-lead');
    console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    await context.close();
  }
  await browser.close();
  if (failed) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
