// Controlled-clock test of services/callingHours.js. Calls the real exported
// isWithinCallingHours(state, date) with explicit Date instants (the function
// takes the date as a parameter), after turning the DB toggle ON and letting the
// 5s cache refresh. Also shows the zone each state maps to vs the real local
// zone of cities inside multi-zone states.
// Usage (from repo root): node audit/scripts/calling-hours.js
const path = require('path');
const backend = path.resolve(__dirname, '../../backend');
process.chdir(backend);
const ch = require(path.join(backend, 'src/services/callingHours'));
const settings = require(path.join(backend, 'src/services/settings'));
const db = require(path.join(backend, 'src/db'));

// UTC instant for a wall-clock time in a zone (minute search; fine for tests)
function utcFor(zone, ymdhm) {
  const [d, t] = ymdhm.split('T');
  const target = `${d} ${t}`;
  const start = Date.parse(`${d}T00:00:00Z`) - 14 * 3600e3;
  for (let ms = start; ms < start + 64 * 3600e3; ms += 60e3) {
    const s = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    if (s === target) return new Date(ms);
  }
  throw new Error(`no instant for ${zone} ${ymdhm}`); // never pass null into the app
}
const fmt = (date, zone) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);

(async () => {
  const before = await settings.getSetting(ch.ENFORCEMENT_SETTING_KEY);
  await settings.setSetting(ch.ENFORCEMENT_SETTING_KEY, 'true');
  ch.isCallingHoursEnforced(); await new Promise((r) => setTimeout(r, 5600)); ch.isCallingHoursEnforced(); await new Promise((r) => setTimeout(r, 300));
  console.log(`toggle ON (was ${before}); enforced=${ch.isCallingHoursEnforced()}`);

  console.log('\n== boundaries in each state\'s mapped zone (2026-11-11, standard time)');
  for (const st of ['FL', 'AZ', 'HI', 'CA', 'TX', 'NY', 'AK']) {
    const zone = ch.timezoneForState(st);
    const cells = ['07:59', '08:00', '20:59', '21:00'].map((t) => {
      const u = utcFor(zone, `2026-11-11T${t}`);
      return `${t}=${ch.isWithinCallingHours(st, u) ? 'ALLOW' : 'block'}`;
    });
    console.log(`${st.padEnd(3)} ${zone.padEnd(20)} ${cells.join('  ')}`);
  }

  console.log('\n== DST: same UTC instant before/after the change (expected: local hour shifts, AZ does not)');
  for (const [label, iso] of [['2026-03-07 13:00Z (before spring-forward)', '2026-03-07T13:00:00Z'], ['2026-03-08 13:00Z (after spring-forward)', '2026-03-08T13:00:00Z'], ['2026-10-31 12:30Z (before fall-back)', '2026-10-31T12:30:00Z'], ['2026-11-01 12:30Z (after fall-back)', '2026-11-01T12:30:00Z']]) {
    const u = new Date(iso);
    console.log(label.padEnd(44), ['NY', 'AZ', 'CA'].map((s) => `${s} ${fmt(u, ch.timezoneForState(s))} ${ch.isWithinCallingHours(s, u) ? 'ALLOW' : 'block'}`).join(' | '));
  }
  console.log('\nlocalHour at the 2026-03-08 02:00 gap and 2026-11-01 01:00 overlap in NY:');
  for (const iso of ['2026-03-08T06:59:00Z', '2026-03-08T07:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) console.log(`  ${iso} -> NY local ${fmt(new Date(iso), 'America/New_York')} localHour=${ch.localHour('NY', new Date(iso))}`);

  console.log('\n== multi-zone states: mapped zone vs the real zone of a city in that state, at 8:00 mapped-zone time');
  for (const [st, city, realZone] of [['TX', 'El Paso', 'America/Denver'], ['FL', 'Pensacola', 'America/Chicago'], ['ID', 'Coeur d\'Alene', 'America/Los_Angeles'], ['OR', 'Ontario', 'America/Boise'], ['KY', 'Bowling Green', 'America/Chicago'], ['TN', 'Knoxville', 'America/New_York'], ['IN', 'Gary', 'America/Chicago']]) {
    const mapped = ch.timezoneForState(st);
    const u = utcFor(mapped, '2026-11-11T08:00');
    const u2 = utcFor(mapped, '2026-11-11T20:59');
    console.log(`${st} ${city.padEnd(14)} mapped ${mapped.padEnd(20)} allowed from ${fmt(u, mapped)} = ${fmt(u, realZone)} in ${city}; last allowed ${fmt(u2, mapped)} = ${fmt(u2, realZone)} in ${city}`);
  }
  console.log('\n== unknown / invalid state code falls back to:', ch.timezoneForState('ZZ'), ' | PR:', ch.timezoneForState('PR'), ' | GU:', ch.timezoneForState('GU'));

  await settings.setSetting(ch.ENFORCEMENT_SETTING_KEY, before ?? 'false');
  console.log(`toggle restored to ${before ?? 'false'}`);
  await db.pool.end();
})();
