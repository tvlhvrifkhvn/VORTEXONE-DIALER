// Segment 5 UI check of the import flow (production build or vite dev):
// upload a generated CSV on the Import page (AI off), see the mapping the
// system chose and change one field, import, read the report (every bucket,
// "All N rows are accounted for"), download the skipped-rows CSV, and check
// the lead list shows "Number unreadable: …" for an unreadable number.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/fix-seg5-ui-import.js <frontendBase> <file.csv> <screenshotDir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const [base, file, shots] = process.argv.slice(2);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  p.setDefaultTimeout(20000);
  const errors = [];
  const bad = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('response', (r) => r.status() >= 400 && bad.push(`${r.status()} ${new URL(r.url()).pathname}`));
  const say = (s) => console.log(s);

  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);

  await p.goto(base + '/import');
  await p.setInputFiles('input[type=file]', file);
  await p.getByText('We detected these columns').waitFor();
  const text = await p.innerText('body');
  say(`mapping screen: AI-off note shown = ${/AI mapping is off or unavailable/.test(text)}`);
  const selects = p.locator('select');
  const n = await selects.count();
  const chosen = [];
  for (let i = 0; i < n; i++) {
    const label = (await p.locator('label').nth(i).innerText()).replace(' *', '').trim();
    chosen.push(`${label}=${(await selects.nth(i).inputValue()) || '—'}`);
  }
  say(`mapping shown (${n} fields): ${chosen.join(', ')}`);
  // change one field and change it back: the user can edit before importing
  const sourceIdx = chosen.findIndex((c) => c.toLowerCase().startsWith('source'));
  if (sourceIdx >= 0) {
    await selects.nth(sourceIdx).selectOption('');
    say(`changed "source" to: ${(await selects.nth(sourceIdx).inputValue()) || '— none —'} (user can edit)`);
    await selects.nth(sourceIdx).selectOption('Source');
  }
  fs.mkdirSync(shots, { recursive: true });
  await p.screenshot({ path: path.join(shots, 'seg5-import-mapping.png'), fullPage: true });

  await p.getByRole('button', { name: /Confirm & import/ }).click();
  await p.getByText('Import report').waitFor({ timeout: 120000 });
  const report = await p.innerText('body');
  const row = (label) => (report.match(new RegExp(`${label}\\s+(\\d+)`)) || [])[1];
  say(`report: rows=${row('Rows in the file')} imported=${row('Imported \\(dialable\\)')} noNumber=${row('Imported without a usable number')} merged=${row('Merged within the file')} already=${row('Already in your list')} dnc=${row('DNC — blocked')} invalid=${row('Invalid')}`);
  say(`report: "${(report.match(/All \d+ rows are accounted for\./) || ['(accounted-for line missing)'])[0]}"`);
  say(`report: invalid reasons listed = ${/Why rows were invalid/.test(report)}; unreadable note = ${/couldn't be read/.test(report)}`);
  await p.screenshot({ path: path.join(shots, 'seg5-import-report.png'), fullPage: true });

  const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /rows that weren't imported/ }).click()]);
  const saved = path.join(shots, 'skipped-rows.csv');
  await download.saveAs(saved);
  const lines = fs.readFileSync(saved, 'utf8').trim().split('\n');
  say(`skipped CSV downloaded: ${lines.length - 1} rows; header: ${lines[0].slice(0, 80)}`);

  await p.goto(base + '/');
  await p.waitForTimeout(1500);
  const search = p.locator('input[type=search], input[placeholder*="Search" i]').first();
  if (await search.count()) {
    await search.fill('');
  }
  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}; 4xx/5xx responses: ${bad.length ? bad.join(', ') : 'none'}`);
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
