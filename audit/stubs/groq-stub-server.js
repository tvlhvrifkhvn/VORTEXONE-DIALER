// STUB — a local stand-in for api.groq.com used ONLY by the audit.
// The backend's groq-sdk honours the GROQ_BASE_URL env var, so starting the
// backend with GROQ_BASE_URL=http://127.0.0.1:4999 routes every AI call here
// instead of to Groq; no source file is touched. Anything tested through this
// stub is labelled "stubbed" in AUDIT_REPORT.md — it proves the code AROUND the
// model (prompt assembly, parsing, validation, retry, fallback), never the
// model's real output quality.
//
// Every request body is appended to $STUB_LOG (JSONL) so the exact prompt the
// app assembled can be quoted. Behaviour is scripted per call type by the file
// $STUB_MODE_FILE (JSON), re-read on every request, e.g.
//   {"rebuttal":["banned","clean"], "clean":"echo", "brief":"ok", "delayMs":0}
// Arrays are consumed one entry per request (a queue); a string is sticky.
const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.STUB_PORT || 4999);
const LOG = process.env.STUB_LOG || '/var/tmp/audit-scratch/groq-stub-requests.jsonl';
const MODE_FILE = process.env.STUB_MODE_FILE || '/var/tmp/audit-scratch/groq-stub-mode.json';

function readMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, 'utf8')); } catch { return {}; }
}
function nextBehaviour(kind, fallback) {
  const mode = readMode();
  const v = mode[kind];
  if (Array.isArray(v)) {
    const head = v.shift();
    mode[kind] = v;
    fs.writeFileSync(MODE_FILE, JSON.stringify(mode));
    return head ?? fallback;
  }
  return v ?? fallback;
}

function classify(messages) {
  const all = messages.map((m) => m.content).join('\n');
  if (all.includes('You are mapping CSV columns')) return 'mapping';
  if (all.includes('Return ONLY a JSON array with the same number of rows')) return 'clean';
  if (/cold caller for Vortexone/i.test(all) || all.includes('"suggestions"')) return 'rebuttal';
  if (/brief/i.test(messages[0]?.content || '')) return 'brief';
  return 'other';
}

function mappingAnswer(prompt) {
  const headers = JSON.parse(prompt.match(/CSV headers: (\[.*\])/)[1]);
  const pick = (re) => headers.find((h) => re.test(h)) ?? null;
  return JSON.stringify({
    mapping: {
      name: pick(/name/i), phone: pick(/phone|mobile|cell/i), email: pick(/mail/i), address: pick(/address|street/i),
      brokerage: pick(/office|brokerage|company/i), state: pick(/^state$/i), city: pick(/city|locality/i), source: pick(/source/i),
    },
    confidence: { name: 'high', phone: 'high', email: 'high', address: 'medium', brokerage: 'high', state: 'high', city: 'medium', source: 'medium' },
  });
}

function cleanAnswer(prompt, behaviour) {
  if (behaviour === 'fail') return null;
  if (behaviour === 'garbage') return 'sorry, I cannot do that';
  const lines = prompt.split('\n').filter((l) => /^\d+: \{/.test(l));
  const out = lines.map((l) => {
    const idx = Number(l.slice(0, l.indexOf(':')));
    const fields = JSON.parse(l.slice(l.indexOf(':') + 1));
    return { index: idx, name: String(fields.name || '').replace(/\s*license\s*#?:?.*$/i, '').trim(), state: fields.state || '', address: fields.address || '', skip: false };
  });
  return JSON.stringify(out);
}

const REBUTTALS = {
  clean: ['Totally fair. What does an hour of your time go for right now?', "Makes sense. Want me to send a one-page overview you can skim later?", "Got it. Could we try a single week of follow-ups and see?"],
  banned: ['We leverage seamless synergy to unlock your growth.', 'Our innovative solution will optimize your day.', 'Let me circle back with a win-win offer.'],
  long: ['This is a deliberately long rebuttal that keeps going well past the thirty word limit so that the length validation in the service has something concrete to flag and retry for us here.', 'Short one.', 'Another short one.'],
};

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    let json = {};
    try { json = JSON.parse(body || '{}'); } catch {}
    const messages = json.messages || [];
    const kind = classify(messages);
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), path: req.url, kind, model: json.model, temperature: json.temperature, messages }) + '\n');
    const delay = Number(readMode().delayMs || 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));

    let content;
    if (kind === 'mapping') content = mappingAnswer(messages[0].content);
    else if (kind === 'clean') content = cleanAnswer(messages[0].content, nextBehaviour('clean', 'echo'));
    else if (kind === 'rebuttal') {
      const b = nextBehaviour('rebuttal', 'clean');
      if (b === 'fail') content = null;
      else if (b === 'malformed') content = 'here are some ideas: not json';
      else content = JSON.stringify({ suggestions: REBUTTALS[b] || REBUTTALS.clean });
    } else if (kind === 'brief') {
      const b = nextBehaviour('brief', 'ok');
      content = b === 'fail' ? null : JSON.stringify({ summary: 'STUB summary of past contact.', opener: 'STUB opener line.' });
    } else content = 'STUB expanded note.';

    if (content === null) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'stubbed upstream failure' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'stub', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: json.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`groq stub listening on ${PORT}`));
