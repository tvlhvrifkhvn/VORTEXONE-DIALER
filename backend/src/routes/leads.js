const express = require('express');
const leadQueue = require('../services/leadQueue');
const leadLifecycle = require('../services/leadLifecycle');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search, status, dateFrom, dateTo, state, page, pageSize } = req.query;
    const result = await leadQueue.list({
      search,
      status,
      dateFrom,
      dateTo,
      state,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    res.json(result);
  })
);

router.get(
  '/state-counts',
  asyncHandler(async (req, res) => {
    const counts = await leadQueue.countsByState();
    res.json({ counts });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await leadQueue.getById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  })
);

router.post(
  '/:id/snooze',
  asyncHandler(async (req, res) => {
    const lead = await leadLifecycle.snooze({ leadId: req.params.id });
    res.json({ lead });
  })
);

module.exports = router;
