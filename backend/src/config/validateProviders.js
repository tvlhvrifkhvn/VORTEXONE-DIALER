// F-31: check the provider settings once, at startup, instead of failing on
// the first request. A wrong name stops the server with a message naming the
// variable and the allowed values; a missing (or empty) value keeps the
// default from config/index.js. Called from src/index.js before listening.
const telephony = require('../telephony');
const sms = require('../telephony/smsIndex');
const email = require('../telephony/emailIndex');

const CHECKS = [
  ['TELEPHONY_PROVIDER', telephony.PROVIDERS],
  ['SMS_PROVIDER', sms.PROVIDERS],
  ['EMAIL_PROVIDER', email.PROVIDERS],
];

/** Returns one message per invalid setting ([] when all are valid). */
function validateProviders(env = process.env) {
  const problems = [];
  for (const [name, allowed] of CHECKS) {
    const value = env[name];
    if (value === undefined || value === '') continue; // default applies
    if (!allowed.includes(value)) {
      problems.push(`${name}="${value}" is not a known provider. Allowed values: ${allowed.join(', ')}.`);
    }
  }
  return problems;
}

module.exports = { validateProviders };
