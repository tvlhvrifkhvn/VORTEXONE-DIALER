#!/usr/bin/env node
// Finds leads whose stored phone is not in the canonical form the app uses
// everywhere (E.164, +1XXXXXXXXXX) and shows what each would become.
//
//   node scripts/normalize-existing-phones.js            # dry run (default): report only, changes nothing
//   node scripts/normalize-existing-phones.js --apply    # backup first, then fix the safe ones, logging each change
//
// Never merges or deletes anything. A lead is NOT changed when:
//   - its number can't be read (reported as "unreadable"; edit it by hand), or
//   - its new form collides with another lead's number, or with another lead
//     that would become the same number (reported as a "collision"; review by hand).
// --apply runs scripts/backup-db.sh first and stops if the backup fails.
// The old value is kept in original_phone (if empty) and an extension found in
// it goes to extension (if empty). Every change is written to
// backups/normalize-phones-<timestamp>.log.
//
// DATABASE_URL comes from the environment or backend/.env and is never printed.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
require(path.join(BACKEND, 'node_modules/dotenv')).config({ path: path.join(BACKEND, '.env') });
const { Client } = require(path.join(BACKEND, 'node_modules/pg'));
const { parsePhone } = require(path.join(BACKEND, 'src/utils/phoneNormalize'));

const APPLY = process.argv.includes('--apply');
const CANONICAL = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (and backend/.env has none).');
    process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const { rows: odd } = await db.query(
    `SELECT id, name, phone, original_phone, extension, status, deleted_at IS NOT NULL AS deleted
     FROM leads WHERE phone IS NOT NULL AND phone !~ $1 ORDER BY id`,
    [CANONICAL.source]
  );
  const { rows: oddDnc } = await db.query('SELECT id, phone FROM dnc_list WHERE phone !~ $1 ORDER BY id', [CANONICAL.source]);

  const plans = odd.map((l) => ({ lead: l, parsed: parsePhone(l.phone) }));
  const targets = plans.filter((p) => p.parsed.e164).map((p) => p.parsed.e164);
  const { rows: taken } = await db.query('SELECT id, phone FROM leads WHERE phone = ANY($1)', [targets]);
  const takenBy = new Map(taken.map((r) => [r.phone, r.id]));
  const wanted = new Map();
  for (const p of plans) {
    if (!p.parsed.e164) continue;
    if (!wanted.has(p.parsed.e164)) wanted.set(p.parsed.e164, []);
    wanted.get(p.parsed.e164).push(p.lead.id);
  }

  const safe = [];
  const unreadable = [];
  const collisions = [];
  for (const p of plans) {
    const { lead, parsed } = p;
    if (!parsed.e164) unreadable.push(p);
    else if (takenBy.has(parsed.e164) && takenBy.get(parsed.e164) !== lead.id) {
      collisions.push({ ...p, with: `lead ${takenBy.get(parsed.e164)} already has ${parsed.e164}` });
    } else if (wanted.get(parsed.e164).length > 1) {
      collisions.push({ ...p, with: `leads ${wanted.get(parsed.e164).join(', ')} would all become ${parsed.e164}` });
    } else safe.push(p);
  }

  const show = (p) =>
    `  lead ${p.lead.id} ${JSON.stringify(p.lead.name)} (${p.lead.status}${p.lead.deleted ? ', deleted' : ''}): ${JSON.stringify(p.lead.phone)}` +
    (p.parsed.e164 ? ` -> ${p.parsed.e164}${p.parsed.extension ? ` ext. ${p.parsed.extension}` : ''}` : '');
  console.log(`Leads with a phone not in the canonical +1XXXXXXXXXX form: ${odd.length}`);
  console.log(`\nCan be fixed safely (${safe.length}):`);
  safe.forEach((p) => console.log(show(p)));
  console.log(`\nCollisions — NOT changed, review by hand (${collisions.length}):`);
  collisions.forEach((p) => console.log(`${show(p)}   <- ${p.with}`));
  console.log(`\nUnreadable — NOT changed, edit by hand (${unreadable.length}):`);
  unreadable.forEach((p) => console.log(show(p)));
  if (oddDnc.length) {
    console.log(`\nDNC list entries not in canonical form (report only, not changed by this script) (${oddDnc.length}):`);
    oddDnc.forEach((d) => console.log(`  dnc_list ${d.id}: ${JSON.stringify(d.phone)} -> ${parsePhone(d.phone).e164 || 'unreadable'}`));
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was changed. Run with --apply to fix the safe ones (a backup is taken first).');
    await db.end();
    return;
  }
  if (safe.length === 0) {
    console.log('\nNothing safe to change.');
    await db.end();
    return;
  }

  console.log('\nTaking a backup first (scripts/backup-db.sh)…');
  try {
    execFileSync(path.join(ROOT, 'scripts/backup-db.sh'), { stdio: 'inherit', env: process.env });
  } catch {
    console.error('Backup failed — nothing was changed.');
    process.exit(1);
  }

  const logDir = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `normalize-phones-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const log = fs.createWriteStream(logFile);
  let changed = 0;
  await db.query('BEGIN');
  try {
    for (const { lead, parsed } of safe) {
      const { rowCount } = await db.query(
        `UPDATE leads
         SET phone = $2, original_phone = COALESCE(original_phone, $3), extension = COALESCE(extension, $4), updated_at = now()
         WHERE id = $1 AND phone = $3`,
        [lead.id, parsed.e164, lead.phone, parsed.extension]
      );
      if (rowCount === 1) {
        changed += 1;
        log.write(`${new Date().toISOString()} lead ${lead.id}: ${JSON.stringify(lead.phone)} -> ${parsed.e164}${parsed.extension ? ` ext ${parsed.extension}` : ''}\n`);
      }
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error(`Stopped, nothing changed (rolled back): ${err.message}`);
    process.exit(1);
  }
  log.end();
  console.log(`\nChanged ${changed} leads. Every change is logged in ${logFile}`);
  await db.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
