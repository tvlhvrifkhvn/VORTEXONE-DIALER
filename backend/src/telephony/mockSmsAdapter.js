// CI-safe / dev SMS adapter — mirrors mockAdapter.js's role for calls.
// twilioSmsAdapter.js (phase 2) drops in behind the same sendSms(toNumber,
// body) signature; nothing else should need to change when it lands.
function sendSms(toNumber, body) {
  const delayMs = 300 + Math.random() * 500;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, messageId: `mock_${Date.now()}` });
    }, delayMs);
  });
}

module.exports = { sendSms };
