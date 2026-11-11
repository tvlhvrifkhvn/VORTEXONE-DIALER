// Variant of ui-ratelimit.js: WAIT_MS controls when the disposition is clicked.
// Opens the call screen on an ANSWERED mock call (forced via the force-outcome
// stub) and stays there ~75s like a rep in a real conversation, counting API
// responses by status; then clicks a disposition button and reports what
// happened. Usage: node audit/scripts/ui-ratelimit.js http://localhost:5173 <leadId> [screenshotPath]
const { chromium } = require('playwright');
const [base, leadId, shot] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const t0 = Date.now();
  const counts = {};
  let first429 = null;
  const calls = {};
  p.on('response', (r) => {
    if (!r.url().includes('/api/')) return;
    const s = r.status();
    counts[s] = (counts[s] || 0) + 1;
    const k = r.request().method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').replace(/\d+/g, ':n').replace(/\?.*/, '');
    calls[k] = (calls[k] || 0) + 1;
    if (s === 429 && !first429) first429 = `${((Date.now() - t0) / 1000).toFixed(0)}s (${k})`;
  });
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', 'ChangeMe123!');
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);
  await p.goto(`${base}/call/${leadId}`);
  await p.waitForTimeout(6000);
  console.log('state at 6s:', ((await p.innerText('body')).match(/Ringing…|Connected|Answered|Live/) || ['?'])[0]);
  await p.waitForTimeout(Number(process.env.WAIT_MS || 69000));
  console.log('API responses by status over ~77s:', JSON.stringify(counts), '| first 429 at', first429);
  console.log('API calls by endpoint:', JSON.stringify(calls));
  const btn = p.locator('button', { hasText: /^Spoke \/ Interested$/ }).first();
  const respP = p.waitForResponse((r) => r.url().includes('/api/dispositions'), { timeout: 5000 }).catch(() => null);
  await btn.click();
  const resp = await respP;
  await p.waitForTimeout(1200);
  console.log('click "Spoke / Interested" -> POST /api/dispositions', resp ? resp.status() : 'no request', resp ? (await resp.text()).slice(0, 120) : '');
  console.log('visible after click:', ((await p.innerText('body')).match(/Logged as[^\n]*|Too many requests[^\n]*|Something went wrong[^\n]*/) || ['(nothing)'])[0]);
  if (shot) await p.screenshot({ path: shot });
  await b.close();
})();
