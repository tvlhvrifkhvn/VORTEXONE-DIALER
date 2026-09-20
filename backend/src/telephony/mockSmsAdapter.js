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

module.exports = { sendSms };
