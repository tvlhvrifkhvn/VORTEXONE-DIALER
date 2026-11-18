// Calling hours: 8:00 inclusive to 21:00 exclusive in the lead's local time,
// for two time zones, with enforcement on and off. The boundary minutes are
// checked through the service with an explicit date (faking the process
// clock a day ahead would expire the test tokens); the on/off switch goes
// through the real settings API and the by-id dial.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const callingHours = require('../src/services/callingHours');

let supervisor;
let texas; // America/Chicago (area code 214)
let california; // America/Los_Angeles (area code 415)

before(async () => {
  await h.setupFile();
  supervisor = await h.createUser({ role: 'supervisor' });
  texas = await h.createLead({ state: 'TX', areaCode: '214' });
  california = await h.createLead({ state: 'CA', areaCode: '415' });
  await h.setCallingHours(true);
});

async function allowed(lead, iso) {
  try {
    await callingHours.assertCallingHours(lead, new Date(iso));
    return true;
  } catch (err) {
    if (err.status === 422) return false;
    throw err;
  }
}

// 16 Nov 2026 (standard time): Chicago is UTC-6, Los Angeles UTC-8.
const CASES = [
  ['Texas 07:59', 'texas', '2026-11-16T13:59:00Z', false],
  ['Texas 08:00', 'texas', '2026-11-16T14:00:00Z', true],
  ['Texas 20:59', 'texas', '2026-11-17T02:59:00Z', true],
  ['Texas 21:00', 'texas', '2026-11-17T03:00:00Z', false],
  ['California 07:59', 'california', '2026-11-16T15:59:00Z', false],
  ['California 08:00', 'california', '2026-11-16T16:00:00Z', true],
  ['California 20:59', 'california', '2026-11-17T04:59:00Z', true],
  ['California 21:00', 'california', '2026-11-17T05:00:00Z', false],
];

test('enforcement on: the boundary minutes around 8:00 and 21:00, two zones', async () => {
  assert.deepEqual(texas.tz_zones, ['America/Chicago']);
  assert.deepEqual(california.tz_zones, ['America/Los_Angeles']);
  for (const [label, who, iso, expected] of CASES) {
    const lead = who === 'texas' ? texas : california;
    assert.equal(await allowed(lead, iso), expected, label);
  }
});

test('enforcement off (through the settings API): every one of those minutes is allowed', async () => {
  const res = await supervisor.api.put('/api/settings/calling_hours_enforced', { value: 'false' });
  assert.equal(res.status, 200);
  for (const [label, who, iso] of CASES) {
    const lead = who === 'texas' ? texas : california;
    assert.equal(await allowed(lead, iso), true, label);
  }
});

test('a by-id dial follows the switch: refused when the lead is outside its hours, allowed when off', async () => {
  // Pick whichever lead is outside its calling hours right now, if any.
  await h.setCallingHours(true);
  const now = new Date();
  const closed = [texas, california].find((l) => !callingHours.zonesOpen(l.tz_zones, now));
  if (closed) {
    const refused = await h.dial(supervisor.api, closed.id);
    assert.equal(refused.status, 422);
  }
  await supervisor.api.put('/api/settings/calling_hours_enforced', { value: 'false' });
  const lead = closed || texas;
  const ok = await h.dial(supervisor.api, lead.id);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});
