// C4A: GET /api/spend (one file or ALL) — today, this month, the budgets,
// their state and the per-file split (services/costEngine.js).
const express = require('express');
const costEngine = require('../services/costEngine');
const campaignScope = require('../services/campaignScope');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  campaignOrAll,
  asyncHandler(async (req, res) => {
    res.json(await costEngine.spend({ campaignId: req.campaign ? req.campaign.id : campaignScope.ALL }));
  })
);

module.exports = router;
