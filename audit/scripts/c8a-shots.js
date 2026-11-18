// C8A gate screenshots: the one-row header at 1440 and 1180 wide, both themes,
// closed, with the user menu open and with the calling-hours popover open.
// Also checks that the header is one row (56px) and has no horizontal overflow.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c8a-shots.js [--themes ink,paper] [--widths 1440,1180]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const outDir = path.join(__dirname, '..', 'screenshots', 'c8a');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (const theme of (arg('themes') || 'ink,paper').split(',')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript((t) => localStorage.setItem('vortex.theme', t), theme);
    const page = await context.newPage();
    // Rates set and the file's budget at 85 %: the spend chip shows, in signal colors.
    await page.route('**/api/spend', (route) =>
      route.fulfill({
        json: {
          ratesSet: true,
          today: { cents: 340 },
          month: { cents: 5100, label: 'November 2026' },
          budgets: { campaign: { spent: 5100, budget: 6000, pct: 85 }, global: { spent: 5100, budget: 20000, pct: 26 } },
          perCampaign: [{ campaignId: 1, fileNumber: 1, name: 'Real Estate', today: 340, month: 5100, budget: 6000 }],
        },
      })
    );
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${base}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    for (const width of (arg('widths') || '1920,1680,1536,1440,1280,1180').split(',').map(Number)) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/`);
      await page.locator('header nav').waitFor();
      await page.waitForTimeout(600);
      const header = page.locator('header').first();
      const clip = async () => {
        const box = await header.boundingBox();
        return { x: 0, y: 0, width, height: Math.ceil(box.height) + 360 };
      };
      const shot = async (name) => {
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(outDir, `${theme}-${width}-${name}.jpg`), quality: 75, type: 'jpeg', clip: await clip() });
      };
      const m = await page.evaluate(() => {
        const h = document.querySelector('header');
        const row = h.firstElementChild;
        const kids = [...row.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
        const tops = new Set(kids.map((r) => Math.round(r.top + r.height / 2)));
        return { height: Math.round(h.getBoundingClientRect().height), centers: [...tops], overflow: row.scrollWidth - row.clientWidth, docOverflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      const oneRow = m.centers.length === 1 && m.height <= 57 && m.overflow <= 0 && m.docOverflow <= 0;
      if (!oneRow) failed = true;
      console.log(`${theme} ${width}: header ${m.height}px, centers ${m.centers.join('/')}, overflow ${m.overflow}/${m.docOverflow} → ${oneRow ? 'one row' : 'NOT ONE ROW'}`);
      await page.mouse.move(width / 2, 600);
      await shot('header');
      await page.getByRole('button', { name: /^Account/ }).click();
      await shot('user-menu');
      // Keyboard: ↓ moves inside the menu; Esc closes it and returns focus to the button.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      const menuOk = await page.evaluate(() => {
        const b = document.activeElement;
        return Boolean(b && /^Account/.test(b.getAttribute('aria-label') || '') && b.getAttribute('aria-expanded') === 'false');
      });
      if (!menuOk) failed = true;
      if (width === 1440) console.log(`${theme}: menu keyboard (↓, Esc → closed, focus on its button) ${menuOk ? 'PASS' : 'FAIL'}`);
      await page.getByRole('button', { name: /^Calling hours/ }).click();
      await shot('hours');
      await page.keyboard.press('Escape');
      if (width < 1280) {
        await page.getByRole('button', { name: 'Search all leads' }).click();
        await shot('search-open');
        await page.mouse.click(width / 2, 700);
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
