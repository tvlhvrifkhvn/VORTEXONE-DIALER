// Frontend smoke test with the pre-installed Playwright Chromium.
// Visits every page, saves one screenshot per page to audit/screenshots/,
// logs console errors and every 4xx/5xx response, and runs a few targeted
// interactions. Usage: node audit/scripts/ui-smoke.js http://localhost:5173 <leadId> <dialableLeadId>
const { chromium } = require('playwright');
const path = require('path');
const [base, leadId, dialId] = process.argv.slice(2);
const shots = path.resolve(__dirname, '../screenshots');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  let current = 'start';
  const log = {};
  const rec = (k, v) => ((log[current] ||= { console: [], http: [] })[k].push(v));
  page.on('console', (m) => { if (m.type() === 'error') rec('console', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => rec('console', 'pageerror: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) rec('http', `${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  const out = (s) => console.log(s);
  const visit = async (name, url, wait = 2500) => {
    current = name; log[name] ||= { console: [], http: [] };
    await page.goto(base + url); await page.waitForTimeout(wait);
    await page.screenshot({ path: `${shots}/10-${name}.png` });
    const text = (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 260);
    out(`\n### ${name} (${url}) -> final URL ${page.url().replace(base, '')}\n  text: ${text}`);
  };

  // unauthenticated redirect
  await visit('unauth-root', '/', 1500);
  // login
  current = 'login';
  await page.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await page.fill('input[type=password]', 'ChangeMe123!');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  out(`\n### login -> ${page.url().replace(base, '')}`);

  await visit('dashboard', '/', 3000);
  // dashboard widgets
  const ph = await page.$$eval('input', (els) => els.map((e) => e.placeholder).filter(Boolean));
  out(`  inputs: ${ph.join(' | ')}`);
  out(`  checkboxes: ${await page.locator('input[type=checkbox]').count()}  clock: ${/(EST|EDT)\s*\d/.test(await page.innerText('header').catch(() => '')) }`);
  out(`  pagination buttons: ${await page.locator('button', { hasText: /^(Next|Previous)$/ }).count()}`);
  // checkbox select-all
  const selAll = page.locator('[aria-label="Select page"], [title="Select page"]').first();
  if (await selAll.count()) { await selAll.click(); await page.waitForTimeout(400); out(`  after select-all: checked=${await page.locator('input[type=checkbox]:checked').count()} body mentions selected: ${/selected/i.test(await page.innerText('body'))}`); await selAll.click(); }
  // pagination
  const next = page.locator('button', { hasText: /^Next$/ }).first();
  if (await next.count()) { const before = (await page.innerText('body')).match(/Showing[^.|]*/)?.[0]; await next.click(); await page.waitForTimeout(1500); out(`  pagination: before="${before}" after="${(await page.innerText('body')).match(/Showing[^.|]*/)?.[0]}"`); }
  // state sidebar
  const tx = page.locator('button', { hasText: /^TX/ }).first();
  if (await tx.count()) { await tx.click(); await page.waitForTimeout(1500); out(`  state sidebar TX click: "${(await page.innerText('body')).match(/\d[\d,]* leads?/)?.[0]}"`); }
  // global search
  const search = page.locator('input[placeholder*="Search all leads"]').first();
  if (await search.count()) { await search.fill('Lia Lane'); await page.waitForTimeout(1500); out(`  global search 'Lia Lane' dropdown shows it: ${(await page.innerText('body')).includes('Lia Lane')}`); await search.fill(''); }
  // dark mode persistence
  const darkBtn = page.locator('[title="Switch to dark mode"], [aria-label="Switch to dark mode"]').first();
  if (await darkBtn.count()) {
    await darkBtn.click(); await page.waitForTimeout(300);
    const on = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.reload(); await page.waitForTimeout(2000);
    const after = await page.evaluate(() => [document.documentElement.classList.contains('dark'), localStorage.getItem('vortex_dialer_theme')]);
    out(`  dark mode: toggled=${on} after reload dark=${after[0]} localStorage=${after[1]}`);
    await page.screenshot({ path: `${shots}/10-dashboard-dark.png` });
    const lightBtn = page.locator('[title*="light mode" i], [aria-label*="light mode" i]').first(); if (await lightBtn.count()) await lightBtn.click();
  }

  await visit('lead-detail', `/leads/${leadId}`);
  await visit('inbox', '/inbox');
  await visit('sms-templates', '/sms/templates');
  await visit('import', '/import');
  await visit('reports', '/reports', 3500);
  out(`  monthly banner shown: ${await page.locator('[data-testid="recalibration-banner"]').count() > 0}`);
  await visit('settings', '/settings');
  await visit('dialer', '/dialer');
  await visit('manual-dial', '/call/manual', 1500);
  // dial pad paste
  const inp = page.locator('main input').first();
  if (await inp.count()) {
    await inp.focus();
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '+1 (305) 555-0138'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await page.waitForTimeout(300); out(`  dial pad after paste "+1 (305) 555-0138": "${await inp.inputValue()}"`);
  }
  await visit('call-screen', `/call/${dialId}`, 5000);
  const grid = await page.$$eval('button', (b) => b.map((x) => (x.getAttribute('title') || x.innerText || '').trim()).filter(Boolean));
  out(`  buttons: ${grid.slice(0, 40).join(' / ').slice(0, 600)}`);
  // keyboard shortcut: N = No answer (per the on-screen legend)
  await page.keyboard.press('n'); await page.waitForTimeout(1500);
  out(`  after pressing 'n': ${(await page.innerText('body')).match(/Logged as[^|.]*|No answer[^|]{0,40}/i)?.[0] || '(no visible change)'}`);
  await page.screenshot({ path: `${shots}/10-call-screen-after-shortcut.png` });
  await visit('unknown-route', '/this-does-not-exist', 1500);

  console.log('\n===== console errors and 4xx/5xx per page =====');
  for (const [k, v] of Object.entries(log)) console.log(`${k}: console=${v.console.length} http=${v.http.length}${v.console.length ? '\n   console: ' + [...new Set(v.console)].join('\n   console: ') : ''}${v.http.length ? '\n   http: ' + [...new Set(v.http)].join('\n   http: ') : ''}`);
  await browser.close();
})();
