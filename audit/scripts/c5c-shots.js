// C5C gate screenshots, one theme per run (the app's 100 requests/minute):
// the Today brief, an SMS and an email draft in the composer, and proposal
// cards in the ASK drawer. Groq is the local stub (c5b-groq-stub.js).
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c5c-shots.js --lead <id> --theme ink|paper
// Saves to audit/screenshots/c5c/<theme>-<shot>.jpg; prints console errors.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const lead = arg('lead');
const theme = arg('theme') || 'ink';
const outDir = path.join(__dirname, '..', 'screenshots', 'c5c');
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
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${theme}-${name}.jpg`), quality: 70, type: 'jpeg' });

  // The brief.
  await page.goto(`${base}/`);
  const brief = page.getByTestId('brief');
  await brief.getByRole('button', { name: 'Generate' }).click();
  await brief.getByText('Call first').waitFor();
  await brief.scrollIntoViewIfNeeded();
  await shot('brief');

  // Drafts in the composers.
  await page.goto(`${base}/leads/${lead}`);
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  const sms = page.getByTestId('draft-sms');
  await sms.getByRole('textbox').fill('follow up on our call');
  await sms.getByRole('button', { name: 'Draft with AI' }).click();
  await page.getByLabel('Message', { exact: true }).waitFor();
  await page.getByLabel('Message', { exact: true }).scrollIntoViewIfNeeded();
  await shot('draft-sms');
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.getByTestId('draft-email').getByRole('button', { name: 'Draft with AI' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Email body"]')?.value.length > 0);
  await page.getByLabel('Email body').scrollIntoViewIfNeeded();
  await shot('draft-email');

  // Proposal cards.
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByLabel('Your question').fill('Plan Karen');
  await page.getByLabel('Your question').press('Enter');
  await page.getByTestId('proposal-card').first().waitFor();
  await shot('proposals');
  await page.getByTestId('proposal-card').first().getByRole('button', { name: 'Confirm' }).click();
  await page.getByTestId('proposal-card').first().getByText('Done').waitFor();
  await page.getByTestId('proposal-card').nth(1).getByRole('button', { name: 'Dismiss' }).click();
  await shot('proposals-resolved');

  console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
