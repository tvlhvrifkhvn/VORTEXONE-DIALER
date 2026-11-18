// Generates the §3 import fixtures in audit/fixtures/. All data is fake: names
// are invented and every phone uses the NANP 555 exchange.
// Usage: node audit/scripts/make-fixtures.js
const fs = require('fs');
const path = require('path');
const XLSX = require(path.resolve(__dirname, '../../backend/node_modules/xlsx'));

const dir = path.resolve(__dirname, '../fixtures');
fs.mkdirSync(dir, { recursive: true });
const H = 'name,phone,email,office,source,city,state';
const w = (f, s) => fs.writeFileSync(path.join(dir, f), s);

// (a) clean — 10 distinct agents
w('a_clean.csv', [H,
  'Alice Archer,(214) 555-0101,alice@example.com,Keller Williams,kw.com,Dallas,TX',
  'Ben Brooks,713-555-0102,ben@example.com,RE/MAX,remax.com,Houston,TX',
  'Cara Cole,+1 305 555 0103,cara@example.com,Compass,compass.com,Miami,FL',
  'Dan Diaz,6025550104,dan@example.com,eXp Realty,exp.com,Phoenix,AZ',
  'Eve Evans,+13035550105,eve@example.com,Coldwell Banker,cb.com,Denver,CO',
  'Finn Ford,(415) 555-0106,finn@example.com,Redfin,redfin.com,San Francisco,CA',
  'Gia Grant,212.555.0107,gia@example.com,Douglas Elliman,elliman.com,New York,NY',
  'Hal Hayes,808-555-0108,hal@example.com,Island Realty,ir.com,Honolulu,HI',
  'Ivy Irwin,(850) 555-0109,ivy@example.com,Panhandle Homes,ph.com,Pensacola,FL',
  'Jay Jones,(915) 555-0110,jay@example.com,Sun City Realty,sc.com,El Paso,TX',
].join('\n') + '\n');

// (b) scrape artifact: dirty name + contact details, then same name with everything blank
w('b_scrape.csv', [H,
  'Joshua Barkes License #: 0123456,(214) 555-0201,josh@example.com,Keller Williams,,Dallas,TX',
  'Joshua Barkes,,,,,,',                       // b1: same name, EVERYTHING else blank (incl. city)
  'Kara Knox License # 999,(214) 555-0202,kara@example.com,Keller Williams,,Dallas,TX',
  'Kara Knox,,,,,Dallas,TX',                   // b2: same name, same city/state kept
].join('\n') + '\n');

// (c) brokerage only in source
w('c_source.csv', [H,
  'Lia Lane,(305) 555-0301,,,Compass,Miami,FL',
  'Max Moore,(305) 555-0302,,Douglas Elliman,elliman.com,Miami,FL',
].join('\n') + '\n');

// (d) no phone
w('d_nophone.csv', [H,
  'Nia Noble,,nia@example.com,Coldwell,cb.com,Boise,ID',
  'Oto Orr,   ,,Coldwell,cb.com,Boise,ID',
].join('\n') + '\n');

// (e) same name: different city (must NOT merge) vs same city (must merge)
w('e_merge.csv', [H,
  'Pat Price,(512) 555-0501,,Keller Williams,,Austin,TX',
  'Pat Price,(713) 555-0502,,RE/MAX,,Houston,TX',      // different city -> separate person
  'Quinn Quade,(512) 555-0503,,Keller Williams,,Austin,TX',
  'Quinn Quade,,quinn@example.com,,,Austin,TX',         // same city -> merge, gains email
].join('\n') + '\n');

// (f) phone formats
w('f_phones.csv', [H,
  'Phone Plus One,+1 (602) 555-0601,,X,,Phoenix,AZ',
  'Phone Parens,(602) 555-0602,,X,,Phoenix,AZ',
  'Phone Dashes,602-555-0603,,X,,Phoenix,AZ',
  'Phone TenDigit,6025550604,,X,,Phoenix,AZ',
  'Phone Extension,602-555-0605 x123,,X,,Phoenix,AZ',
  'Phone Letters,602-555-CALL,,X,,Phoenix,AZ',
  'Phone Junk,not a phone,,X,,Phoenix,AZ',
  'Phone Short,555-0608,,X,,Phoenix,AZ',
  'Phone Eleven No Plus,16025550609,,X,,Phoenix,AZ',
  'Phone Intl,+44 20 7946 0610,,X,,Phoenix,AZ',
].join('\n') + '\n');

// (g) state handling
w('g_state.csv', [H,
  'State Given,(305) 555-0701,,X,,Miami,FL',
  'State Lowercase,(305) 555-0702,,X,,Miami,fl',
  'State Full Name,(305) 555-0703,,X,,Miami,Florida',
  'State From Area Code,(808) 555-0704,,X,,,',
  'State Invalid,(808) 555-0705,,X,,,ZZ',
  'State Mismatch,(808) 555-0706,,X,,Dallas,TX',
].join('\n') + '\n');

// (h) DNC — the phone is put on the DNC list by the test first
w('h_dnc.csv', [H,
  'Dnc Again,(214) 555-0101,,Keller Williams,,Dallas,TX',   // Alice Archer's number, DNC'd in the test
  'Not Dnc,(214) 555-0801,,Keller Williams,,Dallas,TX',
].join('\n') + '\n');

// (i) multi-sheet xlsx: two data sheets with different column orders + one empty sheet
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'phone', 'state'], ['Sheet One A', '(602) 555-0901', 'AZ'], ['Sheet One B', '(602) 555-0902', 'AZ']]), 'Phoenix');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['state', 'name', 'phone'], ['CO', 'Sheet Two A', '(303) 555-0903']]), 'Denver');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
XLSX.writeFile(wb, path.join(dir, 'i_multisheet.xlsx'));

// (j) 5,000 rows, unique phones 555-1000..555-5999 spread across area codes
const ac = ['214', '713', '305', '602', '303', '415', '212', '312', '404', '617'];
const st = ['TX', 'TX', 'FL', 'AZ', 'CO', 'CA', 'NY', 'IL', 'GA', 'MA'];
const big = [H];
for (let i = 0; i < 5000; i++) {
  const k = i % 10;
  big.push(`Bulk Agent ${i},(${ac[k]}) 555-${String(1000 + Math.floor(i / 10) * 1 + 0).padStart(4, '0').slice(-4)}${''},,Office ${i % 37},,City ${k},${st[k]}`);
}
// make phones unique per (area code, line): line = 1000 + floor(i/10)
w('j_5000.csv', big.join('\n') + '\n');

// (k) bad files
w('k_empty.csv', '');
w('k_header_only.csv', H + '\n');
w('k_wrong_ext.txt', fs.readFileSync(path.join(dir, 'a_clean.csv')));
w('k_fake.pdf', '%PDF-1.4\nnot really a pdf\n');
w('k_malformed.csv', H + '\n"Unclosed Quote,(214) 555-1101,,X,,Dallas,TX\nNext Row,(214) 555-1102,,X,,Dallas,TX\n');
// oversized: > 15 MB (multer limit) — generated at test time into scratch, not committed
console.log('fixtures written to', dir);
for (const f of fs.readdirSync(dir)) console.log(`  ${f}  ${fs.statSync(path.join(dir, f)).size} bytes`);
