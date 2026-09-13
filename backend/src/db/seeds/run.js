const bcrypt = require('bcrypt');
const db = require('../index');

const SEED_EMAIL = process.env.SEED_USER_EMAIL || 'vortexoneagency@gmail.com';
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || 'ChangeMe123!';
const SEED_NAME = process.env.SEED_USER_NAME || 'Talha Arif';

const SAMPLE_LEADS = [
  { name: 'Karen Mitchell', phone: '+14155550101', address: '221 Market St, San Francisco, CA', brokerage: 'Bay Realty Group', state: 'CA' },
  { name: 'David Chen', phone: '+13105550102', address: '900 Wilshire Blvd, Los Angeles, CA', brokerage: 'Sunset Properties', state: 'CA' },
  { name: 'Melissa Ortiz', phone: '+17135550103', address: '5000 Main St, Houston, TX', brokerage: 'Lone Star Realty', state: 'TX' },
  { name: 'James Whitfield', phone: '+15125550104', address: '100 Congress Ave, Austin, TX', brokerage: 'Capitol Homes', state: 'TX' },
  { name: 'Angela Rossi', phone: '+13055550105', address: '1200 Brickell Ave, Miami, FL', brokerage: 'Coastal Living Realty', state: 'FL' },
  { name: 'Brian Kowalski', phone: '+14075550106', address: '400 Orange Ave, Orlando, FL', brokerage: 'Sunshine Estates', state: 'FL' },
  { name: 'Patricia Nguyen', phone: '+12125550107', address: '350 5th Ave, New York, NY', brokerage: 'Empire Realty', state: 'NY' },
  { name: 'Robert Hayes', phone: '+13475550108', address: '1 Brooklyn Bridge Blvd, Brooklyn, NY', brokerage: 'Boroughwide Homes', state: 'NY' },
  { name: 'Susan Delgado', phone: '+16025550109', address: '2 N Central Ave, Phoenix, AZ', brokerage: 'Desert Ridge Realty', state: 'AZ' },
  { name: 'Michael Torres', phone: '+13035550110', address: '1700 Broadway, Denver, CO', brokerage: 'Mile High Properties', state: 'CO' },
];

async function seed() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  await db.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, 'supervisor')
     ON CONFLICT (email) DO NOTHING`,
    [SEED_EMAIL, passwordHash, SEED_NAME]
  );

  for (const lead of SAMPLE_LEADS) {
    await db.query(
      `INSERT INTO leads (name, phone, address, brokerage, state, status)
       VALUES ($1, $2, $3, $4, $5, 'in_queue')
       ON CONFLICT (phone) DO NOTHING`,
      [lead.name, lead.phone, lead.address, lead.brokerage, lead.state]
    );
  }

  console.log(`Seed complete. Login with ${SEED_EMAIL} / ${SEED_PASSWORD}`);
}

seed()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error(err);
    db.pool.end();
    process.exit(1);
  });
