// /api/campaigns/:id/fields (C2C): a file's custom fields. Anyone signed in
// can read them; only a supervisor changes them (they are file settings).
const express = require('express');
const customFields = require('../services/customFields');
const campaigns = require('../services/campaigns');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

function requireSupervisor(req, res, next) {
  if (req.user?.role !== 'supervisor') return next(new ApiError(403, 'Only a supervisor can change custom fields'));
  next();
}

/** The :id file must exist; sets req.fieldsCampaignId. */
const loadCampaign = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'The file id must be a positive whole number');
  if (!(await campaigns.getById(id))) throw new ApiError(404, 'File not found');
  req.fieldsCampaignId = id;
  next();
});

const router = express.Router({ mergeParams: true });
router.use(requireAuth, loadCampaign);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ fields: await customFields.list(req.fieldsCampaignId) });
  })
);

router.post(
  '/',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.status(201).json({ field: await customFields.create(req.fieldsCampaignId, req.body || {}) });
  })
);

// Must precede /:fieldId.
router.post(
  '/reorder',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json({ fields: await customFields.reorder(req.fieldsCampaignId, req.body?.ids) });
  })
);

router.put(
  '/:fieldId',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json({ field: await customFields.update(req.fieldsCampaignId, req.params.fieldId, req.body || {}) });
  })
);

router.delete(
  '/:fieldId',
  requireSupervisor,
  asyncHandler(async (req, res) => {
    res.json(await customFields.remove(req.fieldsCampaignId, req.params.fieldId));
  })
);

module.exports = router;
