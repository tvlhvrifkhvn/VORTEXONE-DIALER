// C6C: best time to call, the stage funnel and the activity log.
//   GET /api/reports/best-hours   [campaign or ALL]  per-state best hours (90 days)
//   GET /api/reports/funnel       [campaign or ALL]  ?date= or ?from=&to= (reporting zone)
//   GET /api/leads/:id/best-time                      one lead and its state
//   GET /api/activity             supervisor only     ?userId=&from=&to=&page=
// Logic in services/bestTime.js, funnel.js and activityLog.js.
const express = require('express');
const bestTime = require('../services/bestTime');
const funnel = require('../services/funnel');
const activityLog = require('../services/activityLog');
const campaignScope = require('../services/campaignScope');
const { ApiError } = require('../middleware/errorHandler');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');

const scopeOf = (req) => (req.campaign ? req.campaign.id : campaignScope.ALL);

// Mounted at /api/reports (before routes/reports.js; the paths don't overlap).
const reportsRouter = express.Router();
reportsRouter.get(
  '/best-hours',
  requireAuth,
  campaignOrAll,
  asyncHandler(async (req, res) => {
    res.json({ days: bestTime.DAYS, minCalls: bestTime.MIN_CALLS, states: await bestTime.perState(scopeOf(req)) });
  })
);
reportsRouter.get(
  '/funnel',
  requireAuth,
  campaignOrAll,
  asyncHandler(async (req, res) => {
    res.json(await funnel.funnel(scopeOf(req), req.query));
  })
);

// Mounted at /api/leads, before routes/leads.js.
const leadRouter = express.Router();
leadRouter.get(
  '/:id/best-time',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'The lead id must be a positive whole number');
    const result = await bestTime.forLead(id);
    if (!result) throw new ApiError(404, 'Lead not found');
    res.json(result);
  })
);

// Mounted at /api/activity.
const activityRouter = express.Router();
activityRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'supervisor') throw new ApiError(403, 'Only a supervisor can see the activity log');
    res.json(await activityLog.list(req.query));
  })
);

module.exports = { reportsRouter, leadRouter, activityRouter };
