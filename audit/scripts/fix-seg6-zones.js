// Segment 6 (F-18): controlled-clock test of the calling-hours rule itself.
// Every instant is passed in explicitly (the check takes the date as a
// parameter), so nothing depends on the real clock. Works on the base (the
// check takes a state only) and on the fix (the check takes the lead: phone,
// state, address). The enforcement toggle is set ON in the test DB first.
//   1. boundary table per zone at 07:59 / 08:00 / 20:59 / 21:00 local, in
//      summer (DST) and winter (standard time)
//   2. split places, by area code and by city: is any instant outside the
//      place's real 8am–9pm allowed? (VIOLATION) Refusals inside the real
//      hours are the conservative rule at work (counted, not violations).
//   3. unknown / invalid / missing state
// Usage: DB=<db> node fix-seg6-zones.js <checkout>
const path = require('path');
const backend = path.resolve(process.argv[2], 'backend');
process.env.DATABASE_URL = `postgres://vortex:vortex@localhost:5432/${process.env.DB}`;
process.chdir(backend);
const ch = require(path.join(backend, 'src/services/callingHours'));
const settings = require(path.join(backend, 'src/services/settings'));
const db = require(path.join(backend, 'src/db'));
const NEW = typeof ch.zonesForLead === 'function';

// UTC instant for a wall-clock time in a zone (minute search)
function utcFor(zone, ymdhm) {
  const [d, t] = ymdhm.split('T');
  const target = `${d} ${t}`;
  const start = Date.parse(`${d}T00:00:00Z`) - 16 * 3600e3;
  for (let ms = start; ms < start + 72 * 3600e3; ms += 60e3) {
    const s = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    if (s === target) return new Date(ms);
  }
  throw new Error(`no instant for ${zone} ${ymdhm}`);
}
const allowed = async (lead, at) => {
  if (!NEW) return ch.isWithinCallingHours(lead.state, at);
  try { await ch.assertCallingHours(lead, at); return true; } catch (e) { if (e.status === 422) return false; throw e; }
};

const ZONE_ROWS = [
  ['ET', 'America/New_York', { phone: '+12125550100', state: 'NY', address: 'New York, NY' }],
  ['CT', 'America/Chicago', { phone: '+13125550100', state: 'IL', address: 'Chicago, IL' }],
  ['MT', 'America/Denver', { phone: '+13035550100', state: 'CO', address: 'Denver, CO' }],
  ['PT', 'America/Los_Angeles', { phone: '+12135550100', state: 'CA', address: 'Los Angeles, CA' }],
  ['AK', 'America/Anchorage', { phone: '+19075550100', state: 'AK', address: 'Anchorage, AK' }],
  ['HI', 'Pacific/Honolulu', { phone: '+18085550100', state: 'HI', address: 'Honolulu, HI' }],
  ['AZ (no DST)', 'America/Phoenix', { phone: '+16025550100', state: 'AZ', address: 'Phoenix, AZ' }],
  ['PR', 'America/Puerto_Rico', { phone: '+17875550100', state: 'PR', address: 'San Juan, PR' }],
  ['VI', 'America/St_Thomas', { phone: '+13405550100', state: 'VI', address: 'Charlotte Amalie, VI' }],
  ['GU', 'Pacific/Guam', { phone: '+16715550100', state: 'GU', address: 'Hagatna, GU' }],
  ['MP', 'Pacific/Saipan', { phone: '+16705550100', state: 'MP', address: 'Saipan, MP' }],
  ['AS', 'Pacific/Pago_Pago', { phone: '+16845550100', state: 'AS', address: 'Pago Pago, AS' }],
];
const EXPECT = { '07:59': false, '08:00': true, '20:59': true, '21:00': false };

// [label, real zone, lead]
const SPLIT = [
  ['El Paso TX (915)', 'America/Denver', { phone: '+19155550101', state: 'TX', address: '100 N Oregon St, El Paso, TX' }],
  ['El Paso TX by city (Canadian cell)', 'America/Denver', { phone: '+14165550101', state: 'TX', address: '100 N Oregon St, El Paso, TX' }],
  ['Van Horn TX (432 + city)', 'America/Denver', { phone: '+14325550101', state: 'TX', address: '200 Broadway, Van Horn, TX' }],
  ['Midland TX (432 + city)', 'America/Chicago', { phone: '+14325550102', state: 'TX', address: '300 Wall St, Midland, TX' }],
  ['Dallas TX (214)', 'America/Chicago', { phone: '+12145550101', state: 'TX', address: 'Dallas, TX' }],
  ['Pensacola FL (850 + city)', 'America/Chicago', { phone: '+18505550101', state: 'FL', address: '1 Palafox Pl, Pensacola, FL' }],
  ['Pensacola FL (850, no city)', 'America/Chicago', { phone: '+18505550102', state: 'FL', address: '' }],
  ['Tallahassee FL (850 + city)', 'America/New_York', { phone: '+18505550103', state: 'FL', address: 'Tallahassee, FL' }],
  ['Bowling Green KY (270 + city)', 'America/Chicago', { phone: '+12705550101', state: 'KY', address: 'Bowling Green, KY' }],
  ['Bowling Green KY by city (Canadian cell)', 'America/Chicago', { phone: '+14165550102', state: 'KY', address: 'Bowling Green, KY' }],
  ['Gary IN (219)', 'America/Chicago', { phone: '+12195550101', state: 'IN', address: 'Gary, IN' }],
  ['Evansville IN (812 + city)', 'America/Chicago', { phone: '+18125550101', state: 'IN', address: 'Evansville, IN' }],
  ['Ontario OR (541 + city)', 'America/Boise', { phone: '+15415550101', state: 'OR', address: 'Ontario, OR' }],
  ['Knoxville TN (865)', 'America/New_York', { phone: '+18655550101', state: 'TN', address: 'Knoxville, TN' }],
  ['Chattanooga TN (423)', 'America/New_York', { phone: '+14235550101', state: 'TN', address: 'Chattanooga, TN' }],
  ["Coeur d'Alene ID (208 + city)", 'America/Los_Angeles', { phone: '+12085550101', state: 'ID', address: "Coeur d'Alene, ID" }],
  ['Rapid City SD (605 + city)', 'America/Denver', { phone: '+16055550101', state: 'SD', address: 'Rapid City, SD' }],
  ['Iron Mountain MI (906 + city)', 'America/Menominee', { phone: '+19065550101', state: 'MI', address: 'Iron Mountain, MI' }],
  ['Adak AK (907 + city)', 'America/Adak', { phone: '+19075550102', state: 'AK', address: 'Adak, AK' }],
  ['Window Rock AZ, Navajo Nation (928 + city)', 'America/Denver', { phone: '+19285550101', state: 'AZ', address: 'Window Rock, AZ' }],
  ['Oklahoma City OK (405)', 'America/Chicago', { phone: '+14055550101', state: 'OK', address: 'Oklahoma City, OK' }],
  ['Denver CO (303)', 'America/Denver', { phone: '+13035550101', state: 'CO', address: 'Denver, CO' }],
  ['TX lead with a Denver cell (303) — moved number', 'America/Chicago', { phone: '+13035550102', state: 'TX', address: 'Dallas, TX' }],
];

