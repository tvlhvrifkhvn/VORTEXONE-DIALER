// Generates a synthetic lead file of any size for import tests (no real
// leads). Every row is one of the "kinds" below; the share of each messy kind
// is a parameter, and the rest are clean rows. Writes three files:
//   <out>                  the CSV or XLSX to upload
//   <out>.expected.json    expected summary buckets + the mapping guessMapping should pick
//   <out>.setup.sql        test-DB setup the file relies on (DNC numbers, DNC leads)
//
// Usage (from repo root):
//   node audit/scripts/gen-leads.js --rows 4000 --format csv --out /tmp/f.csv \
//        --existing /tmp/existing-phones.txt --avoid /tmp/all-phones.txt [--seed 7] [--style a|b]
//        [--mix ext=0.04,vanity=0.03,...]
//   --existing  phones of non-DNC leads already in the test DB (one E.164 per line)
//   --avoid     every phone already in the test DB (never generated as "new")
//   --style a   headers: Name, Mobile, Email, Office, Street, City, State, Zip, Source
//   --style b   headers: First Name, Last Name, Phone Number, E-mail, Company, Address, City, State, Postal Code, Website
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const ROWS = Number(args.rows);
const FORMAT = args.format || 'csv';
const OUT = args.out;
const STYLE = args.style || (FORMAT === 'xlsx' ? 'b' : 'a');
if (!ROWS || !OUT) throw new Error('--rows and --out are required');

// Share of rows per messy kind (fractions of the file). Overridable via --mix.
const MIX = {
  ext: 0.04, vanity: 0.03, missing_state_ok: 0.03,
  dup_full: 0.03, scrape_blank: 0.03, same_phone: 0.02, ambiguous: 0.015,
  existing: 0.03, dnc: 0.02, dnc_lead: 0.01,
  nophone: 0.03, unreadable: 0.02, invalid_noname: 0.01, invalid_nostate: 0.01,
};
for (const pair of (args.mix || '').split(',').filter(Boolean)) {
  const [k, v] = pair.split('=');
  if (!(k in MIX)) throw new Error(`unknown kind ${k}`);
  MIX[k] = Number(v);
}
// Rows each unit of a kind produces, and the bucket each of those rows lands in.
const UNIT = {
  clean: ['imported'], ext: ['imported'], vanity: ['imported'], missing_state_ok: ['imported'],
  dup_full: ['imported', 'merged'], scrape_blank: ['imported', 'merged'], same_phone: ['imported', 'merged'],
  ambiguous: ['imported', 'imported', 'invalid'],
  existing: ['alreadyInList'], dnc: ['dncBlocked'], dnc_lead: ['dncBlocked'],
  nophone: ['noNumber'], unreadable: ['noNumber'], invalid_noname: ['invalid'], invalid_nostate: ['invalid'],
};

