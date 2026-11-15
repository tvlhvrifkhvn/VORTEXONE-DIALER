// Checks the token pairs from docs/DESIGN.md section 8 in both themes.
// Reads src/styles/globals.css; no dependencies. Exits 1 if any pair fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../src/styles/globals.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorTest) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (selectorTest(m[1].split(';').pop().trim())) {
      const vars = {};
      for (const v of m[2].matchAll(/--([\w-]+)\s*:\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
        vars[v[1]] = [Number(v[2]), Number(v[3]), Number(v[4])];
      }
      return vars;
    }
  }
  throw new Error(`token block not found in ${cssPath}`);
}

const ink = block((sel) => sel.split(',').some((s) => s.trim() === ':root'));
const paper = { ...ink, ...block((sel) => /\[data-theme=['"]paper['"]\]/.test(sel) && !sel.includes(',')) };

const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = 4.5;
const UI = 3;
const pairs = [];
for (const fg of ['foreground', 'muted-foreground', 'signal-text']) {
  for (const bg of ['background', 'card', 'muted']) pairs.push(['text', fg, bg, TEXT]);
}
pairs.push(['text', 'primary-foreground', 'primary', TEXT]);
pairs.push(['text', 'background', 'foreground', TEXT]);
for (const bg of ['background', 'card']) pairs.push(['ui', 'border-strong', bg, UI]);
pairs.push(['ui', 'primary', 'meter-track', UI]);
for (const bg of ['background', 'card']) pairs.push(['ui', 'ring', bg, UI]);
pairs.push(['ui', 'primary-border', 'background', UI]);

let failed = 0;
for (const [name, t] of [['ink', ink], ['paper', paper]]) {
  console.log(`\n${name.toUpperCase()}`);
  console.log('kind  foreground            on background         ratio   min  result');
  let lowest = null;
  for (const [kind, fg, bg, min] of pairs) {
    if (!t[fg] || !t[bg]) {
      console.log(`missing token: --${!t[fg] ? fg : bg}`);
      failed++;
      continue;
    }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    if (!lowest || r < lowest.r) lowest = { r, fg, bg };
    console.log(
      `${kind.padEnd(5)} ${fg.padEnd(21)} ${bg.padEnd(21)} ${r.toFixed(2).padStart(5)}  ${String(min).padStart(3)}  ${ok ? 'PASS' : 'FAIL'}`,
    );
  }
  console.log(`lowest: ${lowest.fg} on ${lowest.bg} ${lowest.r.toFixed(2)}:1`);
}

console.log(failed ? `\n${failed} pair(s) FAIL` : '\nAll pairs pass');
process.exit(failed ? 1 : 0);
