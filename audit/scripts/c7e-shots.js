// C7E gate: the pipeline board with a search that has results in at least two
// columns, both themes, and the check that the page itself doesn't scroll
// (the board scrolls sideways, each column on its own).
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c7e-shots.js --search <text>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const term = arg('search') || 'realty';
const outDir = path.join(__dirname, '..', 'screenshots', 'c7e');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  for (const theme of ['ink', 'paper']) {
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
    await page.goto(`${base}/pipeline`);
    await page.getByTestId('pipeline-board').waitFor();
    if (theme === 'ink') await page.screenshot({ path: path.join(outDir, 'ink-board.jpg'), quality: 70, type: 'jpeg' });
    await page.getByLabel('Search the board').fill(term);
    await page.waitForResponse((r) => r.url().includes('/pipeline/board') && r.url().includes('search='));
    await page.waitForTimeout(400);
    const columnsWithCards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="pipeline-board"] > section')].filter((s) => s.querySelectorAll('li[draggable]').length > 0).length
    );
    const pageScrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 1);
    await page.screenshot({ path: path.join(outDir, `${theme}-search.jpg`), quality: 70, type: 'jpeg' });
    console.log(`${theme}: "${term}" → cards in ${columnsWithCards} columns${columnsWithCards >= 2 ? '' : ' (fail: need 2)'}; page scrolls ${pageScrolls ? 'YES (fail)' : 'no'}; ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    if (columnsWithCards < 2 || pageScrolls) fail += 1;
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.waitForTimeout(800);
    await context.close();
  }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
