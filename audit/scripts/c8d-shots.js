// C8D gate screenshots: the pipeline board (normal, searching, while
// dragging), every Settings section and every Files tab; both themes, at
// 1440×900 and 1280×720. Checks: no browser scrollbar; on the board, every
// column is as tall as the board, the board doesn't scroll vertically, and
// all cards share one height.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c8d-shots.js [--themes ink,paper] [--search <text>]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const outDir = path.join(__dirname, '..', 'screenshots', 'c8d');
fs.mkdirSync(outDir, { recursive: true });
const SECTIONS = ['profile', 'dialing', 'reporting-day', 'files', 'objections', 'integrations', 'spend-limits', 'activity'];
const TABS = ['basics', 'script', 'stages', 'fields'];

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

    const scrolls = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight > 0 || document.documentElement.scrollWidth - window.innerWidth > 0);
    const shot = async (name, w, h) => {
      await page.mouse.move(w / 2, h - 5);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, `${theme}-${w}-${name}.jpg`), quality: 70, type: 'jpeg' });
      if (await scrolls()) {
        failed = true;
        console.log(`${theme} ${w}x${h} ${name}: PAGE SCROLLS`);
      }
    };

    for (const [w, h] of [
      [1440, 900],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${base}/pipeline`);
      await page.getByTestId('pipeline-board').waitFor();
      await page.waitForTimeout(800);
      const b = await page.evaluate(() => {
        const board = document.querySelector('[data-testid="pipeline-board"]');
        const bh = board.getBoundingClientRect().height;
        const cols = [...board.querySelectorAll('[data-testid="pipeline-column"]')].map((c) => Math.round(c.getBoundingClientRect().height));
        const cards = new Set([...board.querySelectorAll('[data-testid="pipeline-card"]')].map((c) => Math.round(c.getBoundingClientRect().height)));
        return { full: cols.every((c) => Math.abs(c - bh) <= 2), vscroll: board.scrollHeight > board.clientHeight, cards: [...cards], cols: cols.length };
      });
      const ok = b.full && !b.vscroll && b.cards.length <= 1;
      if (!ok) failed = true;
      console.log(`${theme} ${w}x${h} board: ${b.cols} columns full height ${b.full}, board scrolls vertically ${b.vscroll}, card heights ${b.cards.join('/')} → ${ok ? 'PASS' : 'FAIL'}`);
      await shot('pipeline', w, h);

      await page.getByLabel('Search the board').fill(arg('search') || 'realty');
      await page.waitForTimeout(900);
      await shot('pipeline-search', w, h);
      await page.getByRole('button', { name: 'Clear the search' }).click();
      await page.waitForTimeout(900);

      // While dragging: a dragover on the third column (the target gets the outline).
      await page.evaluate(() => {
        const cols = document.querySelectorAll('[data-testid="pipeline-column"]');
        const dt = new DataTransfer();
        dt.setData('application/x-vortex-lead', '1');
        cols[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
      await shot('pipeline-dragging', w, h);
      await page.evaluate(() => document.querySelectorAll('[data-testid="pipeline-column"]')[2].dispatchEvent(new DragEvent('dragleave', { bubbles: true })));

      for (const s of SECTIONS) {
        await page.goto(`${base}/settings/${s}`);
        await page.getByTestId(`settings-${s}`).waitFor();
        await page.waitForTimeout(500);
        await shot(`settings-${s}`, w, h);
      }
      for (const t of TABS) {
        await page.goto(`${base}/settings/files?tab=${t}`);
        await page.getByTestId('files-settings').waitFor();
        await page.waitForTimeout(500);
        await shot(`files-${t}`, w, h);
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