// Deterministic PRNG so a seed reproduces the same file.
let seed = Number(args.seed || 1) >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const AREA = {
  TX: ['214', '469', '713', '512'], CA: ['213', '310', '415', '619'], NY: ['212', '718', '917'],
  FL: ['305', '407', '813'], IL: ['312', '773'], AZ: ['602', '480'], GA: ['404'], WA: ['206'],
  CO: ['303'], PA: ['215'], OH: ['614'], NC: ['704'], MI: ['313'], NJ: ['201'], MA: ['617'],
  VA: ['703'], TN: ['615'], MO: ['314'], NV: ['702'], OR: ['503'],
};
const CITY = {
  TX: ['Dallas', 'Houston', 'Austin'], CA: ['Los Angeles', 'San Diego', 'San Francisco'], NY: ['New York', 'Brooklyn'],
  FL: ['Miami', 'Orlando', 'Tampa'], IL: ['Chicago'], AZ: ['Phoenix', 'Mesa'], GA: ['Atlanta'], WA: ['Seattle'],
  CO: ['Denver'], PA: ['Philadelphia'], OH: ['Columbus'], NC: ['Charlotte'], MI: ['Detroit'], NJ: ['Newark'],
  MA: ['Boston'], VA: ['Arlington'], TN: ['Nashville'], MO: ['St. Louis'], NV: ['Las Vegas'], OR: ['Portland'],
};
const STATES = Object.keys(AREA);
const FIRST = ['Avery', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Quinn', 'Harper', 'Rowan', 'Elliot', 'Skyler', 'Dakota', 'Reese', 'Parker', 'Logan', 'Emerson', 'Finley', 'Hayden', 'Kendall', 'Marlow', 'Oakley', 'Peyton', 'Sawyer', 'Tatum', 'Blake', 'Cameron', 'Drew', 'Frankie', 'Gray'];
const LAST = ['Abbott', 'Barlow', 'Castillo', 'Delaney', 'Ellison', 'Fairbanks', 'Garrison', 'Holloway', 'Ingram', 'Jennings', 'Kowalczyk', 'Lindqvist', 'Mercado', 'Nakamura', 'Okafor', 'Pemberton', 'Quintero', 'Rasmussen', 'Sandoval', 'Thornton', 'Underwood', 'Valdez', 'Whitaker', 'Yamamoto', 'Zimmerman', 'Ashworth', 'Bellamy', 'Crowley', 'Donnelly', 'Esposito', 'Fitzgerald', 'Galloway', 'Hargrove', 'Iverson', 'Kingsley', 'Lockhart', 'Montague', 'Northcott', 'Ormsby', 'Prescott'];
const BROKERS = ['Keller Williams Realty', 'RE/MAX Advantage', 'Coldwell Banker', 'eXp Realty', 'Compass', 'Century 21 Elite', 'Sotheby’s International', 'Berkshire Hathaway HomeServices'];
const SOURCES = ['kw.com', 'remax.com', 'coldwellbanker.com', 'exprealty.com', 'compass.com', 'century21.com'];
const UNREADABLE = ['call office', 'see website', 'ask front desk', 'n/a', '555-01', '123', '(000) 000-0000', 'office line'];
const KEYPAD = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };

const readList = (f) => (f ? fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);
const avoid = new Set(readList(args.avoid));
const existingPool = readList(args.existing);
const usedPhones = new Set();
const usedNames = new Set();

function newPhone({ state = pick(STATES), lineDigits = '0123456789' } = {}) {
  for (;;) {
    const ac = pick(AREA[state]);
    let ex = String(200 + Math.floor(rand() * 800));
    if (ex === '555' || /11$/.test(ex)) continue;
    let line = '';
    for (let i = 0; i < 4; i++) line += lineDigits[Math.floor(rand() * lineDigits.length)];
    const e164 = `+1${ac}${ex}${line}`;
    if (avoid.has(e164) || usedPhones.has(e164)) continue;
    usedPhones.add(e164);
    return { e164, ac, ex, line, state };
  }
}
function fmt({ ac, ex, line }) {
  return pick([
    `(${ac}) ${ex}-${line}`, `${ac}.${ex}.${line}`, `+1 ${ac} ${ex} ${line}`, `1-${ac}-${ex}-${line}`,
    `${ac}${ex}${line}`, `  ${ac}-${ex}-${line}  `,
  ]);
}
function fmtE164(e164) {
  const d = e164.slice(2);
  return fmt({ ac: d.slice(0, 3), ex: d.slice(3, 6), line: d.slice(6) });
}
function newName() {
  for (;;) {
    const first = pick(FIRST);
    const last = pick(LAST);
    // One middle initial gives 31,200 names; a second one (only once the
    // first pool is mostly used) keeps very large files unique.
    const mid = String.fromCharCode(65 + Math.floor(rand() * 26));
    const mid2 = usedNames.size > 25000 ? ` ${String.fromCharCode(65 + Math.floor(rand() * 26))}.` : '';
    const full = `${first} ${mid}.${mid2} ${last}`;
    if (usedNames.has(full)) continue;
    usedNames.add(full);
    return { first: `${first} ${mid}.${mid2}`, last, full };
  }
}
function messy(s) {
  if (rand() > 0.1) return s;
  return pick([`  ${s}  `, s.toUpperCase(), s.toLowerCase(), s.replace(' ', '   ')]);
}

