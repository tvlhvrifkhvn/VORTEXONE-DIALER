// C6B: duplicates and merge. GET /api/leads/duplicates (X-Campaign-Id or ALL,
// ?limit=), GET /api/leads/merge-preview?primaryId=&secondaryId=, POST
// /api/leads/merge { primaryId, secondaryId, fieldChoices }. Logic in
// services/duplicates.js. Mounted at /api/leads before routes/leads.js.
const express = require('express');
const duplicates = require('../services/duplicates');
const campaignScope = require('../services/campaignScope');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');

const router = express.Router();

router.get(
  '/duplicates',
  requireAuth,
  campaignOrAll,
  asyncHandler(async (req, res) => {
    const campaignId = req.campaign ? req.campaign.id : campaignScope.ALL;
    res.json(await duplicates.findCandidates(campaignId, { limit: req.query.limit }));
  })
);

router.get(
  '/merge-preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await duplicates.preview({ primaryId: req.query.primaryId, secondaryId: req.query.secondaryId }));
  })
);

router.post(
  '/merge',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    res.json(await duplicates.merge({ primaryId: b.primaryId, secondaryId: b.secondaryId, userId: req.user.sub, fieldChoices: b.fieldChoices }));
  })
);

module.exports = router;
