// Schema-vs-code check. Read-only against the DB.
// 1. Every `INSERT INTO t (cols)` and `UPDATE t SET col = ...` in backend/src
//    services/routes/db is checked against information_schema.columns.
// 2. Every INSERT is printed with its column list, its VALUES placeholders and
//    the JS params array that follows it, so column/value order can be reviewed.
// Usage: DATABASE_URL=... node audit/scripts/schema-check.js
const fs = require('fs');
const path = require('path');
const { Client } = require(path.resolve(__dirname, '../../backend/node_modules/pg'));

const root = path.resolve(__dirname, '../../backend/src');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(root);

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`
  );
  await db.end();
  const schema = {};
  for (const r of rows) (schema[r.table_name] ||= new Set()).add(r.column_name);

  const problems = [];
  const inserts = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(path.resolve(root, '..', '..'), file);
    const lineOf = (idx) => src.slice(0, idx).split('\n').length;

    // INSERT INTO t (a, b, c) VALUES (...)  [params]
    const insRe = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)\s*(VALUES\s*\(([^)]*)\)|SELECT)?/gi;
    let m;
    while ((m = insRe.exec(src))) {
      const table = m[1];
      const cols = m[2].split(',').map((c) => c.trim()).filter(Boolean);
      const vals = m[4] ? m[4].split(',').map((v) => v.trim()) : null;
      if (!schema[table]) problems.push(`${rel}:${lineOf(m.index)} INSERT into unknown table ${table}`);
      else for (const c of cols) if (!schema[table].has(c)) problems.push(`${rel}:${lineOf(m.index)} INSERT ${table}.${c} — column does not exist`);
      // the params array: first [...] after the closing backtick of the query
      const after = src.slice(insRe.lastIndex, insRe.lastIndex + 1200);
      const tick = after.indexOf('`');
      const pm = tick >= 0 ? after.slice(tick).match(/,\s*(\[[\s\S]*?\])\s*\)/) : null;
      inserts.push({
        where: `${rel}:${lineOf(m.index)}`,
        table,
        cols,
        vals,
        params: pm ? pm[1].replace(/\s+/g, ' ') : '(params not found inline)',
        countMatch: vals ? vals.length === cols.length : 'n/a (INSERT … SELECT or multi-row)',
      });
    }

    // UPDATE t SET a = .., b = ..  (only static column names)
    const updRe = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|`)/gi;
    while ((m = updRe.exec(src))) {
      const table = m[1];
      if (!schema[table]) { problems.push(`${rel}:${lineOf(m.index)} UPDATE unknown table ${table}`); continue; }
      const setPart = m[2].replace(/\$\{[^}]*\}/g, '');
      const colRe = /(?:^|,)\s*(\w+)\s*=/g;
      let c;
      while ((c = colRe.exec(setPart))) {
        if (!schema[table].has(c[1])) problems.push(`${rel}:${lineOf(m.index)} UPDATE ${table}.${c[1]} — column does not exist`);
      }
    }
  }

  console.log(`tables in schema: ${Object.keys(schema).length}`);
  console.log(`\n== INSERT statements (${inserts.length}) — columns vs placeholders vs params`);
  for (const i of inserts) {
    console.log(`\n${i.where}  INSERT INTO ${i.table}`);
    console.log(`  cols   (${i.cols.length}): ${i.cols.join(', ')}`);
    console.log(`  values (${i.vals ? i.vals.length : '-'}): ${i.vals ? i.vals.join(', ') : '-'}   count match: ${i.countMatch}`);
    console.log(`  params: ${i.params.slice(0, 400)}`);
  }
  console.log(`\n== column/table problems: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
})().catch((e) => { console.error(e); process.exit(1); });