(async () => {
  const before = await settings.getSetting(ch.ENFORCEMENT_SETTING_KEY);
  await settings.setSetting(ch.ENFORCEMENT_SETTING_KEY, 'true');
  if (!NEW) { ch.isCallingHoursEnforced(); await new Promise((r) => setTimeout(r, 5600)); ch.isCallingHoursEnforced(); await new Promise((r) => setTimeout(r, 300)); }
  console.log(`code: ${NEW ? 'fix (zonesForLead)' : 'base (state only)'}; enforcement ON`);

  console.log('\n== 1. boundary table (local time in the zone; expected block / ALLOW / ALLOW / block)');
  let bad = 0;
  for (const [season, day] of [['summer (DST)', '2026-07-15'], ['winter', '2026-11-18']]) {
    for (const [label, zone, lead] of ZONE_ROWS) {
      const cells = [];
      for (const t of Object.keys(EXPECT)) {
        const ok = await allowed(lead, utcFor(zone, `${day}T${t}`));
        const wrong = ok !== EXPECT[t];
        if (wrong) bad++;
        cells.push(`${t}=${ok ? 'ALLOW' : 'block'}${wrong ? '(WRONG)' : ''}`);
      }
      console.log(`  ${season.padEnd(13)} ${label.padEnd(12)} ${zone.padEnd(20)} ${cells.join('  ')}`);
    }
  }
  console.log(`  wrong cells: ${bad}`);

  console.log('\n== 2. split places: every 15 min over two days (summer + winter), against the real zone');
  let violations = 0;
  for (const [label, realZone, lead] of SPLIT) {
    let v = 0; let conservative = 0; let firstV = null;
    for (const day of ['2026-07-15', '2026-11-18']) {
      const start = utcFor(realZone, `${day}T00:00`).getTime();
      for (let ms = start; ms < start + 24 * 3600e3; ms += 15 * 60e3) {
        const at = new Date(ms);
        const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: realZone, hour: 'numeric', hourCycle: 'h23' }).format(at)) % 24;
        const inHours = h >= 8 && h < 21;
        const ok = await allowed(lead, at);
        if (ok && !inHours) { v++; firstV ||= new Intl.DateTimeFormat('en-US', { timeZone: realZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at); }
        if (!ok && inHours) conservative++;
      }
    }
    violations += v;
    const zones = NEW ? ch.zonesForLead(lead).join(',') : ch.timezoneForState(lead.state);
    console.log(`  ${label.padEnd(46)} real ${realZone.padEnd(20)} -> ${zones.padEnd(38)} ${v ? `VIOLATION ×${v} (e.g. ${firstV})` : 'ok'}${conservative ? `; conservative refusals inside hours ×${conservative}` : ''}`);
  }
  console.log(`  slots allowed outside the real 8am–9pm: ${violations}`);

  console.log('\n== 3. unknown / invalid / missing state (at 12:00 New York time, inside hours everywhere in the lower 48)');
  const noon = utcFor('America/New_York', '2026-11-18T12:00');
  for (const st of ['', '  ', 'ZZ', 'XX', null]) {
    const lead = { phone: '+12125550199', state: st, address: '' };
    let msg = '';
    if (NEW) { try { await ch.assertCallingHours(lead, noon); msg = 'ALLOW'; } catch (e) { msg = `refused ${e.status}: "${e.message}"`; } } else msg = `${(await allowed(lead, noon)) ? 'ALLOW' : 'block'} (zone used: ${ch.timezoneForState(st)})`;
    console.log(`  state ${JSON.stringify(st).padEnd(6)} -> ${msg}`);
  }

  await settings.setSetting(ch.ENFORCEMENT_SETTING_KEY, before ?? 'true');
  await db.pool.end();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