// One row in a neutral shape; written out per --style at the end.
function person({ phone, state, name = newName(), blankState = false, email = true }) {
  const st = state || (phone && phone.state) || pick(STATES);
  return {
    name, phoneText: phone ? fmt(phone) : '',
    email: email && rand() > 0.15 ? `${name.last.toLowerCase()}${Math.floor(rand() * 1000)}@example.com` : '',
    brokerage: rand() > 0.2 ? pick(BROKERS) : '', source: pick(SOURCES),
    street: `${100 + Math.floor(rand() * 9800)} ${pick(['Main', 'Oak', 'Pine', 'Elm', 'Maple'])} St`,
    city: pick(CITY[st]), state: blankState ? '' : st, zip: String(10000 + Math.floor(rand() * 89999)),
  };
}

const kindCounts = {};
const units = [];
for (const [kind, rate] of Object.entries(MIX)) {
  const n = Math.floor((ROWS * rate) / UNIT[kind].length);
  kindCounts[kind] = n;
  for (let i = 0; i < n; i++) units.push(kind);
}
let rowsSoFar = units.reduce((s, k) => s + UNIT[k].length, 0);
kindCounts.clean = Math.max(0, ROWS - rowsSoFar);
for (let i = 0; i < kindCounts.clean; i++) units.push('clean');

const rows = [];
const expected = { totalRows: 0, imported: 0, merged: 0, alreadyInList: 0, dncBlocked: 0, noNumber: 0, unreadable: 0, invalid: 0, withExtension: 0 };
const setupSql = [];
let existingIdx = 0;
const takeExisting = () => {
  if (existingIdx >= existingPool.length) throw new Error('not enough --existing phones for this size');
  return existingPool[existingIdx++];
};

for (const kind of units) {
  for (const b of UNIT[kind]) expected[b] += 1;
  if (kind === 'clean') rows.push(person({ phone: newPhone() }));
  else if (kind === 'ext') {
    const p = person({ phone: newPhone() });
    p.phoneText = `${p.phoneText.trim()}${pick([' x', ' ext ', ' ext. ', ' x'])}${1 + Math.floor(rand() * 999)}`;
    expected.withExtension += 1;
    rows.push(p);
  } else if (kind === 'vanity') {
    const ph = newPhone({ lineDigits: '23456789' });
    const p = person({ phone: ph });
    p.phoneText = `${ph.ac}-${ph.ex}-${[...ph.line].map((d) => pick(KEYPAD[d].split(''))).join('')}`;
    rows.push(p);
  } else if (kind === 'missing_state_ok') {
    const p = person({ phone: newPhone(), blankState: true });
    p.city = '';
    rows.push(p);
  } else if (kind === 'dup_full') {
    const p = person({ phone: newPhone() });
    rows.push(p, { ...p, email: '', brokerage: '', name: { ...p.name }, phoneText: fmtE164(`+1${p.phoneText.replace(/\D/g, '').slice(-10)}`) });
  } else if (kind === 'scrape_blank') {
    const p = person({ phone: newPhone() });
    rows.push(p, { name: p.name, phoneText: '', email: '', brokerage: '', source: '', street: '', city: '', state: '', zip: '' });
  } else if (kind === 'same_phone') {
    const p = person({ phone: newPhone() });
    rows.push(p, { ...person({ phone: null, state: p.state }), phoneText: fmtE164(`+1${p.phoneText.replace(/\D/g, '').slice(-10)}`) });
  } else if (kind === 'ambiguous') {
    const name = newName();
    const s1 = pick(STATES);
    let s2 = pick(STATES);
    while (s2 === s1) s2 = pick(STATES);
    rows.push(person({ name, phone: newPhone({ state: s1 }) }), person({ name, phone: newPhone({ state: s2 }) }));
    rows.push({ name, phoneText: '', email: '', brokerage: '', source: '', street: '', city: '', state: '', zip: '' });
  } else if (kind === 'existing') {
    const e164 = takeExisting();
    const p = person({ phone: null });
    p.phoneText = fmtE164(e164);
    rows.push(p);
  } else if (kind === 'dnc') {
    const ph = newPhone();
    setupSql.push(`INSERT INTO dnc_list (phone, source) VALUES ('${ph.e164}', 'manual') ON CONFLICT DO NOTHING;`);
    rows.push(person({ phone: ph }));
  } else if (kind === 'dnc_lead') {
    const e164 = takeExisting();
    // Legacy-style DNC lead: flagged on the lead, number NOT on dnc_list.
    setupSql.push(`UPDATE leads SET status = 'dnc', dnc_flag = true, locked_by = NULL, locked_at = NULL WHERE phone = '${e164}';`);
    const p = person({ phone: null });
    p.phoneText = fmtE164(e164);
    rows.push(p);
  } else if (kind === 'nophone') {
    rows.push(person({ phone: null }));
  } else if (kind === 'unreadable') {
    const p = person({ phone: null });
    p.phoneText = pick(UNREADABLE);
    expected.unreadable += 1;
    rows.push(p);
  } else if (kind === 'invalid_noname') {
    const p = person({ phone: newPhone() });
    p.name = { first: '', last: '', full: '' };
    rows.push(p);
  } else if (kind === 'invalid_nostate') {
    const p = person({ phone: null });
    Object.assign(p, { state: '', city: '', street: '', zip: '' });
    rows.push(p);
  }
}
expected.totalRows = rows.length;

