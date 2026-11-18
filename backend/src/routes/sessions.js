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

// C4B: one session's stats (dials, contacts, …) for the call screen's session row.
// The rep who owns the session, or a supervisor.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'The session id must be a positive whole number' });
    const stats = await dialingSession.getSessionStats(id);
    if (!stats || (stats.user_id !== req.user.sub && req.user.role !== 'supervisor')) {
      return res.status(404).json({ error: 'Dialing session not found' });
    }
    res.json({ session: stats });
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
