// Extracts every API call from frontend/src/lib/api.js (request(...) calls plus
// raw fetch/EventSource uses anywhere in frontend/src) and matches each against
// the backend route list produced by routes.js --json.
// Usage: node audit/scripts/apijs-calls.js audit/logs/routes.json
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const routes = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const apiSrc = fs.readFileSync(path.join(root, 'frontend/src/lib/api.js'), 'utf8');

function normalize(p) {
  return p
    .replace(/\?.*$/, '')
    // a ${...} not preceded by "/" is a query-string suffix (e.g. ${qs ? `?${qs}` : ''})
    .replace(/([^/])\$\{.*$/, '$1')
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/\/+$/, '') || '/';
}

const calls = [];
// request(`/x/${id}`, { method: 'POST', ... })  or request('/x')
const re = /request\(\s*(`[^`]*`|'[^']*')\s*(?:,\s*\{([^}]*)\})?/g;
let m;
while ((m = re.exec(apiSrc))) {
  const raw = m[1].slice(1, -1);
  const method = (m[2] && m[2].match(/method:\s*'(\w+)'/)) ? m[2].match(/method:\s*'(\w+)'/)[1] : 'GET';
  // find the exported function name this call sits in
  const before = apiSrc.slice(0, m.index);
  const fn = [...before.matchAll(/export (?:(?:async )?function|const) (\w+)/g)].pop();
  calls.push({ fn: fn ? fn[1] : '?', method, path: '/api' + normalize(raw), raw });
}
// raw fetch / EventSource with API_URL outside request()
for (const mm of apiSrc.matchAll(/(fetch|new EventSource)\(\s*`\$\{API_URL\}([^`]*)`/g)) {
  if (mm[2].startsWith('${path}')) continue;
  const before = apiSrc.slice(0, mm.index);
  const fn = [...before.matchAll(/export (?:(?:async )?function|const) (\w+)/g)].pop();
  calls.push({ fn: fn ? fn[1] : '?', method: 'GET', path: '/api' + normalize(mm[2]), raw: mm[2] });
}

function matches(route, call) {
  if (route.method !== call.method) return false;
  const rx = new RegExp('^' + route.path.replace(/:[A-Za-z]+/g, '[^/]+') + '$');
  return rx.test(call.path.replace(/:param/g, 'X'));
}

console.log(`${calls.length} API calls found in frontend/src/lib/api.js\n`);
const used = new Set();
const missing = [];
for (const c of calls) {
  const r = routes.find((rt) => matches(rt, c));
  if (r) used.add(`${r.method} ${r.path}`);
  else missing.push(c);
  console.log(`${r ? 'OK     ' : 'MISSING'} ${c.method.padEnd(6)} ${c.path.padEnd(48)} ${c.fn}()${r ? '  -> ' + r.method + ' ' + r.path : ''}`);
}
// other files using fetch/EventSource directly
const extra = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e.name) && !p.endsWith('lib/api.js')) {
      const s = fs.readFileSync(p, 'utf8');
      for (const x of s.matchAll(/(fetch|EventSource)\(/g)) extra.push(`${path.relative(root, p)}:${s.slice(0, x.index).split('\n').length}`);
    }
  }
})(path.join(root, 'frontend/src'));

console.log(`\n== frontend calls with no backend route: ${missing.length}`);
missing.forEach((c) => console.log(`  ${c.method} ${c.path} (${c.fn})`));
const unused = routes.filter((r) => !used.has(`${r.method} ${r.path}`));
console.log(`\n== backend routes no api.js function calls: ${unused.length}`);
unused.forEach((r) => console.log(`  ${r.method} ${r.path}`));
console.log(`\n== fetch/EventSource outside lib/api.js: ${extra.length ? extra.join(', ') : 'none'}`);
