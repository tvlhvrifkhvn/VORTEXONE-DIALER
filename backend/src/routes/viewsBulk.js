// C2E: saved views (/api/views, per user and campaign) and bulk actions
// (/api/leads/bulk/*, mounted ahead of routes/leads.js).
const express = require('express');
const savedViews = require('../services/savedViews');
const bulkActions = require('../services/bulkActions');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireCampaign } = require('../middleware/campaign');
const { ApiError } = require('../middleware/errorHandler');

// Mounted at /api/views.
const viewsRouter = express.Router();
viewsRouter.use(requireAuth, requireCampaign);

viewsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const counts = req.query.counts === '1' || req.query.counts === 'true';
    res.json({ views: await savedViews.list(req.user.sub, req.campaign.id, { counts }) });
  })
);
viewsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json({ view: await savedViews.create(req.user.sub, req.campaign.id, req.body || {}) });
  })
);
viewsRouter.post(
  '/reorder',
  asyncHandler(async (req, res) => {
    res.json({ views: await savedViews.reorder(req.user.sub, req.campaign.id, req.body?.ids) });
  })
);
viewsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ view: await savedViews.rename(req.user.sub, req.campaign.id, req.params.id, req.body || {}) });
  })
);
viewsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await savedViews.remove(req.user.sub, req.campaign.id, req.params.id));
  })
);

// Mounted at /api/leads/bulk.
const bulkRouter = express.Router();
bulkRouter.use(requireAuth);

bulkRouter.post(
  '/stage',
  asyncHandler(async (req, res) => {
    res.json(await bulkActions.moveToStage({ leadIds: req.body?.leadIds, stageId: req.body?.stageId, userId: req.user.sub }));
  })
);
bulkRouter.post(
  '/tag',
  asyncHandler(async (req, res) => {
    res.json(await bulkActions.tag({ leadIds: req.body?.leadIds, tag: req.body?.tag, action: req.body?.action }));
  })
);
bulkRouter.post(
  '/campaign',
  (req, res, next) => (req.user?.role === 'supervisor' ? next() : next(new ApiError(403, 'Only a supervisor can move leads to another file'))),
  asyncHandler(async (req, res) => {
    res.json(await bulkActions.moveToCampaign({ leadIds: req.body?.leadIds, campaignId: req.body?.campaignId, userId: req.user.sub }));
  })
);

module.exports = { viewsRouter, bulkRouter };
