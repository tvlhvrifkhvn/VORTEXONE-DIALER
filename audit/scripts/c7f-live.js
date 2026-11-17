// C7F gate (optional): 10 sample questions against the REAL Groq key, through
// the running backend, printing each answer. Runs only when the owner sets
// RUN_LIVE_AI=1 (it spends Groq tokens); otherwise it says so and exits.
// Usage: RUN_LIVE_AI=1 AUDIT_PASSWORD=<pw> node audit/scripts/c7f-live.js [--api http://localhost:4000/api]
const argv = process.argv.slice(2);
const api = (argv.includes('--api') ? argv[argv.indexOf('--api') + 1] : 'http://localhost:4000/api').replace(/\/$/, '');
const email = process.env.AUDIT_EMAIL || 'vortexoneagency@gmail.com';

const QUESTIONS = [
  'Who should I call first today?',
  "What's overdue?",
  'How is this month\'s spend?',
  'When is the best time to call Texas leads?',
  'Which objections come up most, and what works against them?',
  'How do I add a task?',
  'How do I make a smart list or a list?',
  'Which model are you running on, and what can you do?',
  'How should I open a cold call to a real estate agent?',
  'Write a short follow-up text after a voicemail',
];

(async () => {
  if (process.env.RUN_LIVE_AI !== '1') {
    console.log('c7f-live: skipped (set RUN_LIVE_AI=1 to ask the real Groq API; it uses tokens)');
    return;
  }
  const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: process.env.AUDIT_PASSWORD }) });
  const { token } = await login.json();
  if (!token) throw new Error('login failed');
  for (const [i, question] of QUESTIONS.entries()) {
    const started = Date.now();
    const res = await fetch(`${api}/assistant/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Campaign-Id': '1' },
      body: JSON.stringify({ question, history: [] }),
    });
    const body = await res.json();
    console.log(`\n${String(i + 1).padStart(2, '0')}. ${question}  [${res.status}, ${Date.now() - started} ms, tools: ${(body.toolsUsed || []).join(', ') || 'none'}]`);
    console.log(body.answer || body.error);
    await new Promise((r) => setTimeout(r, 3500)); // stay under the assistant's 20 a minute
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
