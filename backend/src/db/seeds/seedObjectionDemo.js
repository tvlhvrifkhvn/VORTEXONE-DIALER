const db = require('../index');
const { buildOfficeKey } = require('../../utils/officeKey');

/**
 * Dev-only demo data for the objection tracker: dispositioned calls with
 * known outcomes, so the report's numbers are hand-checkable and "Too
 * expensive" clears the rebuttal-suggestion threshold (>= 10 instances,
 * >= 2 positive).
 *
 * Creates its own leads rather than borrowing real ones, so it can't skew a
 * real office's colleague card. They have no phone and missing_phone = true,
 * so they can never be dialed. Re-runnable: removes its previous rows first.
 *
 * Usage: npm run seed:objection-demo
 */

const DEMO_PREFIX = '[demo] ';
const DEMO_MARKER = 'DEMO-OBJECTION'; // stamped on call_history.from_number

const OFFICES = {
  boise: { brokerage: 'Summit Demo Brokerage', address: 'Boise, ID', state: 'ID', count: 4 },
  austin: { brokerage: 'Lone Peak Demo Brokerage', address: 'Austin, TX', state: 'TX', count: 3 },
};

// [office, disposition, rebuttal said on the call]. Expected report numbers:
//   Too expensive       12 logged, 6 positive of 12 -> 50%  (Boise 8 / 5 -> 63%, Austin 4 / 1 -> 25%)
//   Already have a VA    4 logged, 1 positive of 4  -> 25%  (all Boise)
//   Too busy right now   3 logged, 0 positive of 3  -> 0%   (all Austin)
const CALLS = {
  'Too expensive': [
    ['boise', 'contacted', 'Totally fair — a lot of agents start with just a few hours a week on follow-up and build from there.'],
    ['boise', 'contacted', 'Makes sense. Would it help to price only the tasks that are eating your evenings?'],
    ['boise', 'contacted', 'I hear you. What if we started with appointment setting only, so you only pay for what frees up your calendar?'],
    ['boise', 'contacted', 'Fair point — can I send a one-page breakdown so you can compare it against your own time?'],
    ['boise', 'callback_scheduled', 'No problem — when is a better time to walk through a smaller starter option?'],
    ['boise', 'no_answer', "It's really cheap compared to hiring locally."],
    ['boise', 'voicemail', 'Everyone says that at first, but you will make it back fast.'],
    ['boise', 'no_answer', null],
    ['austin', 'contacted', 'Understood. Could we do a ten-minute call next week to see if a part-time setup fits your budget?'],
    ['austin', 'voicemail', "We're the most affordable option out there."],
    ['austin', 'no_answer', "You can't afford not to have a VA."],
    ['austin', 'voicemail', null],
  ],
  'Already have a VA': [
    ['boise', 'contacted', "Great — what's the one thing they never have time for? We often pick up the overflow."],
    ['boise', 'no_answer', 'Oh, well we are better than most VAs.'],
    ['boise', 'voicemail', null],
    ['boise', 'no_answer', 'Could you replace them with us?'],
  ],
  'Too busy right now': [
    ['austin', 'voicemail', 'This will only take a second.'],
    ['austin', 'voicemail', null],
    ['austin', 'no_answer', 'Just hear me out for two minutes.'],
  ],
};

async function clearPrevious() {
  const { rows } = await db.query('SELECT id FROM leads WHERE name LIKE $1', [`${DEMO_PREFIX}%`]);
  const ids = rows.map((r) => r.id);
  await db.query(
    `DELETE FROM call_objections
     WHERE call_id IN (SELECT id FROM call_history WHERE from_number = $1)
        OR lead_id = ANY($2)`,
    [DEMO_MARKER, ids]
  );
  await db.query('DELETE FROM call_history WHERE from_number = $1 OR lead_id = ANY($2)', [DEMO_MARKER, ids]);
  await db.query('DELETE FROM leads WHERE id = ANY($1)', [ids]);
  return ids.length;
}

async function createLeads() {
  const leadsByOffice = {};
  for (const [key, office] of Object.entries(OFFICES)) {
    leadsByOffice[key] = [];
    for (let i = 1; i <= office.count; i++) {
      const { rows } = await db.query(
        `INSERT INTO leads (name, phone, brokerage, address, state, status, missing_phone, office_key)
         VALUES ($1, NULL, $2, $3, $4, 'contacted', true, $5)
         RETURNING id`,
        [
          `${DEMO_PREFIX}${office.brokerage.split(' ')[0]} Agent ${i}`,
          office.brokerage,
          office.address,
          office.state,
          buildOfficeKey(office),
        ]
      );
      leadsByOffice[key].push(rows[0].id);
    }
  }
  return leadsByOffice;
}

async function seed() {
  const removed = await clearPrevious();
  const leadsByOffice = await createLeads();

  const { rows: types } = await db.query('SELECT id, label FROM objection_types');
  const typeId = Object.fromEntries(types.map((t) => [t.label, t.id]));

  const cursor = { boise: 0, austin: 0 };
  let logged = 0;

  for (const [label, calls] of Object.entries(CALLS)) {
    if (!typeId[label]) throw new Error(`Objection type "${label}" not found — run npm run migrate first`);

    for (const [office, disposition, rebuttal] of calls) {
      const leads = leadsByOffice[office];
      const leadId = leads[cursor[office] % leads.length];
      cursor[office] += 1;

      const { rows } = await db.query(
        `INSERT INTO call_history (lead_id, started_at, ended_at, duration_seconds, disposition,
                                   disposition_at, from_number, telephony_state, was_mock)
         VALUES ($1, now() - interval '1 hour', now() - interval '55 minutes', 300, $2,
                 now() - interval '55 minutes', $3, 'ended', true)
         RETURNING id`,
        [leadId, disposition, DEMO_MARKER]
      );
      await db.query(
        `INSERT INTO call_objections (call_id, lead_id, objection_type_id, rebuttal_used)
         VALUES ($1, $2, $3, $4)`,
        [rows[0].id, leadId, typeId[label], rebuttal]
      );
      logged += 1;
    }
  }

  console.log(`Removed ${removed} previous demo leads.`);
  console.log(`Created ${Object.values(leadsByOffice).flat().length} demo leads and logged ${logged} objections.`);
  console.log('Expected report (demo data only):');
  console.log('  Too expensive       12 logged, 50% positive  (Boise office 8 / 63%, Austin office 4 / 25%)');
  console.log('  Already have a VA    4 logged, 25% positive');
  console.log('  Too busy right now   3 logged, 0% positive');
  console.log('"Too expensive" now clears the suggestion threshold — Reports → Objections → Regenerate.');
}

seed()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error(err);
    db.pool.end();
    process.exit(1);
  });
