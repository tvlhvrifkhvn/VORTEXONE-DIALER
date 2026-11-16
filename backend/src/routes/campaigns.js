// Campaigns ("files"). Anyone signed in can list them; only a supervisor
// creates, edits, pauses/resumes/archives a file or moves a lead to another.
const express = require('express');
const campaigns = require('../services/campaigns');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

function requireSupervisor(req, res, next) {
  if (req.user?.role !== 'supervisor') return next(new ApiError(403, 'Only a supervisor can change files'));
  next();
}

// Mounted at /api/campaigns.
const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ campaigns: await campaigns.list() });
  })
);

router.post(
  '/',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.status(201).json({ campaign: await campaigns.create(req.body || {}) });
  })
);

router.put(
  '/:id',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json({ campaign: await campaigns.update(Number(req.params.id), req.body || {}) });
  })
);

router.post(
  '/:id/status',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json({ campaign: await campaigns.setStatus(Number(req.params.id), req.body?.status) });
  })
);

// Mounted at /api/leads, ahead of routes/leads.js: POST /api/leads/:id/move-campaign.
const leadRouter = express.Router();
leadRouter.post(
  '/:id/move-campaign',
  requireAuth,
  requireSupervisor,
  asyncHandler(async (req, res) => {
    const to = Number(req.body?.campaignId);
    if (!Number.isInteger(to) || to <= 0) throw new ApiError(400, 'campaignId is required');
    res.json({ lead: await campaigns.moveLead(Number(req.params.id), to) });
  })
);

module.exports = router;
module.exports.leadRouter = leadRouter;
