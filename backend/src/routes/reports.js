const express = require('express');
const reports = require('../services/reports');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/today',
  asyncHandler(async (req, res) => {
    const stats = await reports.todayStats();
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

module.exports = router;
