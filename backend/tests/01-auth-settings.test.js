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

test('rate limits keep 100/min and 5/min unless NODE_ENV is test', () => {
  const rateLimit = require('../src/middleware/rateLimit');
  assert.equal(rateLimit.API_MAX, 100);
  assert.equal(rateLimit.LOGIN_MAX, 5);
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(rateLimit.maxFor('RATE_LIMIT_API_MAX', rateLimit.API_MAX), 100);
    assert.equal(rateLimit.maxFor('RATE_LIMIT_LOGIN_MAX', rateLimit.LOGIN_MAX), 5);
    process.env.NODE_ENV = 'development';
    assert.equal(rateLimit.maxFor('RATE_LIMIT_API_MAX', rateLimit.API_MAX), 100);
  } finally {
    process.env.NODE_ENV = saved;
  }
  // Under test, the runner's raised value applies.
  assert.ok(rateLimit.maxFor('RATE_LIMIT_API_MAX', rateLimit.API_MAX) > 100);
});
