// C8B gate screenshots: Today; Leads with 3 rows selected, with the filters
// open and with the DIAL menu open; both themes, at 1440×900 and 1280×720.
// Each shot also checks that the browser has no scrollbar (the page itself
// doesn't scroll; the regions do) and prints the header-row button heights.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c8b-shots.js [--themes ink,paper]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const outDir = path.join(__dirname, '..', 'screenshots', 'c8b');
fs.mkdirSync(outDir, { recursive: true });

const SIZES = [
  [1440, 900],
  [1280, 720],
];

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

    const check = async (label) => {
      const m = await page.evaluate(() => ({
        v: document.documentElement.scrollHeight - window.innerHeight,
        h: document.documentElement.scrollWidth - window.innerWidth,
      }));
      const ok = m.v <= 0 && m.h <= 0;
      if (!ok) failed = true;
      console.log(`${label}: page scroll ${m.v}/${m.h} → ${ok ? 'no browser scrollbar' : 'SCROLLS'}`);
    };
    const shot = async (name, w, h) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, `${theme}-${w}-${name}.jpg`), quality: 72, type: 'jpeg' });
      await check(`${theme} ${w}x${h} ${name}`);
    };

    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${base}/`);
      await page.getByTestId('todo').waitFor();
      await page.waitForTimeout(800);
      await page.mouse.move(w / 2, h - 5);
      await shot('today', w, h);

      await page.goto(`${base}/leads`);
      await page.getByTestId('dial-button').waitFor();
      await page.waitForTimeout(800);
      if (w === 1440) {
        const heights = await page.evaluate(() =>
          ['dial-button'].map((id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().height)
            .concat([...document.querySelectorAll('[aria-label="Dialing options"], [aria-label="More lead actions"]')].map((b) => b.getBoundingClientRect().height))
            .concat([...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Import').map((b) => b.getBoundingClientRect().height))
        );
        console.log(`${theme}: header buttons ${heights.map(Math.round).join('/')} px`);
      }
      await shot('leads', w, h);

      await page.getByRole('button', { name: /^Filters/ }).click();
      await shot('leads-filters', w, h);
      await page.getByRole('button', { name: /^Filters/ }).click();

      await page.getByRole('button', { name: 'Dialing options' }).click();
      await shot('leads-dial-menu', w, h);
      await page.keyboard.press('Escape');

      const boxes = page.locator('tbody input[type=checkbox]');
      for (let i = 0; i < 3; i += 1) await boxes.nth(i).check();
      await page.getByTestId('selection-strip').waitFor();
      await page.mouse.move(w / 2, h - 5);
      await shot('leads-selected', w, h);
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
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
