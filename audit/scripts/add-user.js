// Inserts a second rep account for multi-user tests (audit only, throwaway DB).
// Usage (from repo root): node audit/scripts/add-user.js rep2@example.com Rep2Pass! "Rep Two"
const path = require('path');
const backend = path.resolve(__dirname, '../../backend');
require(path.join(backend, 'node_modules/dotenv')).config({ path: path.join(backend, '.env') });
const bcrypt = require(path.join(backend, 'node_modules/bcrypt'));
const { Client } = require(path.join(backend, 'node_modules/pg'));
(async () => {
  const [email, pw, name] = process.argv.slice(2);
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'rep')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id, email, role`,
    [email, await bcrypt.hash(pw, 10), name]
  );
  console.log('user:', JSON.stringify(rows[0]));
  await c.end();
})();
