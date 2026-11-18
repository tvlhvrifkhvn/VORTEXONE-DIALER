// R7 keyboard and label pass (docs/RESKIN.md). Same login and Playwright as
// reskin-shots.js. For each page: lists visible inputs/selects/textareas with
// no label, buttons/links with no name, and, tabbing up to 80 stops, any
// focused element without a visible focus outline. Exits 1 on any finding.
// Usage: AUDIT_PASSWORD=... node audit/scripts/reskin-a11y.js --lead <id> [--theme ink|paper]
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const lead = arg('lead');
const theme = arg('theme') || 'ink';
if (!lead || !process.env.AUDIT_PASSWORD) {
  console.error('usage: AUDIT_PASSWORD=... node audit/scripts/reskin-a11y.js --lead <id> [--theme ink|paper]');
  process.exit(2);
}
const PAGES = [
  ['dashboard', '/'],
  ['call', `/call/${lead}`],
  ['lead', `/leads/${lead}`],
  ['settings', '/settings'],
];

function audit() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.type ? '[' + el.type + ']' : ''} "${(el.textContent || el.placeholder || '').trim().slice(0, 40)}"`;
  const unlabelled = [];
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden' || !visible(el)) continue;
    const named =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
      el.closest('label');
    if (!named) unlabelled.push(describe(el));
  }
  const unnamed = [];
  for (const el of document.querySelectorAll('button, a[href]')) {
    if (!visible(el)) continue;
    // A <button> wrapped in or pointed at by a <label> takes its name from it.
    const name =
      (el.textContent || '').trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.labels && el.labels.length > 0 && el.labels[0].textContent.trim());
    if (!name) unnamed.push(describe(el));
  }
  return { unlabelled, unnamed };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vortex.theme', t); } catch { /* ignore */ } }, theme);
  const page = await ctx.newPage();
  await page.goto(base + '/login');
  await page.fill('input[type=email]', process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com');
  await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10000 });

  let problems = 0;
  for (const [name, path] of PAGES) {
    await page.goto(base + path);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(name === 'call' ? 3000 : 1200);
    const { unlabelled, unnamed } = await page.evaluate(audit);

    // Tab through; record focused elements with no visible outline.
    await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
    const noRing = new Set();
    let stops = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        return { ring, label: `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 30)}"` };
      });
      if (!info) continue;
      stops++;
      if (!info.ring) noRing.add(info.label);
    }
    const n = unlabelled.length + unnamed.length + noRing.size;
    problems += n;
    console.log(`${theme} ${name.padEnd(9)} tab stops=${stops} unlabelled=${unlabelled.length} unnamed=${unnamed.length} no-focus-ring=${noRing.size}`);
    for (const x of unlabelled) console.log(`   unlabelled: ${x}`);
    for (const x of unnamed) console.log(`   unnamed:    ${x}`);
    for (const x of noRing) console.log(`   no ring:    ${x}`);
  }
  await browser.close();
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
