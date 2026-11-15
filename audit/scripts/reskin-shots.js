// Reskin screenshots and smoke check (docs/RESKIN.md section 0), based on
// ui-smoke.js: same login, same globally installed Playwright Chromium.
//
// Usage:
//   AUDIT_PASSWORD=<seed password> node audit/scripts/reskin-shots.js \
//     --seg r1 --pages styleguide,dashboard [--themes ink,paper] [--lead <id>] [--smoke]
// Optional env: BASE_URL (default http://localhost:5173), AUDIT_EMAIL.
//
// Saves full-page JPEGs (quality 70) to audit/screenshots/reskin/<seg>/<theme>-<page>.jpg
// and prints one line per page: console errors and 4xx/5xx responses.
// --smoke (needs --lead, a dialable lead): on the call screen, M flips mute,
// Esc opens the hang-up confirm, D marks the outcome buttons and V picks
// Voicemail; N picks No answer on the next queued lead. Saves the call's
// ringing, connected, confirm and ended states for the first theme. Visiting the call page
// locks its lead for 30 s, so when --pages includes call, pass a different
// lead for the smoke run with --smoke-lead <id>.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { themes: 'ink,paper', pages: '', smoke: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') args.smoke = true;
    else if (a.startsWith('--')) {
      const value = argv[i + 1];
      // An empty shell variable (e.g. --lead $L with no lead found) must not
      // swallow the next flag and end the run silently.
      if (value === undefined || value.startsWith('--')) {
        console.error(`${a} needs a value`);
        process.exit(2);
      }
      args[a.slice(2)] = value;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const base = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';
const password = process.env.AUDIT_PASSWORD;
const seg = args.seg;
const themes = args.themes.split(',').map((t) => t.trim()).filter(Boolean);
const pages = args.pages.split(',').map((p) => p.trim()).filter(Boolean);

const ROUTES = {
  login: '/login',
  dashboard: '/',
  dialer: '/dialer',
  manual: '/call/manual',
  call: args.lead ? `/call/${args.lead}` : null,
  lead: args.lead ? `/leads/${args.lead}` : null,
  inbox: '/inbox',
  templates: '/sms/templates',
  import: '/import',
  reports: '/reports',
  settings: '/settings',
  styleguide: '/styleguide',
};

if (!seg || (!pages.length && !args.smoke)) {
  console.error('usage: --seg <rN> --pages <list> [--themes ink,paper] [--lead <id>] [--smoke]');
  process.exit(2);
}
if (!password) {
  console.error('AUDIT_PASSWORD is not set');
  process.exit(2);
}
for (const p of pages) {
  if (!(p in ROUTES)) {
    console.error(`unknown page "${p}". Known: ${Object.keys(ROUTES).join(', ')}`);
    process.exit(2);
  }
  if (!ROUTES[p]) {
    console.error(`page "${p}" needs --lead <id>`);
    process.exit(2);
  }
}

const outDir = path.resolve(__dirname, '../screenshots/reskin', seg);
fs.mkdirSync(outDir, { recursive: true });

// Logged-in browser state, captured once per run (logging in for every page
// trips the login rate limit).
let authState = null;

async function newContext(browser, theme, auth = true) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(auth && authState ? { storageState: authState } : {}),
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('vortex.theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
  return ctx;
}

function track(page) {
  const log = { console: [], http: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => log.console.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('response', (r) => {
    if (r.status() >= 400) log.http.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
  });
  return log;
}

async function login(page) {
  await page.goto(base + '/login');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10000 });
}

async function ensureAuth(browser) {
  if (authState) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page);
  authState = await ctx.storageState();
  await ctx.close();
}

