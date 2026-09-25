// CI-safe / dev email adapter — mirrors mockSmsAdapter.js's role for SMS.
// sendgridAdapter.js (phase 2) drops in behind the same sendEmail(toAddress,
// subject, body) signature; nothing else should need to change when it lands.
function sendEmail(toAddress, subject, body) {
  const delayMs = 300 + Math.random() * 500;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, messageId: `mock_${Date.now()}` });
    }, delayMs);
  });
}

module.exports = { sendEmail };
