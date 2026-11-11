// Hits every route from routes.json three ways (no token, garbage token,
// expired-but-correctly-signed token) and prints a status table.
// The expired token is signed with JWT_SECRET from backend/.env; the secret is
// never printed. Usage: node audit/scripts/auth-matrix.js audit/logs/routes.json
const fs = require('fs');
const path = require('path');
const backend = path.resolve(__dirname, '../../backend');
require(path.join(backend, 'node_modules/dotenv')).config({ path: path.join(backend, '.env') });
const jwt = require(path.join(backend, 'node_modules/jsonwebtoken'));

const API = process.env.API || 'http://localhost:4000';
const routes = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expired = jwt.sign({ sub: 1, email: 'x', role: 'supervisor', iat: 1000, exp: 2000 }, process.env.JWT_SECRET);
const wrongSecret = jwt.sign({ sub: 1, email: 'x', role: 'supervisor' }, 'not-the-real-secret');

(async () => {
  const rows = [];
  for (const r of routes) {
    const url = API + r.path.replace(/:[A-Za-z]+/g, '1');
    const res = {};
    for (const [label, header] of [['none', null], ['garbage', 'Bearer garbage'], ['expired', `Bearer ${expired}`], ['wrongSecret', `Bearer ${wrongSecret}`]]) {
      const headers = { 'content-type': 'application/json' };
      if (header) headers.authorization = header;
      const resp = await fetch(url, { method: r.method, headers, body: ['GET', 'DELETE'].includes(r.method) ? undefined : '{}' });
      res[label] = resp.status;
      // SSE endpoint would stay open on success; abort body
      try { await resp.body?.cancel(); } catch {}
      await new Promise((r) => setTimeout(r, Number(process.env.PACE_MS || 0)));
    }
    rows.push({ ...r, ...res });
  }
  // SSE uses ?token= instead of the header
  const sse = {};
  for (const [label, q] of [['none', ''], ['garbage', '?token=garbage'], ['expired', `?token=${expired}`], ['wrongSecret', `?token=${wrongSecret}`]]) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    try { const resp = await fetch(`${API}/api/calls/stream${q}`, { signal: ctl.signal }); sse[label] = resp.status; ctl.abort(); } catch (e) { sse[label] = 'timeout'; }
    clearTimeout(t);
  }

  console.log('| Method | Path | requireAuth | no token | garbage | expired | wrong secret |');
  console.log('|---|---|---|---|---|---|---|');
  let bad = 0;
  for (const r of rows) {
    const vals = [r.none, r.garbage, r.expired, r.wrongSecret];
    const expectPublic = r.path === '/api/auth/login' || r.path === '/health';
    const ok = expectPublic || vals.every((v) => v === 401);
    if (!ok) bad++;
    console.log(`| ${r.method} | \`${r.path}\` | ${r.auth ? 'yes' : 'no'} | ${vals.join(' | ')} |${ok ? '' : ' **NOT 401**'}`);
  }
  console.log(`| GET | \`/api/calls/stream?token=\` | own check | ${sse.none} | ${sse.garbage} | ${sse.expired} | ${sse.wrongSecret} |`);
  const protectedCount = rows.filter((r) => !(r.path === '/api/auth/login' || r.path === '/health')).length;
  console.log(`\nprotected routes tested: ${protectedCount} (+ SSE); routes not returning 401 for every bad token: ${bad}`);
})();
