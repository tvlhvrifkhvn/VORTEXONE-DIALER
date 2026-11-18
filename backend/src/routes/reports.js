const express = require('express');
const reports = require('../services/reports');
const reportingPeriod = require('../services/reportingPeriod');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');
const campaignScope = require('../services/campaignScope');

const router = express.Router();
router.use(requireAuth);
// C1C: every report is for one file, or ALL (X-Campaign-Id: ALL).
router.use(campaignOrAll);
const scopeOf = (req) => (req.campaign ? req.campaign.id : campaignScope.ALL);

router.get(
  '/today',
  asyncHandler(async (req, res) => {
    // ?date=YYYY-MM-DD or ?from=…&to=… (reporting zone); default: today.
    const stats = await reports.todayStats(await reportingPeriod.resolvePeriod(req.query), scopeOf(req));
    res.json(stats);
  })
);

router.get(
  '/per-state',
  asyncHandler(async (req, res) => {
    const states = await reports.perStateReport(scopeOf(req));
    res.json({ states });
  })
);

router.get(
  '/manual-today',
  asyncHandler(async (req, res) => {
    const calls = await reports.manualCallsToday(await reportingPeriod.resolvePeriod(req.query), scopeOf(req));
    res.json({ calls });
  })
);

module.exports = router;
