const express = require('express');
const reports = require('../services/reports');
const reportingPeriod = require('../services/reportingPeriod');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/today',
  asyncHandler(async (req, res) => {
    // ?date=YYYY-MM-DD or ?from=…&to=… (reporting zone); default: today.
    const stats = await reports.todayStats(await reportingPeriod.resolvePeriod(req.query));
    res.json(stats);
  })
);

router.get(
  '/per-state',
  asyncHandler(async (req, res) => {
    const states = await reports.perStateReport();
    res.json({ states });
  })
);

router.get(
  '/manual-today',
  asyncHandler(async (req, res) => {
    const calls = await reports.manualCallsToday(await reportingPeriod.resolvePeriod(req.query));
    res.json({ calls });
  })
);

module.exports = router;
