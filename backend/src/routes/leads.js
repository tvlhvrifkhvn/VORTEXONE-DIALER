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
    const { search, status, dateFrom, dateTo, state, page, limit } = req.query;
    const result = await leadQueue.list({
      search,
      status,
      dateFrom,
      dateTo,
      state,
      page: page ? Number(page) : undefined,
      pageSize: limit ? Number(limit) : 50,
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

// Must come before /:id — otherwise Express would treat "search" as an id.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const leads = await leadQueue.search(req.query.q);
    res.json({ leads });
  })
);

// Returns a rep's selected leads (checkboxes in the lead table) back in
// correct dialing order — powers "Start Power Dial" over a selection instead
// of the regular in_queue-driven dialer.
router.post(
  '/batch-queue',
  asyncHandler(async (req, res) => {
    const { leadIds } = req.body;
    const leads = await leadQueue.batchQueue(leadIds);
    res.json({ leads });
  })
);

// Hand-entry path (the manual dial pad's optional "Save as lead" form) —
// every other lead comes from a CSV import.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, phone, email, address, brokerage, state } = req.body;
    const lead = await leadQueue.create({ name, phone, email, address, brokerage, state });
    res.status(201).json({ lead });
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

router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const history = await leadQueue.getHistory(req.params.id);
    res.json({ history });
  })
);

router.post(
  '/:id/snooze',
  asyncHandler(async (req, res) => {
    const lead = await leadLifecycle.snooze({ leadId: req.params.id });
    res.json({ lead });
  })
);

// Inline edit from the lead detail slide-in panel.
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, phone, email, address, brokerage, state } = req.body;
    const lead = await leadQueue.updateFields(req.params.id, { name, phone, email, address, brokerage, state });
    res.json({ lead });
  })
);

// "Delete lead" button — soft delete, never shown again.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await leadQueue.softDelete(req.params.id);
    res.json({ lead });
  })
);

module.exports = router;
