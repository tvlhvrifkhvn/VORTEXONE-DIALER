// C7A gate: keeps Today, Leads (with at least 5 saved views), a lead page and
// Inbox open in two sets of tabs (8 pages, one logged-in user) for 3 minutes
// and prints the API requests per minute and every 429.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c7a-load.js --lead <id> [--minutes 3]
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const lead = arg('lead');
const minutes = Number(arg('minutes') || 3);

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await context.newPage();
  await login.goto(`${base}/login`);
  await login.fill('input[type=email]', email);
  await login.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await login.click('button[type=submit]');
  await login.waitForURL((u) => !u.pathname.startsWith('/login'));

  // At least 5 saved views in the active file.
  const views = await login.evaluate(async (apiBase) => {
    const token = localStorage.getItem('vortex_dialer_token');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Campaign-Id': localStorage.getItem('vortex.campaign') || '1' };
    const list = await (await fetch(`${apiBase}/views`, { headers })).json();
    const have = (list.views || []).length;
    const wanted = [{ state: 'CA' }, { state: 'TX' }, { status: 'new' }, { minAttempts: '1' }, { state: 'NY' }];
    for (let i = have; i < 5; i += 1) {
      await fetch(`${apiBase}/views`, { method: 'POST', headers, body: JSON.stringify({ name: `Load view ${i + 1}`, filters: wanted[i] }) });
    }
    return Math.max(have, 5);
  }, base.replace(':5173', ':4000') + '/api');
  await login.close();

  const perMinute = [];
  let current = 0;
  let tooMany = 0;
  context.on('request', (r) => {
    if (r.url().includes('/api/')) current += 1;
  });
  context.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() === 429) tooMany += 1;
  });
  const paths = ['/', '/leads', `/leads/${lead}`, '/inbox'];
  for (let tab = 0; tab < 2; tab += 1) {
    for (const p of paths) {
      const page = await context.newPage();
      await page.goto(`${base}${p}`);
    }
  }
  current = 0; // count steady state, after the first page loads
  for (let m = 1; m <= minutes; m += 1) {
    await new Promise((r) => setTimeout(r, 60000));
    perMinute.push(current);
    console.log(`minute ${m}: ${current} API requests (8 open pages, ${views} saved views)`);
    current = 0;
  }
  console.log(`max per minute: ${Math.max(...perMinute)} (limit 600); 429 responses: ${tooMany}`);
  await browser.close();
  process.exit(tooMany === 0 && Math.max(...perMinute) < 300 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
