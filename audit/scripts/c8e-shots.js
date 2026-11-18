// C8E gate screenshots: the call screen while ringing, connected, with the
// hang-up confirm open and ended with the outcomes; both themes, at 1440×900
// and 1280×720 (one dialable lead per run, given with --leads). Checks: no
// browser scrollbar; at 1440×900 the controls, NOTES and all six outcome
// buttons are inside the viewport (nothing to scroll for); at 1280×720 the
// CALL column itself needs no page scroll.
// Usage: AUDIT_PASSWORD=<pw> node audit/scripts/c8e-shots.js --leads 1,2,3,4 [--themes ink,paper]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : null);
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const leads = (arg('leads') || '').split(',').filter(Boolean);
const outDir = path.join(__dirname, '..', 'screenshots', 'c8e');
fs.mkdirSync(outDir, { recursive: true });
const OUTCOMES = 6; // the six outcome buttons

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  let n = 0;
  for (const theme of (arg('themes') || 'ink,paper').split(',')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript((t) => localStorage.setItem('vortex.theme', t), theme);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${base}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', process.env.AUDIT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));

    for (const [w, h] of [
      [1440, 900],
      [1280, 720],
    ]) {
      const lead = leads[n++];
      if (!lead) throw new Error('not enough --leads (one per theme and size)');
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${base}/call/${lead}`);
      await page.getByTestId('call-status').waitFor({ timeout: 15000 });
      const shot = async (name) => {
        await page.mouse.move(w / 2, h - 5);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(outDir, `${theme}-${w}-${name}.jpg`), quality: 72, type: 'jpeg' });
      };
      await shot('ringing');
      await page.getByText(/^Connected$/i).first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(600);
      const m = await page.evaluate((labels) => {
        const inView = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0;
        };
        const outcomes = [...document.querySelectorAll('[data-testid="outcome-buttons"] button')];
        if (outcomes.length !== labels) return { page: true, controls: false, notes: false, outcomes: false, centerScroll: -1 };
        const main = document.querySelector('[data-testid="call-screen"] main');
        return {
          page: document.documentElement.scrollHeight - window.innerHeight > 0 || document.documentElement.scrollWidth - window.innerWidth > 0,
          controls: inView(document.querySelector('[data-testid="call-controls"]')),
          notes: inView(document.querySelector('[data-testid="call-screen"] textarea')),
          outcomes: outcomes.every(inView),
          centerScroll: main.scrollHeight - main.clientHeight,
        };
      }, OUTCOMES);
      const ok = !m.page && (w === 1440 ? m.controls && m.notes && m.outcomes && m.centerScroll <= 0 : m.controls && m.outcomes);
      if (!ok) failed = true;
      console.log(`${theme} ${w}x${h}: page scroll ${m.page}, controls ${m.controls}, notes ${m.notes}, 6 outcomes in view ${m.outcomes}, center overflow ${m.centerScroll}px → ${ok ? 'PASS' : 'FAIL'}`);
      await shot('connected');
      await page.keyboard.press('Escape');
      await page.getByText('Hang up this call?').waitFor();
      await shot('hangup-confirm');
      await page.getByRole('button', { name: 'Hang up', exact: true }).click();
      await page.waitForTimeout(1200);
      await shot('ended');
    }
    console.log(`${theme}: ${errors.length ? errors.join(' | ') : 'no console errors'}`);
    await context.close();
  }
  await browser.close();
  if (failed) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
