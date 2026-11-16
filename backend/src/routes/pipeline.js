// The CRM pipeline (C2A). Stages are per campaign (header X-Campaign-Id).
// Anyone signed in can read the board and move a lead; only a supervisor
// adds, renames, reorders or deletes stages (they are file settings).
const express = require('express');
const pipeline = require('../services/pipeline');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireCampaign } = require('../middleware/campaign');
const { ApiError } = require('../middleware/errorHandler');

function requireSupervisor(req, res, next) {
  if (req.user?.role !== 'supervisor') return next(new ApiError(403, 'Only a supervisor can change pipeline stages'));
  next();
}

// Mounted at /api/pipeline.
const router = express.Router();
router.use(requireAuth);

router.get(
  '/stages',
  requireCampaign,
  asyncHandler(async (req, res) => {
    res.json({ stages: await pipeline.listStages(req.campaign.id) });
  })
);

router.post(
  '/stages',
  requireCampaign,
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.status(201).json({ stage: await pipeline.createStage(req.campaign.id, { name: req.body?.name }) });
  })
);

// Must precede /stages/:id.
router.post(
  '/stages/reorder',
  requireCampaign,
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json({ stages: await pipeline.reorderStages(req.campaign.id, req.body?.ids) });
  })
);

router.put(
  '/stages/:id',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json({ stage: await pipeline.renameStage(req.params.id, { name: req.body?.name }) });
  })
);

router.delete(
  '/stages/:id',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json(await pipeline.deleteStage(req.params.id));
  })
);

router.get(
  '/board',
  requireCampaign,
  asyncHandler(async (req, res) => {
    res.json(await pipeline.board(req.campaign.id, { perStage: req.query.perStage }));
  })
);

// Mounted at /api/leads, ahead of routes/leads.js: POST /api/leads/:id/stage.
// The lead carries its campaign (D5); the stage must be one of it (I12).
const leadRouter = express.Router();
leadRouter.post(
  '/:id/stage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pipeline.moveLead({
      leadId: req.params.id,
      stageId: req.body?.stageId,
      lostReason: req.body?.lostReason,
      source: 'manual',
      userId: req.user.sub,
    });
    res.json(result);
  })
);

module.exports = router;
module.exports.leadRouter = leadRouter;
