// C7D gate: the lead page in three columns with a full timeline, both themes
// (1440×900), at phone width (390×844, full page), and the 1280×720 check that
// CALL is visible without scrolling. Also: ADD TASK focuses the task form and
// SMS opens the composer above the timeline.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c7d-shots.js --lead <id>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const lead = arg('lead');
const outDir = path.join(__dirname, '..', 'screenshots', 'c7d');
fs.mkdirSync(outDir, { recursive: true });

async function open(browser, viewport, theme) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((t) => localStorage.setItem('vortex.theme', t), theme);
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${base}/leads/${lead}`);
  await page.getByTestId('lead-top-bar').waitFor();
  await page.waitForTimeout(1200);
  return { context, page };
}

(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  for (const theme of ['ink', 'paper']) {
    const { context, page } = await open(browser, { width: 1440, height: 900 }, theme);
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.screenshot({ path: path.join(outDir, `${theme}-lead.jpg`), quality: 70, type: 'jpeg' });
    if (theme === 'ink') {
      await page.getByTestId('lead-top-bar').getByRole('button', { name: 'SMS', exact: true }).click();
      await page.getByTestId('draft-sms').waitFor();
      await page.screenshot({ path: path.join(outDir, 'ink-lead-sms.jpg'), quality: 70, type: 'jpeg' });
      await page.getByTestId('lead-top-bar').getByRole('button', { name: 'Add task', exact: true }).click();
      await page.waitForTimeout(300);
      const focused = await page.evaluate(() => Boolean(document.activeElement && document.getElementById('lead-work-tasks')?.contains(document.activeElement)));
      console.log(`ADD TASK focuses the task form: ${focused ? 'yes' : 'NO (fail)'}`);
      if (!focused) fail += 1;
    }
    const pageScrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 1);
    console.log(`${theme}: page scrolls ${pageScrolls ? 'YES (fail)' : 'no'}; ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    if (pageScrolls) fail += 1;
    await context.close();
  }
  // CALL visible without scrolling at 1280×720.
  {
    const { context, page } = await open(browser, { width: 1280, height: 720 }, 'ink');
    const box = await page.getByTestId('lead-top-bar').getByRole('button', { name: 'Call', exact: true }).boundingBox();
    const visible = box && box.y >= 0 && box.y + box.height <= 720 && box.x + box.width <= 1280;
    console.log(`1280×720: CALL at y=${box ? Math.round(box.y) : '?'} → ${visible ? 'visible without scrolling' : 'NOT visible (fail)'}`);
    if (!visible) fail += 1;
    await page.screenshot({ path: path.join(outDir, 'ink-lead-1280x720.jpg'), quality: 70, type: 'jpeg' });
    await context.close();
  }
  // Phone width.
  {
    const { context, page } = await open(browser, { width: 390, height: 844 }, 'ink');
    await page.screenshot({ path: path.join(outDir, 'ink-lead-phone.jpg'), quality: 70, type: 'jpeg', fullPage: true });
    console.log('phone: saved (full page)');
    await context.close();
  }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