async function shoot(browser, theme, name) {
  const ctx = await newContext(browser, theme, name !== 'login');
  const page = await ctx.newPage();
  const log = track(page); // count only the page itself, not the login
  await page.goto(base + ROUTES[name]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(name === 'call' ? 4000 : 1500);
  const file = path.join(outDir, `${theme}-${name}.jpg`);
  await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70 });
  const extra = [...new Set([...log.console, ...log.http])].slice(0, 3).join(' | ');
  console.log(
    `${theme.padEnd(5)} ${name.padEnd(10)} console=${log.console.length} http=${log.http.length}  ${path.relative(process.cwd(), file)}${extra ? '  ' + extra : ''}`,
  );
  await ctx.close();
  return log.console.length === 0;
}

// No \b: the [M] keycap's text runs straight into the label ("MMute").
const MUTE_BUTTON = /(Mute|Unmute)$/;

async function waitForCall(page) {
  // The call is live once the Mute tile is enabled.
  await page.locator('button', { hasText: MUTE_BUTTON }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.jpg`), fullPage: true, type: 'jpeg', quality: 70 });
}

// On the call screen: M flips mute, Esc opens the hang-up confirm, D marks the
// outcome buttons, V posts Voicemail; then N posts No answer on a second call
// (/call/next). Also saves the ringing, connected, confirm and ended states.
async function smoke(browser) {
  if (!args.lead) {
    console.log('SMOKE  skipped: --lead <id> is required');
    return false;
  }
  const theme = themes[0] || 'ink';
  const ctx = await newContext(browser, theme);
  const page = await ctx.newPage();
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.postData() || '');
  });
  await page.goto(`${base}/call/${args['smoke-lead'] || args.lead}`);
  await page.getByText(/^Ringing$/i).first().waitFor({ timeout: 8000 }).catch(() => {});
  await shot(page, `${theme}-call-ringing`);
  await waitForCall(page);
  const connected = await page
    .getByText(/^Connected$/i)
    .first()
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (connected) await shot(page, `${theme}-call-connected`);
  else console.log('SHOTS  the mock call did not connect this time; no connected screenshot');

  const results = [];
  const pressedMute = () => page.locator('button[aria-pressed="true"]', { hasText: /Unmute$/ }).count();

  // M flips mute
  const before = await pressedMute();
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  const after = await pressedMute();
  results.push(['M flips mute', before === 0 && after > 0]);
  await page.keyboard.press('m'); // back to unmuted
  await page.waitForTimeout(300);

  // Esc opens the hang-up confirm
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const confirmShown = (await page.getByText('Hang up this call?').count()) > 0;
  results.push(['Esc opens hang-up confirm', confirmShown]);
  if (confirmShown) {
    await shot(page, `${theme}-call-hangup-confirm`);
    await page.locator('button', { hasText: /^\s*Cancel\s*$/ }).first().click();
    await page.waitForTimeout(300);
  }

  // D marks the outcome buttons (a primary outline for 800 ms)
  await page.keyboard.press('d');
  await page.waitForTimeout(200);
  results.push(['D jumps to the outcome buttons', (await page.locator('.outline-primary').count()) > 0]);
  await page.waitForTimeout(900);

  // V picks Voicemail (the outcome is posted)
  await page.keyboard.press('v');
  await page.waitForTimeout(2000);
  results.push(['V picks Voicemail', posts.some((p) => /voicemail/i.test(p))]);
  await shot(page, `${theme}-call-ended`);

  // N picks No answer, on the next lead in the queue
  posts.length = 0;
  await page.goto(`${base}/call/next`);
  await waitForCall(page);
  await page.keyboard.press('n');
  await page.waitForTimeout(2000);
  results.push(['N picks No answer', posts.some((p) => /no_answer/i.test(p))]);

  for (const [name, ok] of results) console.log(`SMOKE  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  await ctx.close();
  return results.every(([, ok]) => ok);
}

(async () => {
  const browser = await chromium.launch();
  let ok = true;
  try {
    await ensureAuth(browser);
    for (const theme of themes) {
      for (const name of pages) ok = (await shoot(browser, theme, name)) && ok;
    }
    if (args.smoke) ok = (await smoke(browser)) && ok;
  } finally {
    await browser.close();
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
