// Turns fix-seg5-import.sh output into one markdown row per run.
// Usage: node audit/scripts/seg5-import-table.js <output file>
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const runs = {};
for (const line of text.split('\n')) {
  const m = line.match(/^\[([^\]]+)\] (.*)$/);
  if (!m) continue;
  const [, label, rest] = m;
  const r = (runs[label] = runs[label] || { label });
  let x;
  if ((x = rest.match(/^file \S+: (\d+) rows, (\d+) bytes/))) Object.assign(r, { rows: +x[1], bytes: +x[2] });
  if ((x = rest.match(/backend RSS before (\d+) MB/))) r.rssBefore = +x[1];
  if ((x = rest.match(/^upload -> HTTP (\d+)/))) r.upload = +x[1];
  if ((x = rest.match(/auto mapping matches the expected columns: (\w+)/))) r.mapping = x[1];
  if ((x = rest.match(/final status=(\w+) after ([\d.]+) s, (\d+) requests/))) Object.assign(r, { status: x[1], secs: +x[2], requests: +x[3] });
  if ((x = rest.match(/accounting rule: .* -> (\w+)/))) r.accounting = x[1];
  if ((x = rest.match(/buckets vs expected: (.*)$/))) r.buckets = x[1];
  if ((x = rest.match(/skipped-rows CSV: .* -> (\w+)/))) r.csv = x[1];
  if ((x = rest.match(/peak backend RSS (\d+) MB/))) r.rssPeak = +x[1];
  if ((x = rest.match(/re-import same file: status=(\w+) in ([\d.]+) s; new leads in DB: (\d+)/))) Object.assign(r, { reimportNew: +x[3], reimportSecs: +x[2] });
  if ((x = rest.match(/cancel test: cancel sent at \[([^\]]*)\] -> HTTP (\d+) .*"written":(\d+)/))) Object.assign(r, { cancelAt: x[1].replace(/ status=\w+/, ''), cancelHttp: +x[2], cancelWritten: +x[3] });
  if ((x = rest.match(/cancel test: .*finished before/))) r.cancelAt = 'finished first (too_late)';
  if ((x = rest.match(/cancel test: job ended status=(\w+); leads written by this job: (\d+); reported written: (\d+)/))) Object.assign(r, { cancelEnd: x[1], cancelDb: +x[2], cancelReported: +x[3] });
  if ((x = rest.match(/dial sample \((\d+) imported leads\): (.*)$/))) r.dial = `${(x[2].match(/:201/g) || []).length}/${x[1]} → 201`;
  if ((x = rest.match(/^server log: (\d+) error/))) r.errors = +x[1];
}
const rows = Object.values(runs).filter((r) => r.rows);
console.log('| Run | Rows | File | Upload | Mapping (AI off) | Time | Requests | Peak RSS (start) | Buckets | Rows accounted | Skipped CSV | Re-import new | Cancel mid-way (answer → end) | Dial sample | Server errors |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const cancel = r.cancelEnd
    ? `${r.cancelAt}: ${r.cancelHttp} written ${r.cancelWritten} → ${r.cancelEnd}, ${r.cancelDb} in DB = ${r.cancelReported} reported`
    : r.cancelAt || '—';
  console.log(
    `| ${r.label} | ${r.rows} | ${(r.bytes / 1024 / 1024).toFixed(2)} MB | ${r.upload} | ${r.mapping || '—'} | ${r.secs ?? '—'} s | ${r.requests ?? '—'} | ${r.rssPeak ?? '—'} MB (${r.rssBefore} MB) | ${r.buckets || '—'} | ${r.accounting || '—'} | ${r.csv || '—'} | ${r.reimportNew ?? '—'} | ${cancel} | ${r.dial || '—'} | ${r.errors ?? '—'} |`
  );
}
