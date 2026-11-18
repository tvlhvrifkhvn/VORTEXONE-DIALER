// Reads a call-report PDF (via pdftotext -layout) and prints JSON:
//   headline: the six summary numbers; rows: table rows; status: rows per status;
//   header: the first two lines; empty: whether "No calls recorded" is shown.
// Usage: node pdf-numbers.js <file.pdf>
const { execFileSync } = require('child_process');
const text = execFileSync('pdftotext', ['-layout', process.argv[2], '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const lines = text.split('\n');
const labelIdx = lines.findIndex((l) => /Total Dials/.test(l));
let headline = null;
if (labelIdx >= 0) {
  const values = lines.slice(labelIdx + 1).find((l) => l.trim()).trim().split(/\s{2,}/);
  const [dials, contacts, voicemails, noAnswers, dnc, connectRate] = values;
  headline = { dials: +dials, contacts: +contacts, voicemails: +voicemails, noAnswers: +noAnswers, dnc: +dnc, connectRate };
}
const STATUSES = ['Contacted', 'Voicemail', 'No Answer', 'DNC', 'Callback', 'Bad Number', 'No Contact', 'Abandoned', 'Not logged', 'In progress', 'Dial pad'];
const statusRe = new RegExp(`\\s(${STATUSES.join('|')})(\\s|$)`);
const status = {};
let rows = 0;
for (const l of lines) {
  if (!/^\s{0,6}\d+\s{2,}/.test(l)) continue; // a row starts with its index number
  const m = statusRe.exec(l);
  if (!m) continue;
  rows += 1;
  status[m[1]] = (status[m[1]] || 0) + 1;
}
console.log(JSON.stringify({
  headline, rows, status,
  header: lines.filter((l) => l.trim()).slice(0, 2).map((l) => l.trim().replace(/\s+/g, ' ')),
  empty: /No calls recorded/.test(text),
}));
