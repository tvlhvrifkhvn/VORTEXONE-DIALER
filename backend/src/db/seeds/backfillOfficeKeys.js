const db = require('../index');
const { buildOfficeKey } = require('../../utils/officeKey');

/**
 * One-time backfill of leads.office_key for rows that predate migration 020.
 * New leads get their key at insert time (csvImport.commitImport and
 * leadQueue.create), so this only has to run once — but it is idempotent and
 * safe to re-run, and will also re-key rows whose brokerage/address changed
 * before updateFields started maintaining the key.
 *
 * Usage: npm run backfill:office-keys
 */
async function backfill() {
  const { rows: leads } = await db.query(
    'SELECT id, brokerage, address, state, office_key FROM leads WHERE deleted_at IS NULL'
  );

  let updated = 0;
  let nulled = 0;
  let unchanged = 0;

  for (const lead of leads) {
    const key = buildOfficeKey({
      brokerage: lead.brokerage,
      address: lead.address,
      state: lead.state,
    });

    if (key === lead.office_key) {
      unchanged += 1;
      continue;
    }

    await db.query('UPDATE leads SET office_key = $2 WHERE id = $1', [lead.id, key]);
    if (key === null) nulled += 1;
    else updated += 1;
  }

  const { rows: keyed } = await db.query(
    `SELECT count(*)::int AS with_key,
            count(DISTINCT office_key)::int AS distinct_offices
     FROM leads
     WHERE office_key IS NOT NULL AND deleted_at IS NULL`
  );
  const { rows: without } = await db.query(
    'SELECT count(*)::int AS n FROM leads WHERE office_key IS NULL AND deleted_at IS NULL'
  );

  console.log(`Scanned ${leads.length} leads.`);
  console.log(`  newly keyed / re-keyed: ${updated}`);
  console.log(`  cleared (no brokerage): ${nulled}`);
  console.log(`  already correct:        ${unchanged}`);
  console.log('');
  console.log(`Leads with an office_key: ${keyed[0].with_key}`);
  console.log(`Leads without one:        ${without[0].n} (no brokerage on file)`);
  console.log(`Distinct offices:         ${keyed[0].distinct_offices}`);
}

backfill()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error(err);
    db.pool.end();
    process.exit(1);
  });
