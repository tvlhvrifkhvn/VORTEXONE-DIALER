const config = require('../config');
const mockEmailAdapter = require('./mockEmailAdapter');

// sendgridAdapter.js drops in here in phase 2, same shape as
// telephony/smsIndex.js's own adapters map.
const adapters = {
  mock: mockEmailAdapter,
};

function getEmailAdapter(provider = config.emailProvider) {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unknown EMAIL_PROVIDER: "${provider}". Expected one of: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}

/**
 * EmailAdapter interface — sendEmail(toAddress, subject, body) → Promise<{ success, messageId }>.
 */
function sendEmail(toAddress, subject, body) {
  return getEmailAdapter().sendEmail(toAddress, subject, body);
}

module.exports = { sendEmail, getEmailAdapter };
