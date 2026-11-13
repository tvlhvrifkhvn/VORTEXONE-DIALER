// CI-safe / dev SMS adapter — mirrors mockAdapter.js's role for calls.
// twilioSmsAdapter.js (phase 2) drops in behind the same sendSms(toNumber,
// body, mediaUrl) signature; nothing else should need to change when it
// lands. mediaUrl is accepted and logged only — no real MMS delivery here.
function sendSms(toNumber, body, mediaUrl) {
  if (mediaUrl) console.log(`[mockSmsAdapter] would attach media: ${mediaUrl}`);
  const delayMs = 300 + Math.random() * 500;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, messageId: `mock_${Date.now()}` });
    }, delayMs);
  });
}

/**
 * Inbound webhook body -> { from, to, body, providerMessageId }. The mock
 * takes the provider-neutral shape as-is (tests post it directly). A real
 * provider's adapter maps its own webhook fields here (e.g. From/To/Body/
 * MessageSid), so smsService never sees a provider's format.
 */
function parseInbound(payload = {}) {
  return {
    from: payload.from,
    to: payload.to,
    body: payload.body,
    providerMessageId: payload.providerMessageId,
  };
}

module.exports = { sendSms, parseInbound };
