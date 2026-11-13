const crypto = require('crypto');

const RING_MS = 3000;
const VOICEMAIL_GREETING_MS = 4000;

const BUSY_MS = 1500;

function randomOutcome() {
  const r = Math.random();
  if (r < 0.35) return 'answered';
  if (r < 0.55) return 'voicemail';
  if (r < 0.70) return 'busy';
  return 'no_answer';
}

/**
 * Mock TelephonyAdapter — fires events on a timer instead of touching real
 * infrastructure. This is the adapter used for all of phase 1, and it stays
 * forever as the CI-safe / dev adapter (see telephony/index.js): 3s ring,
 * then a randomly chosen answered / voicemail / busy / no_answer outcome.
 *
 * A busy line emits { type: 'busy' } followed by 'ended'. Callers that don't
 * know that type simply ignore it and still see the 'ended' event, so this
 * stays compatible with the documented interface in telephony/index.js.
 */
function placeCall(fromNumber, toNumber, onEvent) {
  const callId = crypto.randomUUID();
  const startedAt = Date.now();
  const elapsedSeconds = () => Math.round((Date.now() - startedAt) / 1000);

  onEvent({ type: 'ringing' });

  setTimeout(() => {
    const outcome = randomOutcome();

    if (outcome === 'answered') {
      onEvent({ type: 'answered' });
      // The mock never auto-ends an answered call — the app ends it when
      // the rep hangs up or submits a disposition.
    } else if (outcome === 'voicemail') {
      onEvent({ type: 'voicemail_detected' });
      setTimeout(() => {
        onEvent({ type: 'ended', duration: elapsedSeconds() });
      }, VOICEMAIL_GREETING_MS);
    } else if (outcome === 'busy') {
      onEvent({ type: 'busy' });
      setTimeout(() => {
        onEvent({ type: 'ended', duration: elapsedSeconds() });
      }, BUSY_MS);
    } else {
      onEvent({ type: 'ended', duration: elapsedSeconds() });
    }
  }, RING_MS);

  return callId;
}

module.exports = { placeCall };
