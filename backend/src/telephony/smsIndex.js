const config = require('../config');
const mockSmsAdapter = require('./mockSmsAdapter');

// twilioSmsAdapter.js drops in here in phase 2, same shape as
// telephony/index.js's own adapters map.
const adapters = {
  mock: mockSmsAdapter,
};

function getSmsAdapter(provider = config.smsProvider) {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unknown SMS_PROVIDER: "${provider}". Expected one of: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}

/**
 * SmsAdapter interface — sendSms(toNumber, body) → Promise<{ success, messageId }>.
 */
function sendSms(toNumber, body) {
  return getSmsAdapter().sendSms(toNumber, body);
}

module.exports = { sendSms, getSmsAdapter };
