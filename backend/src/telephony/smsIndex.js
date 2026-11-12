const crypto = require('crypto');
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
 * SmsAdapter interface — sendSms(toNumber, body, mediaUrl?) → Promise<{ success, messageId }>,
 * and parseInbound(webhookBody) → { from, to, body, providerMessageId }.
 */
function sendSms(toNumber, body, mediaUrl) {
  return getSmsAdapter().sendSms(toNumber, body, mediaUrl);
}

// ---- inbound webhook ---------------------------------------------------------
// POST /api/sms/inbound is called by the SMS provider, not a logged-in user.
// It is protected by a shared secret: the X-Webhook-Secret header must equal
// the SMS_WEBHOOK_SECRET env var (constant-time compare). With no secret set,
// every request is refused (fail closed).
const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

function sameSecret(given, expected) {
  // Hash both so the compare is constant-time whatever the lengths.
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** true when the request may be processed. */
function verifyInbound(headers = {}) {
  const expected = process.env.SMS_WEBHOOK_SECRET;
  if (!expected) return false; // not configured: refuse everything
  const given = headers[WEBHOOK_SECRET_HEADER];
  if (typeof given !== 'string' || !given) return false;
  if (!sameSecret(given, expected)) return false;
  // PROVIDER SIGNATURE CHECK GOES HERE (phase 2): a real provider signs its
  // webhooks (e.g. Twilio's X-Twilio-Signature over the URL and params). Call
  // the active adapter's verifySignature(headers, rawBody, url) here and
  // refuse on failure. The mock adapter has none.
  return true;
}

/** Provider webhook body -> { from, to, body, providerMessageId }. */
function parseInbound(payload) {
  return getSmsAdapter().parseInbound(payload);
}

module.exports = { sendSms, getSmsAdapter, verifyInbound, parseInbound };
