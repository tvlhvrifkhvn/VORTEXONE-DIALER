/**
 * Twilio TelephonyAdapter — phase 2 stub.
 *
 * Fill this in with real Twilio Voice API calls: use the Twilio REST client
 * to originate the call, then translate Twilio's status-callback / AMD
 * webhook events into the onEvent shape defined in telephony/index.js
 * ('ringing', 'answered', 'voicemail_detected', 'ended'). No other code
 * should need to change when this is implemented — routes and services
 * only ever call telephony.placeCall(...).
 */
function placeCall(fromNumber, toNumber, onEvent) {
  throw new Error('twilioAdapter is not implemented yet — set TELEPHONY_PROVIDER=mock');
}

module.exports = { placeCall };
