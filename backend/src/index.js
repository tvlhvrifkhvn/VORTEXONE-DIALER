const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const leadsRoutes = require('./routes/leads');
const callsRoutes = require('./routes/calls');
const dispositionsRoutes = require('./routes/dispositions');
const importsRoutes = require('./routes/imports');
const exportsRoutes = require('./routes/exports');
const reportsRoutes = require('./routes/reports');
const aiRoutes = require('./routes/ai');
const sessionsRoutes = require('./routes/sessions');
const settingsRoutes = require('./routes/settings');
const smsRoutes = require('./routes/sms');
const emailRoutes = require('./routes/email');

const app = express();

// Codespaces forwards each session to a fresh *.app.github.dev subdomain, so
// CORS_ORIGIN would otherwise need hand-updating every time it changes.
// Outside production, accept that pattern in addition to the exact
// configured origin; production keeps strict exact-match only.
const CODESPACES_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.app\.github\.dev$/i;

function corsOriginCheck(origin, callback) {
  // No Origin header (curl, server-to-server, same-origin) — allow through.
  if (!origin) return callback(null, true);
  if (origin === config.corsOrigin) return callback(null, true);
  if (config.nodeEnv !== 'production' && CODESPACES_ORIGIN_PATTERN.test(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Not allowed by CORS: ${origin}`));
}

app.use(cors({ origin: corsOriginCheck }));
app.use(express.json({ limit: '5mb' }));

// MMS-style media attachments on SMS (see routes/sms.js's upload-media
// endpoint) — served back out statically from the same directory they're
// saved to.
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 100 req/min per user (per IP if unauthenticated) on everything under /api.
// The login route's own stricter 5/min-per-IP limit is applied in auth.js.
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/dispositions', dispositionsRoutes);
app.use('/api/imports', importsRoutes);
app.use('/api/exports', exportsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/email', emailRoutes);

app.use(notFound);
app.use(errorHandler);

// Every table a migration has ever created. Catches exactly the failure mode
// that prompted this: a migration file existed in the repo but was never run
// against this database, so the app started fine and then failed
// confusingly the first time a route touched the missing table.
const EXPECTED_TABLES = [
  'users',
  'leads',
  'call_history',
  'dnc_list',
  'callbacks',
  'phone_numbers',
  'dialing_sessions',
  'import_jobs',
  'settings',
  'sms_templates',
  'sms_messages',
  'lead_notes',
  'email_messages',
];

async function assertSchemaIsMigrated() {
  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [EXPECTED_TABLES]
  );
  const present = new Set(rows.map((r) => r.tablename));
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));

  if (missing.length > 0) {
    for (const table of missing) {
      console.error(`Missing table: ${table} — run npm run migrate before starting the server`);
    }
    process.exit(1);
  }
}

assertSchemaIsMigrated()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Vortex Dialer API listening on port ${config.port} (telephony: ${config.telephonyProvider})`);
    });
  })
  .catch((err) => {
    console.error('Could not verify the database schema on startup:', err.message);
    process.exit(1);
  });

module.exports = app;
