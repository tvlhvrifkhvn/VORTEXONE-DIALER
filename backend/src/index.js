const express = require('express');
const cors = require('cors');
const config = require('./config');
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

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Vortex Dialer API listening on port ${config.port} (telephony: ${config.telephonyProvider})`);
});

module.exports = app;
