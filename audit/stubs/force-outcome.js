// STUB (test harness) — preloaded with NODE_OPTIONS=--require to make the mock
// telephony adapter's random outcome deterministic. mockAdapter.randomOutcome()
// maps Math.random(): <0.35 answered, <0.55 voicemail, <0.70 busy, else no_answer.
// If /var/tmp/audit-scratch/force-outcome contains one of those words, every
// Math.random() call returns a value in that band; if the file is absent or
// empty, Math.random is the real one. Labelled "forced outcome" in the report.
const fs = require('fs');
const FILE = process.env.FORCE_OUTCOME_FILE || '/var/tmp/audit-scratch/force-outcome';
const real = Math.random;
const BAND = { answered: 0.1, voicemail: 0.4, busy: 0.6, no_answer: 0.9 };
Math.random = function patchedRandom() {
  let mode = '';
  try { mode = fs.readFileSync(FILE, 'utf8').trim(); } catch {}
  return mode in BAND ? BAND[mode] : real();
};
