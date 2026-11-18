// C8C gate screenshots: the lead page with a full timeline and each composer
// tab (NOTE · SMS · EMAIL · TASK · CALLBACK), both themes, at 1440×900 and
// 1280×720. Checks: no browser scrollbar, and CALL fully visible without
// scrolling at 1280×720.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c8c-shots.js --lead <id> [--themes ink,paper]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const lead = arg('lead');
if (!lead) {
  console.error('usage: --lead <id>');
  process.exit(2);
}
const outDir = path.join(__dirname, '..', 'screenshots', 'c8c');
fs.mkdirSync(outDir, { recursive: true });
const TABS = ['Note', 'SMS', 'Email', 'Task', 'Callback'];

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (const theme of (arg('themes') || 'ink,paper').split(',')) {
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

    for (const [w, h] of [
      [1440, 900],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${base}/leads/${lead}`);
      await page.getByTestId('lead-timeline').waitFor();
      await page.waitForTimeout(1200);
      const m = await page.evaluate(() => {
        const call = [...document.querySelectorAll('[data-testid="lead-top-bar"] button')].find((b) => b.textContent.trim() === 'Call');
        const r = call.getBoundingClientRect();
        return {
          v: document.documentElement.scrollHeight - window.innerHeight,
          h: document.documentElement.scrollWidth - window.innerWidth,
          call: r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
          rows: document.querySelectorAll('[data-testid="lead-timeline"] li').length,
        };
      });
      const ok = m.v <= 0 && m.h <= 0 && m.call;
      if (!ok) failed = true;
      console.log(`${theme} ${w}x${h}: page scroll ${m.v}/${m.h}, CALL visible ${m.call}, timeline rows ${m.rows} → ${ok ? 'PASS' : 'FAIL'}`);
      for (const tab of TABS) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.mouse.move(w / 2, h - 5);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(outDir, `${theme}-${w}-${tab.toLowerCase()}.jpg`), quality: 72, type: 'jpeg' });
      }
    }
    console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    await context.close();
  }
  await browser.close();
  if (failed) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
