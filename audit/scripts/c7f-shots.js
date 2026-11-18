// C7F gate screenshots (stubbed Groq: c5b-groq-stub.js): the ASK drawer with
// the grouped suggestions (YOUR DATA · HOW DO I · ADVICE), a how-do-I answer,
// a general-advice answer, and a WEB answer, in both themes.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c7f-shots.js [--themes ink,paper]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const outDir = path.join(__dirname, '..', 'screenshots', 'c7f');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
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
    const shot = async (name) => {
      await page.mouse.move(5, 5); // no hover state in the picture
      await page.waitForTimeout(250);
      return page.screenshot({ path: path.join(outDir, `${theme}-${name}.jpg`), quality: 70, type: 'jpeg' });
    };
    const answers = () => page.getByTestId('assistant-answer').count();

    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.getByTestId('assistant-panel').waitFor();
    await shot('suggestions');
    for (const [q, name] of [
      ['How do I add a task?', 'how-do-i'],
      ['How should I open a cold call to a real estate agent?', 'advice'],
    ]) {
      const before = await answers();
      await page.getByRole('button', { name: q }).click().catch(async () => {
        await page.getByLabel('Your question').fill(q);
        await page.getByLabel('Your question').press('Enter');
      });
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="assistant-answer"]').length > n, before);
      await shot(name);
      if (name === 'how-do-i') {
        await page.getByRole('button', { name: 'Clear', exact: true }).click();
      }
    }
    // WEB on: only the question goes out.
    await page.getByRole('button', { name: /^Web (off|on)$/ }).click();
    const before = await answers();
    await page.getByLabel('Your question').fill('When do real estate agents usually answer the phone?');
    await page.getByLabel('Your question').press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="assistant-answer"]').length > n, before);
    await shot('web');
    await page.getByRole('button', { name: /^Web (off|on)$/ }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    await context.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
