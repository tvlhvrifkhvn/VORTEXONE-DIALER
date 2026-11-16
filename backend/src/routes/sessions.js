const express = require('express');
const dialingSession = require('../services/dialingSession');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireActiveCampaign } = require('../middleware/campaign');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/start',
  requireActiveCampaign,
  asyncHandler(async (req, res) => {
    const sessionId = await dialingSession.startSession(req.user.sub, req.body.mode, req.campaign.id);
    res.status(201).json({ sessionId });
  })
);

router.post(
  '/end',
  asyncHandler(async (req, res) => {
    const stats = await dialingSession.endSession(req.body.sessionId);
    res.json({ stats });
  })
);

module.exports = router;
