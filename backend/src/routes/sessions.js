const express = require('express');
const dialingSession = require('../services/dialingSession');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/start',
  asyncHandler(async (req, res) => {
    const sessionId = await dialingSession.startSession(req.user.sub, req.body.mode);
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
