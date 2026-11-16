// C1E: migration 034 copies the first supervisor's pitch_script and
// daily_goal user settings into File 01, only where File 01 has none.
// The migration already ran on the empty test database; here its SQL runs
// again on prepared data (it is a plain, repeatable UPDATE).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');

const SQL = fs.readFileSync(path.join(__dirname, '../src/db/migrations/034_campaign_settings_copy.sql'), 'utf8');
let sup;

before(async () => {
  await h.setupFile();
  sup = await h.createUser({ role: 'supervisor' });
  const rep = await h.createUser({ role: 'rep' });
  const put = (userId, key, value) =>
    h.db.query('INSERT INTO user_settings (user_id, key, value) VALUES ($1, $2, $3)', [userId, key, value]);
  await put(sup.user.id, 'pitch_script', 'Hi, I am {name} from the supervisor script.');
  await put(sup.user.id, 'daily_goal', '140');
  await put(rep.user.id, 'pitch_script', 'A rep script that must not win.');
});

const file1 = async () => (await h.db.query('SELECT pitch_script, daily_goal FROM campaigns WHERE file_number = 1')).rows[0];

test('empty File 01 values are filled from the first supervisor', async () => {
  await h.db.query('UPDATE campaigns SET pitch_script = NULL, daily_goal = NULL WHERE file_number = 1');
  await h.db.query(SQL);
  const f = await file1();
  assert.equal(f.pitch_script, 'Hi, I am {name} from the supervisor script.');
  assert.equal(f.daily_goal, 140);
});

test('values File 01 already has are kept; a bad goal is ignored', async () => {
  await h.db.query("UPDATE campaigns SET pitch_script = 'Kept', daily_goal = NULL WHERE file_number = 1");
  await h.db.query("UPDATE user_settings SET value = 'lots' WHERE user_id = $1 AND key = 'daily_goal'", [sup.user.id]);
  await h.db.query(SQL);
  const f = await file1();
  assert.equal(f.pitch_script, 'Kept');
  assert.equal(f.daily_goal, null);
});
