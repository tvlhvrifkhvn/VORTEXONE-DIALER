// No API key is ever written into the source (F-01). The Groq key comes only
// from GROQ_API_KEY (env, e.g. a Codespaces secret) or Settings → Integrations.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A real Groq key: "gsk_" and 20+ letters/digits. Test fakes say FAKE or STUB.
const GROQ_KEY = /gsk_(?!FAKE|STUB)[A-Za-z0-9]{20,}/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|json|sql|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('no Groq key is written into the backend or frontend source', () => {
  const roots = [path.join(__dirname, '../src'), path.join(__dirname, '../../frontend/src')];
  const hits = roots.flatMap((r) => walk(r)).filter((f) => GROQ_KEY.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(path.join(__dirname, '../..'), f)), []);
});

test('config.groqApiKey comes only from GROQ_API_KEY', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/config/index.js'), 'utf8');
  assert.match(src, /groqApiKey: process\.env\.GROQ_API_KEY \|\| null/);
});
