const express = require('express');
const objectionService = require('../services/objectionService');
const rebuttalCoach = require('../services/rebuttalCoach');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// --- objection types (Settings) -------------------------------------------

router.get(
  '/types',
  asyncHandler(async (req, res) => {
    const types = await objectionService.listTypes({ includeInactive: req.query.includeInactive === '1' });
    res.json({ types });
  })
);

router.post(
  '/types',
  asyncHandler(async (req, res) => {
    const type = await objectionService.createType(req.body.label);
    res.status(201).json({ type });
  })
);

// Must precede /types/:id so "reorder" isn't read as an id.
router.post(
  '/types/reorder',
  asyncHandler(async (req, res) => {
    const types = await objectionService.reorderTypes(req.body.ids);
    res.json({ types });
  })
);

router.put(
  '/types/:id',
  asyncHandler(async (req, res) => {
    const type = await objectionService.updateType(req.params.id, {
      label: req.body.label,
      isActive: req.body.isActive,
    });
    res.json({ type });
  })
);

// --- rebuttal suggestions (Reports + call-screen hints) --------------------

router.get(
  '/hints',
  asyncHandler(async (req, res) => {
    const hints = await rebuttalCoach.getHints();
    res.json({ hints });
  })
);

router.get(
  '/types/:id/suggestions',
  asyncHandler(async (req, res) => {
    const result = await rebuttalCoach.getSuggestions(req.params.id);
    res.json(result);
  })
);

router.post(
  '/types/:id/suggestions/regenerate',
  asyncHandler(async (req, res) => {
    const result = await rebuttalCoach.regenerate(req.params.id);
    res.json(result);
  })
);

// New suggestions wait here until a person approves or rejects them; only
// approved ones reach the call screen.
router.get(
  '/suggestions/pending',
  asyncHandler(async (req, res) => {
    const suggestions = await rebuttalCoach.listPending();
    res.json({ suggestions });
  })
);

router.put(
  '/suggestions/:id',
  asyncHandler(async (req, res) => {
    const suggestion = await rebuttalCoach.reviewSuggestion(req.params.id, req.body.status);
    res.json({ suggestion });
  })
);

// --- per-call logging (call screen) ---------------------------------------
// Works mid-call without a disposition, so nothing here goes through
// leadLifecycle.

router.get(
  '/calls/:callId',
  asyncHandler(async (req, res) => {
    const objections = await objectionService.listForCall(req.params.callId);
    res.json({ objections });
  })
);

router.post(
  '/calls/:callId',
  asyncHandler(async (req, res) => {
    const objections = await objectionService.logForCall(req.params.callId, req.body.objectionTypeId);
    res.status(201).json({ objections });
  })
);

router.put(
  '/calls/:callId/:objectionTypeId',
  asyncHandler(async (req, res) => {
    const objections = await objectionService.saveRebuttal(
      req.params.callId,
      req.params.objectionTypeId,
      req.body.rebuttalUsed
    );
    res.json({ objections });
  })
);

router.delete(
  '/calls/:callId/:objectionTypeId',
  asyncHandler(async (req, res) => {
    const objections = await objectionService.removeForCall(req.params.callId, req.params.objectionTypeId);
    res.json({ objections });
  })
);

// --- report ----------------------------------------------------------------

router.get(
  '/report',
  asyncHandler(async (req, res) => {
    const { dateFrom, dateTo, state, officeKey } = req.query;
    const report = await objectionService.getReport({ dateFrom, dateTo, state, officeKey });
    res.json(report);
  })
);

router.get(
  '/offices',
  asyncHandler(async (req, res) => {
    const offices = await objectionService.listOffices();
    res.json({ offices });
  })
);

module.exports = router;
