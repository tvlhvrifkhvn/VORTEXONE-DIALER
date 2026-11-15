// Shared test helpers for backend/tests (run with `npm run verify`).
// Each test file runs in its own process: it loads the real Express app,
// listens on a free port, resets the vortex_verify database, and talks to
// the app over HTTP through one function (request) — so a later phase can
// add a header (e.g. X-Campaign-Id) in one place.
if (process.env.VORTEX_VERIFY !== '1') {
  throw new Error('Run the backend tests with `npm run verify` (it creates and guards the vortex_verify database).');
}

const bcrypt = require('bcrypt');
const db = require('../src/db');
const app = require('../src/index');
const leadQueue = require('../src/services/leadQueue');
const settings = require('../src/services/settings');

const PASSWORD = 'Verify-pass-1';
let server = null;
let baseUrl = null;

async function start() {
  if (!server) {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }
  return baseUrl;
}

/** Empties every table (identities restart). The schema stays. */
async function resetDb() {
  const { rows } = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
  );
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

/** Calling hours on or off (the setting the app reads; refreshes its cache). */
async function setCallingHours(enforced) {
  await settings.setSetting('calling_hours_enforced', enforced ? 'true' : 'false');
}

/** Every HTTP call of the tests goes through here. */
async function request(token, method, path, body, { headers = {}, form = null } = {}) {
  await start();
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(baseUrl + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

/** A client bound to one user's token: api.get('/api/leads'), api.post(...). */
function client(token) {
  return {
    token,
    get: (p, opts) => request(token, 'GET', p, undefined, opts),
    post: (p, body, opts) => request(token, 'POST', p, body, opts),
    put: (p, body, opts) => request(token, 'PUT', p, body, opts),
    del: (p, opts) => request(token, 'DELETE', p, undefined, opts),
  };
}

let userSeq = 0;
/** Creates a user and logs in through the API. Returns { user, api }. */
async function createUser({ role = 'rep', email } = {}) {
  userSeq += 1;
  const address = email || `${role}${userSeq}@verify.test`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows } = await db.query(
    'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [address, hash, `${role} ${userSeq}`, role]
  );
  const res = await request(null, 'POST', '/api/auth/login', { email: address, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: rows[0], api: client(res.body.token) };
}

let phoneSeq = 0;
/** A unique, valid E.164 number in the given area code (214 = Texas, 415 = California). */
function nextPhone(areaCode = '214') {
  phoneSeq += 1;
  return `+1${areaCode}555${String(phoneSeq).padStart(4, '0')}`;
}

/** Inserts a lead directly and works out its time zones (as the app does). */
async function createLead(fields = {}) {
  const lead = {
    name: `Verify Lead ${phoneSeq + 1}`,
    phone: nextPhone(fields.areaCode),
    state: 'TX',
    status: 'in_queue',
    max_attempts: 5,
    ...fields,
  };
  delete lead.areaCode;
  const cols = Object.keys(lead);
  const { rows } = await db.query(
    `INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    cols.map((c) => lead[c])
  );
  await leadQueue.backfillZones();
  return (await db.query('SELECT * FROM leads WHERE id = $1', [rows[0].id])).rows[0];
}

async function getLead(id) {
  return (await db.query('SELECT * FROM leads WHERE id = $1', [id])).rows[0];
}

// ---- mock call outcome (same idea as audit/stubs/force-outcome.js) ----
// mockAdapter maps Math.random(): <0.35 answered, <0.55 voicemail, <0.70 busy, else no_answer.
const realRandom = Math.random;
const BAND = { answered: 0.1, voicemail: 0.4, busy: 0.6, no_answer: 0.9 };
function setOutcome(outcome) {
  Math.random = outcome ? () => BAND[outcome] : realRandom;
}

// ---- controlled clock (same idea as audit/stubs/fake-now.js) ----
// Shifts the Node clock only; Postgres now() is unaffected.
const RealDate = Date;
function setNowOffset(ms) {
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + ms);
      else super(...args);
    }
    static now() {
      return RealDate.now() + ms;
    }
  }
  global.Date = FakeDate;
}
function resetClock() {
  global.Date = RealDate;
}

/** Places a single call on a lead through the API (locks it, attempts + 1). */
async function dial(api, leadId) {
  const res = await api.post('/api/calls', leadId ? { leadId } : {});
  return res;
}

async function waitFor(check, { timeoutMs = 20000, intervalMs = 200 } = {}) {
  const until = RealDate.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (RealDate.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Sets up a file: server up, database empty, calls answered, hours off. */
async function setupFile() {
  await start();
  await resetDb();
  setOutcome('answered');
  await setCallingHours(false);
}

module.exports = {
  db,
  start,
  resetDb,
  setupFile,
  setCallingHours,
  request,
  client,
  createUser,
  createLead,
  getLead,
  nextPhone,
  setOutcome,
  setNowOffset,
  resetClock,
  dial,
  waitFor,
};
