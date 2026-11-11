// Counts POST /api/calls requests made by ONE visit to the call screen under `vite dev` (React StrictMode).
// Usage: node audit/scripts/ui-strictmode.js http://localhost:5173 <leadId>
const { chromium } = require('playwright');
(async () => { const [base, id] = process.argv.slice(2); const b = await chromium.launch(); const p = await (await b.newContext()).newPage(); const posts = [];
  p.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/calls')) posts.push(r.postData()); });
  await p.goto(base + '/login'); await p.fill('input[type=email]', 'vortexoneagency@gmail.com'); await p.fill('input[type=password]', 'ChangeMe123!'); await p.click('button[type=submit]'); await p.waitForTimeout(2000);
  await p.goto(`${base}/call/${id}`); await p.waitForTimeout(7000);
  console.log('POST /api/calls requests sent by one visit to /call/' + id + ':', posts.length, JSON.stringify(posts));
  console.log('status shown at 7s:', ((await p.innerText('body')).match(/Ringing…|Connected|Call ended|No answer|Voicemail/) || ['?'])[0]);
  await b.close(); })();
