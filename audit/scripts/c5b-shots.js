// C5B gate screenshots, both themes: the ASK drawer with an answer (stubbed
// Groq, see c5b-groq-stub.js), the lead page's AI SUMMARY, and the
// not-configured state (run once more with the assistant switched off).
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c5b-shots.js --lead <id> [--only notconfigured] [--themes ink,paper]
// The app's 100 requests/minute limit can be reached by two themes in a row: run one theme a minute.
// Saves to audit/screenshots/c5b/<theme>-<shot>.jpg; prints console errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const password = process.env.AUDIT_PASSWORD;
const lead = arg('lead');
const only = arg('only');
const outDir = path.join(__dirname, '..', 'screenshots', 'c5b');
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
    await page.fill('input[type=password]', password);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    const shot = async (name) => page.screenshot({ path: path.join(outDir, `${theme}-${name}.jpg`), quality: 70, type: 'jpeg' });

    if (only !== 'notconfigured') {
      await page.goto(`${base}/leads`);
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      await page.getByTestId('assistant-panel').waitFor();
      await shot('ask-empty');
      await page.getByRole('button', { name: 'Who should I call first today?' }).click();
      await page.getByTestId('assistant-answer').waitFor();
      await shot('ask-answer');
      await page.goto(`${base}/leads/${lead}`);
      await page.getByTestId('lead-summary').getByRole('button', { name: 'Generate' }).click();
      await page.getByText('Next step').waitFor();
      await page.getByTestId('lead-summary').scrollIntoViewIfNeeded();
      await shot('lead-summary');
      await page.goto(`${base}/settings#integrations`);
      await page.getByTestId('assistant-settings').scrollIntoViewIfNeeded();
      await shot('settings');
    } else {
      await page.goto(`${base}/leads/${lead}`);
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      await page.getByRole('button', { name: "What's overdue?" }).click();
      await page.getByTestId('assistant-not-configured').waitFor();
      await shot('ask-not-configured');
    }
    console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    await context.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
