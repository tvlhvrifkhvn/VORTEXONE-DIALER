// Login: the email matches regardless of letter case and surrounding spaces;
// the password still has to match exactly.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(async () => {
  await h.setupFile();
  await h.createUser({ role: 'supervisor', email: 'owner@verify.test' });
});

const login = (email, password) => h.request(null, 'POST', '/api/auth/login', { email, password });

test('login accepts the email with capitals and spaces around it', async () => {
  const res = await login('  Owner@Verify.TEST ', h.PASSWORD);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'owner@verify.test');
});

test('login still refuses a wrong password, or the password with a different case', async () => {
  assert.equal((await login('owner@verify.test', 'wrong-password')).status, 401);
  assert.equal((await login('owner@verify.test', h.PASSWORD.toUpperCase())).status, 401);
});
