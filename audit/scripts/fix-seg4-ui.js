// Segment 4 UI check: how the call screen and the lead edit form show the
// new 400 / 409 answers, and whether they stay usable. Rep2 drives the
// browser. Leads are prepared by fix-seg4-ui.sh (API + labelled DIRECT SQL).
// Usage: DB=<db> node audit/scripts/fix-seg4-ui.js <frontendBase> <callLead> <dncLead> <phonelessLead> <ncnLead> <plainLead>
const path = require('path');
const { chromium } = require('playwright');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));
const [base, callLead, dncLead, phoneless, ncnLead, plainLead] = process.argv.slice(2);
const sql = new Client({ connectionString: `postgres://vortex:vortex@localhost:5432/${process.env.DB}` });
const q = async (s, p) => (await sql.query(s, p)).rows;
const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

(async () => {
  await sql.connect();
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage();
  const errors = [];
  const responses = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', (r) => {
    const u = new URL(r.url()).pathname;
    if (/^\/api\/(dispositions|leads\/\d+$)/.test(u) && r.request().method() !== 'GET') responses.push(`${r.request().method()} ${u} -> ${r.status()}`);
  });
  await p.goto(base + '/login');
  await p.fill('input[type=email]', 'rep2@example.com');
  await p.fill('input[type=password]', 'Rep2Pass!');
  await p.click('button[type=submit]');
  await p.waitForTimeout(2000);
  const body = async () => p.innerText('body');
  const shows = async (t) => (await body()).includes(t);
  const say = (s) => console.log(s);
  p.setDefaultTimeout(5000);
  const section = async (name, fn) => { try { await fn(); } catch (e) { say(`  [${name}] stopped: ${e.message.split('\n')[0]}`); } };

  // --- call screen: past callback (F-35), then a valid callback + Undo (F-21)
  await section('call screen', async () => {
  await p.goto(`${base}/call/${callLead}`);
  await p.waitForTimeout(5000);
  say(`call screen lead ${callLead}: ${((await body()).match(/Ringing…|Connected/) || ['?'])[0]}`);
  await p.getByRole('button', { name: 'Schedule callback' }).click();
  await p.fill('input[type=datetime-local]', '2020-01-01T09:00');
  await p.getByRole('button', { name: 'Set', exact: true }).click();
  await p.waitForTimeout(1500);
  say(`  past callback (2020-01-01 09:00): message "That callback time is in the past" shown = ${await shows('That callback time is in the past')}; No Answer enabled = ${await p.getByRole('button', { name: 'No Answer' }).isEnabled()}`);
  await p.getByRole('button', { name: 'Schedule callback' }).click();
  await p.fill('input[type=datetime-local]', local(new Date(Date.now() + 26 * 3600 * 1000)));
  await p.getByRole('button', { name: 'Set', exact: true }).click();
  await p.waitForTimeout(1500);
  const lb = (await q('SELECT status FROM leads WHERE id=$1', [callLead]))[0].status;
  say(`  valid callback (tomorrow): lead ${lb}, open callbacks=${(await q('SELECT count(*)::int n FROM callbacks WHERE lead_id=$1 AND NOT done', [callLead]))[0].n}`);
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  await p.waitForTimeout(1500);
  const after = (await q('SELECT status FROM leads WHERE id=$1', [callLead]))[0].status;
  say(`  Undo: lead ${after}, open callbacks=${(await q('SELECT count(*)::int n FROM callbacks WHERE lead_id=$1 AND NOT done', [callLead]))[0].n}, error text shown = ${/syntax error|went wrong|Request failed/i.test(await body())}`);
  });
  await section('undo after the accepted past callback', async () => {
    if (!(await p.getByRole('button', { name: 'Undo', exact: true }).isVisible())) return;
    await p.getByRole('button', { name: 'Undo', exact: true }).click();
    await p.waitForTimeout(1500);
    const m = (await body()).match(/syntax error[^\n]*|Something went wrong[^\n]*/i);
    say(`  Undo of that callback: error text = ${m ? '"' + m[0] + '"' : 'none'}; lead ${(await q('SELECT status FROM leads WHERE id=$1', [callLead]))[0].status}`);
  });

  const field = (name) => p.locator(`label:text-is("${name}") + input`);
  const save = async () => { await p.getByRole('button', { name: 'Save changes' }).click(); await p.waitForTimeout(1200); };
  const lead = async (id) => (await q('SELECT status, phone, missing_phone, name FROM leads WHERE id=$1', [id]))[0];

  // --- DNC lead: phone change refused (409), name change saved
  await p.goto(`${base}/leads/${dncLead}`); await p.waitForTimeout(2000);
  const dncPhone = await field('phone').inputValue();
  await field('phone').fill('(817) 555-0199'); await save();
  say(`DNC lead ${dncLead}: new phone -> message "This lead is on the DNC list; its number can't be changed" shown = ${await shows("This lead is on the DNC list; its number can't be changed")}; phone in DB ${(await lead(dncLead)).phone}`);
  await field('phone').fill(dncPhone); await field('name').fill('Seg4 UI DNC renamed'); await save();
  say(`  same phone + new name -> "Saved." shown = ${await shows('Saved.')}; name in DB "${(await lead(dncLead)).name}"`);

  // --- phoneless lead (F-55): save another field, then add a number
  await p.goto(`${base}/leads/${phoneless}`); await p.waitForTimeout(2000);
  await field('brokerage').fill('Seg4 Realty'); await save();
  say(`phoneless lead ${phoneless}: edit brokerage with phone empty -> Saved shown = ${await shows('Saved.')}, error shown = ${await shows('Enter a valid 10-digit')}`);
  await p.waitForTimeout(2200); // let the first "Saved." (2 s timer) clear
  await field('phone').fill('(469) 555-0177'); await save();
  const pl = await lead(phoneless);
  say(`  add phone -> Saved shown = ${await shows('Saved.')}; DB ${pl.status} phone=${pl.phone} missing_phone=${pl.missing_phone}`);

  // --- invalid phone (400) on a plain lead
  await p.goto(`${base}/leads/${plainLead}`); await p.waitForTimeout(2000);
  await field('phone').fill('abc'); await save();
  say(`plain lead ${plainLead}: phone "abc" -> message "Enter a valid 10-digit US phone number" shown = ${await shows('Enter a valid 10-digit US phone number')}; Save enabled = ${await p.getByRole('button', { name: 'Save changes' }).isEnabled()}`);

  // --- no_contact_number lead (F-23): new number puts it back in the queue
  await p.goto(`${base}/leads/${ncnLead}`); await p.waitForTimeout(2000);
  await field('phone').fill('(469) 555-0188'); await save();
  const nl = await lead(ncnLead);
  say(`no_contact_number lead ${ncnLead}: new phone -> Saved shown = ${await shows('Saved.')}; DB ${nl.status} phone=${nl.phone}`);

  say(`requests: ${responses.join(' | ')}`);
  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await b.close();
  await sql.end();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
