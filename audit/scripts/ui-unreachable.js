// Loads the built frontend with the backend STOPPED, submits the login form,
// and prints the error text the user sees. Usage: node audit/scripts/ui-unreachable.js http://localhost:4173
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const failed = [];
  p.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`));
  await p.goto(process.argv[2] + '/login');
  await p.fill('input[type=email]', 'vortexoneagency@gmail.com');
  await p.fill('input[type=password]', 'whatever');
  await p.click('button[type=submit]');
  await p.waitForTimeout(2000);
  const body = (await p.innerText('body')).replace(/\n+/g, ' | ');
  console.log('visible text after submit:', body);
  console.log('failed requests:', failed.join('; '));
  await p.screenshot({ path: process.argv[3] || 'unreachable.png' });
  await b.close();
})();
