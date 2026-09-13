const config = require('../config');
const mockAdapter = require('./mockAdapter');
const twilioAdapter = require('./twilioAdapter');

const adapters = {
  mock: mockAdapter,
  twilio: twilioAdapter,
};

function getAdapter(provider = config.telephonyProvider) {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unknown TELEPHONY_PROVIDER: "${provider}". Expected one of: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}

/**
 * TelephonyAdapter interface — every adapter in this folder implements this
 * single function. Do not change this shape without discussing it first;
 * routes/calls.js and services/leadLifecycle.js both depend on it exactly
 * as documented here.
 *
 *   placeCall(fromNumber, toNumber, onEvent) → callId
 *
 * onEvent is invoked (possibly many times, asynchronously) with objects
 * shaped like one of:
 *   { type: 'ringing' }
 *   { type: 'answered' }
 *   { type: 'voicemail_detected' }
 *   { type: 'ended', duration: <seconds> }
 *
 * Ending a call from the app side (rep hangup, or submitting a disposition)
 * is NOT part of this interface — the caller simply stops acting on further
 * events for that callId. Adapters that represent a live, answered call
 * (mock included) do not emit 'ended' on their own for that case.
 */
function placeCall(fromNumber, toNumber, onEvent) {
  return getAdapter().placeCall(fromNumber, toNumber, onEvent);
}

module.exports = { placeCall, getAdapter };
