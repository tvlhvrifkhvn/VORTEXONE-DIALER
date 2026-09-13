const express = require('express');
const leadLifecycle = require('../services/leadLifecycle');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { callId, disposition, note, scheduledAt } = req.body;
    if (!callId || !disposition) {
      return res.status(400).json({ error: 'callId and disposition are required' });
    }
    const result = await leadLifecycle.applyDisposition({ callHistoryId: callId, disposition, note, scheduledAt });
    res.json(result);
  })
);

router.post(
  '/:callId/undo',
  asyncHandler(async (req, res) => {
    const lead = await leadLifecycle.undoDisposition({ callHistoryId: req.params.callId });
    res.json({ lead });
  })
);

module.exports = router;
