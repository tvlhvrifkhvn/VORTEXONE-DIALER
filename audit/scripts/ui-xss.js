// Renders leads with hostile names in the dashboard table, the lead page and the
// pre-call brief/lead pages, and reports whether any script ran (dialog/console marker)
// or any injected element exists in the DOM. Usage: node audit/scripts/ui-xss.js http://localhost:5173 <id1> <id2> <id3>
const { chromium } = require('playwright');
(async () => {
  const [base, ...ids] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await p.goto(base + '/login'); await p.fill('input[type=email]', 'vortexoneagency@gmail.com'); await p.fill('input[type=password]', 'ChangeMe123!'); await p.click('button[type=submit]'); await p.waitForTimeout(2000);
  const check = async (label) => {
    const injected = await p.evaluate(() => ({ scripts: [...document.querySelectorAll('main script, table script')].length, imgsWithOnerror: [...document.querySelectorAll('img[onerror]')].length, boldFromData: [...document.querySelectorAll('td b, main b')].filter((x) => x.textContent === 'KW').length }));
    const text = await p.innerText('body');
    console.log(`${label}: dialogs=${dialogs.length} injected=${JSON.stringify(injected)} literal "<script>alert(1)</script>" visible=${text.includes('<script>alert(1)</script>')} literal "<img src=x onerror=alert(1)>" visible=${text.includes('<img src=x onerror=alert(1)>')} urdu visible=${text.includes('احمد علی')}`);
  };
  await p.goto(base + '/'); await p.waitForTimeout(2500);
  await p.fill('input[placeholder*="Search name"]', '<'); await p.waitForTimeout(2000); await check('dashboard table (filter "<")');
  await p.screenshot({ path: 'audit/screenshots/11-xss-table.png' });
  await p.fill('input[placeholder*="Search all leads"]', 'alert'); await p.waitForTimeout(1500); await check('navbar search dropdown');
  for (const id of ids) { await p.goto(`${base}/leads/${id}`); await p.waitForTimeout(2000); await check(`lead page ${id}`); }
  await p.screenshot({ path: 'audit/screenshots/11-xss-lead-page.png' });
  // long name layout: does the 10,000-char name blow out the table width?
  await p.goto(base + '/'); await p.waitForTimeout(2000); await p.fill('input[placeholder*="Search name"]', 'LLLLLLLLLL'); await p.waitForTimeout(2000);
  const w = await p.evaluate(() => ({ docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  console.log(`10,000-char name in table: page scrollWidth=${w.docWidth} viewport=${w.viewport} (horizontal overflow=${w.docWidth > w.viewport})`);
  await p.screenshot({ path: 'audit/screenshots/11-long-name.png' });
  console.log('dialogs captured overall:', JSON.stringify(dialogs));
  await b.close();
})();
