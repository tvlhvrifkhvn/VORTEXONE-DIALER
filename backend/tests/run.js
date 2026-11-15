#!/usr/bin/env node
// Safety-net test runner: `npm run verify` (docs/CRM_PLAN.md, phase C0B).
//
// 1. Takes the Postgres server from DATABASE_URL (env, or backend/.env).
// 2. Drops and creates a database named vortex_verify on that server and
//    refuses to touch any other database.
// 3. Runs the migrations on it, then every backend/tests/*.test.js file with
//    node:test, one file at a time, with mock providers, a test JWT secret,
//    no reachable AI provider and raised rate limits (NODE_ENV=test).
// 4. Prints a short pass/fail table, drops the database and exits non-zero
//    when anything failed. No new dependencies: node:test and built-in fetch.
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const BACKEND_DIR = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });
const { Client } = require('pg');

const VERIFY_DB = 'vortex_verify';

function fail(message) {
  console.error(`verify: ${message}`);
  process.exit(2);
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set (env or backend/.env)');

const serverUrl = new URL(process.env.DATABASE_URL);
const verifyUrl = new URL(serverUrl.href);
verifyUrl.pathname = `/${VERIFY_DB}`;
const adminUrl = new URL(serverUrl.href);
adminUrl.pathname = '/postgres';

// The one guard that matters: the tests truncate every table.
if (decodeURIComponent(verifyUrl.pathname.slice(1)) !== VERIFY_DB) {
  fail(`refusing to run against "${verifyUrl.pathname.slice(1)}"; only ${VERIFY_DB} is allowed`);
}

const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  VORTEX_VERIFY: '1',
  DATABASE_URL: verifyUrl.href,
  PORT: '0', // src/index.js listens on PORT when required; 0 = any free port
  JWT_SECRET: 'verify-test-secret-not-for-production',
  TELEPHONY_PROVIDER: 'mock',
  SMS_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'mock',
  // Never reach Groq: a dummy key (an empty one would fall back to the key in
  // config/index.js) and a closed local port; import AI off entirely.
  GROQ_API_KEY: 'verify-dummy-key',
  GROQ_BASE_URL: 'http://127.0.0.1:9',
  IMPORT_AI: 'off',
  SMS_WEBHOOK_SECRET: 'verify-webhook-secret',
  STALE_LOCK_SWEEP: 'off',
  RATE_LIMIT_API_MAX: '100000',
  RATE_LIMIT_LOGIN_MAX: '100000',
};

async function withAdmin(fn) {
  const client = new Client({ connectionString: adminUrl.href });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function dropDatabase() {
  await withAdmin(async (c) => {
    await c.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [VERIFY_DB]);
    await c.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
  });
}

function parseTap(output) {
  const rows = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(not ok|ok) \d+ - (.+?)(\s+#\s*(TODO|SKIP).*)?$/);
    if (!m) continue;
    const directive = m[4];
    const result = directive === 'TODO' ? 'TODO' : directive === 'SKIP' ? 'SKIP' : m[1] === 'ok' ? 'PASS' : 'FAIL';
    rows.push({ result, name: m[2] });
  }
  return rows;
}

async function main() {
  const started = Date.now();
  await dropDatabase();
  await withAdmin((c) => c.query(`CREATE DATABASE ${VERIFY_DB}`));

  const migrate = spawnSync(process.execPath, ['src/db/migrate.js'], { cwd: BACKEND_DIR, env: testEnv, encoding: 'utf8' });
  if (migrate.status !== 0) {
    console.error(migrate.stdout, migrate.stderr);
    await dropDatabase();
    fail('migrations failed on vortex_verify');
  }

  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join('tests', f));

  const output = await new Promise((resolve) => {
    let out = '';
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-force-exit', '--test-reporter=tap', ...files],
      { cwd: BACKEND_DIR, env: testEnv }
    );
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ out, code }));
  });

  await dropDatabase();

  const rows = parseTap(output.out);
  const failed = rows.filter((r) => r.result === 'FAIL');
  if (failed.length || output.code !== 0) {
    // Show the diagnostics of failing tests (TAP YAML blocks) before the table.
    console.log(output.out.split('\n').filter((l) => !/^\s*#\s*(Subtest|tests|suites)/.test(l)).join('\n'));
  }
  console.log('\nRESULT  TEST');
  for (const r of rows) console.log(`${r.result.padEnd(6)}  ${r.name}`);
  const count = (k) => rows.filter((r) => r.result === k).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('TODO')} todo, ${count('SKIP')} skipped — ${seconds}s`);
  process.exit(failed.length || output.code !== 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await dropDatabase().catch(() => {});
  process.exit(1);
});
