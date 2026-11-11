// Lists every bare import/require specifier in frontend/src and backend/src and
// checks it against the package.json of that side. Read-only.
// Usage: node audit/scripts/deps-check.js
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const root = path.resolve(__dirname, '..', '..');
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function pkgName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

for (const side of ['frontend', 'backend']) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, side, 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const used = new Map();
  const files = walk(path.join(root, side, 'src'));
  const configFiles = ['vite.config.js', 'tailwind.config.js', 'postcss.config.js']
    .map((f) => path.join(root, side, f))
    .filter((f) => fs.existsSync(f));
  for (const file of [...files, ...configFiles]) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/') || builtins.has(spec) || builtins.has(pkgName(spec))) continue;
      const name = pkgName(spec);
      if (!used.has(name)) used.set(name, new Set());
      used.get(name).add(path.relative(root, file));
    }
  }
  console.log(`\n== ${side}: ${used.size} external packages imported`);
  for (const [name, where] of [...used].sort()) {
    const ok = declared[name];
    const installed = fs.existsSync(path.join(root, side, 'node_modules', name, 'package.json'));
    console.log(`${ok ? 'DECLARED  ' : 'UNDECLARED'} ${name.padEnd(28)} ${ok || '-'}  installed=${installed}  (${where.size} file(s), e.g. ${[...where][0]})`);
  }
  const unused = Object.keys(pkg.dependencies || {}).filter((d) => !used.has(d));
  console.log(`declared dependencies never imported in src/: ${unused.join(', ') || 'none'}`);
}
