// C6C: records each successful change (POST, PUT, PATCH, DELETE answered
// 2xx) by a logged-in user in activity_log: the method, the route PATTERN
// (e.g. /api/leads/:id/notes, never the real path's values), the :id when
// it's a number, and the status. Never the request body, query, headers,
// passwords or keys. Mounted once on /api in index.js; it waits for the
// response to finish, so it never slows or changes a request.
const activityLog = require('../services/activityLog');

const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function activity(req, res, next) {
  if (!METHODS.has(req.method)) return next();
  res.on('finish', () => {
    // req.user is set by requireAuth inside the router; login and webhooks have none.
    if (!req.user || res.statusCode < 200 || res.statusCode >= 300 || !req.route) return;
    // baseUrl is the real mount path (/api/campaigns/1/fields): back to a pattern.
    const base = String(req.baseUrl || '').replace(/\/\d+(?=\/|$)/g, '/:id');
    const route = `${base}${req.route.path === '/' ? '' : req.route.path}` || '/';
    const raw = req.params ? req.params.id : undefined;
    const id = /^\d{1,9}$/.test(String(raw ?? '')) ? Number(raw) : null;
    activityLog
      .record({ userId: req.user.sub, method: req.method, route, entityId: id, statusCode: res.statusCode })
      .catch((err) => console.error('[activity] could not record:', err.message));
  });
  return next();
}

module.exports = { activity };
