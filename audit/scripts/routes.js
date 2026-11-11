// Enumerates every backend route (method + full path) by loading each router
// and walking its stack, using the mount prefixes from src/index.js.
// Also detects whether each route sits behind requireAuth.
// Usage (from backend/): node ../audit/scripts/routes.js [--json]
const fs = require('fs');
const path = require('path');

const backend = path.resolve(__dirname, '../../backend');
process.chdir(backend);
const indexSrc = fs.readFileSync(path.join(backend, 'src/index.js'), 'utf8');

// const xRoutes = require('./routes/x');  +  app.use('/api/x', xRoutes);
const reqMap = {};
for (const m of indexSrc.matchAll(/const (\w+) = require\('\.\/routes\/(\w+)'\)/g)) reqMap[m[1]] = m[2];
const mounts = [];
for (const m of indexSrc.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g)) if (reqMap[m[2]]) mounts.push([m[1], reqMap[m[2]]]);

const { requireAuth } = require(path.join(backend, 'src/middleware/auth'));
const out = [];
for (const [prefix, file] of mounts) {
  const router = require(path.join(backend, 'src/routes', file));
  // Router-level middleware registered with router.use(requireAuth) before a route protects it.
  let authSoFar = false;
  for (const layer of router.stack) {
    if (!layer.route) {
      if (layer.handle === requireAuth) authSoFar = true;
      continue;
    }
    const routeAuth = layer.route.stack.some((l) => l.handle === requireAuth);
    for (const method of Object.keys(layer.route.methods)) {
      out.push({ method: method.toUpperCase(), path: prefix + (layer.route.path === '/' ? '' : layer.route.path), file: `routes/${file}.js`, auth: authSoFar || routeAuth });
    }
  }
}
out.push({ method: 'GET', path: '/health', file: 'index.js', auth: false });
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`${out.length} routes`);
  for (const r of out) console.log(`${r.method.padEnd(6)} ${r.path.padEnd(48)} auth=${r.auth ? 'requireAuth' : 'NONE'}  ${r.file}`);
}
process.exit(0);
