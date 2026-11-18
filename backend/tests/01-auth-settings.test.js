// Settings and auth: who may write settings, unknown keys, protected routes,
// and the rate limits' normal values.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let rep;
let supervisor;

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  supervisor = await h.createUser({ role: 'supervisor' });
});

test('protected routes answer 401 without a token', async () => {
  for (const [method, path] of [
    ['GET', '/api/leads'],
    ['POST', '/api/calls'],
    ['GET', '/api/reports/today'],
    ['PUT', '/api/settings/calling_hours_enforced'],
  ]) {
    const res = await h.request(null, method, path, method === 'GET' ? undefined : {});
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('a rep cannot write a setting (403)', async () => {
  const res = await rep.api.put('/api/settings/calling_hours_enforced', { value: 'false' });
  assert.equal(res.status, 403);
});

test('an unknown setting key answers 400', async () => {
  const res = await supervisor.api.put('/api/settings/no_such_setting_key', { value: 'x' });
  assert.equal(res.status, 400);
});

test('a supervisor can write a whitelisted setting', async () => {
  const res = await supervisor.api.put('/api/settings/calling_hours_enforced', { value: 'false' });
  assert.equal(res.status, 200);
});

test('rate limits: API 600/min by default, RATE_LIMIT_API_MAX overrides it everywhere; login stays 5/min outside tests', () => {
  const rateLimit = require('../src/middleware/rateLimit');
  assert.equal(rateLimit.API_MAX, 600); // C7A (was 100)
  assert.equal(rateLimit.LOGIN_MAX, 5);
  const saved = { env: process.env.NODE_ENV, api: process.env.RATE_LIMIT_API_MAX, login: process.env.RATE_LIMIT_LOGIN_MAX };
  try {
    delete process.env.RATE_LIMIT_API_MAX;
    for (const env of ['production', 'development', 'test']) {
      process.env.NODE_ENV = env;
      assert.equal(rateLimit.apiMax(), 600, `default in ${env}`);
    }
    process.env.RATE_LIMIT_API_MAX = '900';
    for (const env of ['production', 'development']) {
      process.env.NODE_ENV = env;
      assert.equal(rateLimit.apiMax(), 900, `override in ${env}`);
    }
    process.env.RATE_LIMIT_API_MAX = 'lots';
    assert.equal(rateLimit.apiMax(), 600, 'a bad override is ignored');
    // The login limit's override still applies only under tests.
    process.env.RATE_LIMIT_LOGIN_MAX = '50';
    process.env.NODE_ENV = 'production';
    assert.equal(rateLimit.maxFor('RATE_LIMIT_LOGIN_MAX', rateLimit.LOGIN_MAX), 5);
  } finally {
    process.env.NODE_ENV = saved.env;
    if (saved.api === undefined) delete process.env.RATE_LIMIT_API_MAX; else process.env.RATE_LIMIT_API_MAX = saved.api;
    if (saved.login === undefined) delete process.env.RATE_LIMIT_LOGIN_MAX; else process.env.RATE_LIMIT_LOGIN_MAX = saved.login;
  }
  // Under test, the runner's raised value applies.
  assert.ok(rateLimit.apiMax() > 600);
});
