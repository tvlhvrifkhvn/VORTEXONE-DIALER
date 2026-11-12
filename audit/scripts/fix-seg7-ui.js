// Segment 7 browser check (production build): the Dashboard's "Dials today" /
// "Contacts today" cards, the Reports page for today and for a From/To range,
// and the Settings "Reporting day" section.
// Usage: AUDIT_PASSWORD=<pw> node fix-seg7-ui.js <frontendBase> <from> <to>
const { chromium } = require('playwright');
const [base, from, to] = process.argv.slice(2);
const say = (s) => console.log(s);
const card = (body, label) => {
  const m = body.match(new RegExp(`${label}\\s*\\n\\s*([0-9]+%?)`, 'i'));
  return m ? m[1] : '(not shown)';
};
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ timezoneId: 'UTC' })).newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const bad = [];
  p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(base, '')}`); });
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForTimeout(2000);
  let body = await p.innerText('body');
  say(`dashboard: Dials today ${card(body, 'Dials today')}, Contacts today ${card(body, 'Contacts today')}, Connect rate ${card(body, 'Connect rate')}; goal text: ${(body.match(/\d+ \/ \d+ dials today/) || ['-'])[0]}`);
  await p.goto(base + '/reports');
  await p.waitForTimeout(2000);
  body = await p.innerText('body');
  const label = async () => ((await p.getByTestId('report-period').count()) ? await p.getByTestId('report-period').innerText() : '(no period line)');
  say(`reports, today: period "${await label()}"; Dials ${card(body, 'Dials(?: today)?')}, Contacts ${card(body, 'Contacts(?: today)?')}`);
  if (await p.getByLabel('From', { exact: true }).count()) {
    await p.getByLabel('From', { exact: true }).fill(from);
    await p.getByLabel('To', { exact: true }).fill(to);
    await p.getByRole('button', { name: 'Show' }).click();
    await p.waitForTimeout(1500);
    body = await p.innerText('body');
    say(`reports, ${from} -> ${to}: period "${await label()}"; Dials ${card(body, 'Dials')}, Contacts ${card(body, 'Contacts')}, Connect rate ${card(body, 'Connect rate')}`);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Download PDF' }).click()]);
    say(`reports, Download PDF for the range: file ${dl.suggestedFilename()}`);
    await dl.saveAs(process.env.PDF_OUT);
  } else say('reports: no From/To picker');
  await p.goto(base + '/settings');
  await p.waitForTimeout(1500);
  const tz = await p.locator('#reporting-timezone').count() ? await p.locator('#reporting-timezone').inputValue() : '(no field)';
  const ds = await p.locator('#day-start-time').count() ? await p.locator('#day-start-time').inputValue() : '(no field)';
  say(`settings: Reporting timezone "${tz}", Day starts at "${ds}"`);
  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}; 4xx/5xx: ${bad.length ? bad.join(' | ') : 'none'}`);
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
