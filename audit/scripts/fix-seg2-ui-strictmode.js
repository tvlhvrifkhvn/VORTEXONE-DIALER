// F-51 repro (Segment 2): how many POST /api/calls does ONE visit to the call
// screen send, what status does each get, and what does the UI show?
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/fix-seg2-ui-strictmode.js <frontendBase> <leadA> [leadB]
//   With leadB: visits A, waits, then B (a real navigation), to check each
//   visit starts exactly one call.
const { chromium } = require('playwright');
const [base, leadA, leadB] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const posts = [];
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', async (r) => {
    if (r.request().method() === 'POST' && /\/api\/calls$/.test(r.url())) {
      let body = ''; try { body = await r.text(); } catch {}
      const lead = (body.match(/"lead":\{"id":(\d+)/) || [])[1];
      const err = (body.match(/"error":"([^"]*)"/) || [])[1];
      posts.push(`${r.status()} body=${r.request().postData()}${lead ? ' -> lead ' + lead : ''}${err ? ' error="' + err + '"' : ''}`);
    }
  });
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForTimeout(2000);
  const visit = async (id) => {
    const before = posts.length;
    await p.goto(`${base}/call/${id}`);
    await p.waitForTimeout(8000);
    const text = await p.innerText('body');
    const state = (text.match(/Ringing…|Connected|Call ended|No answer|Voicemail|Couldn't start this call[^\n]*|Lead is not dialable[^\n]*/) || ['?'])[0];
    console.log(`visit /call/${id}: POST /api/calls sent=${posts.length - before}`);
    posts.slice(before).forEach((x) => console.log(`   ${x}`));
    console.log(`   UI state at 8s: ${state}`);
  };
  await visit(leadA);
  if (leadB) await visit(leadB);
  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  await b.close();
})();