// Shuffle so pairs/groups are spread through the file.
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

const HEADERS = {
  a: ['Name', 'Mobile', 'Email', 'Office', 'Street', 'City', 'State', 'Zip', 'Source'],
  b: ['First Name', 'Last Name', 'Phone Number', 'E-mail', 'Company', 'Address', 'City', 'State', 'Postal Code', 'Website'],
};
const toRecord = (r) =>
  STYLE === 'a'
    ? [messy(r.name.full), r.phoneText, messy(r.email), r.brokerage, r.street, r.city, r.state, r.zip, r.source]
    : [messy(r.name.first), r.name.last, r.phoneText, messy(r.email), r.brokerage, r.street, r.city, r.state, r.zip, r.source];
expected.mapping = STYLE === 'a'
  ? { name: 'Name', phone: 'Mobile', email: 'Email', brokerage: 'Office', address: 'Street', city: 'City', state: 'State', zip: 'Zip', source: 'Source' }
  : { first_name: 'First Name', last_name: 'Last Name', phone: 'Phone Number', email: 'E-mail', brokerage: 'Company', address: 'Address', city: 'City', state: 'State', zip: 'Postal Code', source: 'Website' };
expected.kindCounts = kindCounts;

const records = rows.map(toRecord);
if (FORMAT === 'xlsx') {
  const XLSX = require(path.resolve(__dirname, '../../backend/node_modules/xlsx'));
  const ws = XLSX.utils.aoa_to_sheet([HEADERS[STYLE], ...records]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.writeFile(wb, OUT);
} else {
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  fs.writeFileSync(OUT, [HEADERS[STYLE], ...records].map((r) => r.map((v) => esc(String(v ?? ''))).join(',')).join('\n') + '\n');
}
fs.writeFileSync(`${OUT}.expected.json`, JSON.stringify(expected, null, 2));
fs.writeFileSync(`${OUT}.setup.sql`, setupSql.join('\n') + '\n');
// Every number this file uses, so a second generated file can avoid them.
fs.writeFileSync(`${OUT}.phones.txt`, [...usedPhones].join('\n') + '\n');
console.log(`wrote ${OUT}: ${rows.length} rows (${STYLE}), ${fs.statSync(OUT).size} bytes; expected ${JSON.stringify({ ...expected, mapping: undefined, kindCounts: undefined })}`);
