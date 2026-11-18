// C8F: the dial pad's extra routes, mounted at /api/calls before routes/calls.js
// (so GET /manual/recent isn't read as GET /:id). Logic: services/manualCalls.js.
// Each acts on the caller's own call (a supervisor's on any); digits and
// recording only while the call is live, notes until 24 hours after it ends.
const express = require('express');
const manualCalls = require('../services/manualCalls');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
// requireAuth on each route, not router.use: this router sits in front of
// routes/calls.js, whose GET /stream authenticates with a query token.

router.get(
  '/manual/recent',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ calls: await manualCalls.recent(req.user) });
  })
);

router.post(
  '/:id/digits',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await manualCalls.sendDigits({ callId: req.params.id, user: req.user, digits: req.body?.digits }));
  })
);

router.post(
  '/:id/recording',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await manualCalls.setRecording({ callId: req.params.id, user: req.user, on: req.body?.on }));
  })
);

router.put(
  '/:id/notes',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await manualCalls.saveNotes({ callId: req.params.id, user: req.user, notes: req.body?.notes }));
  })
);

router.get(
  '/:id/lead',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ lead: await manualCalls.leadForCall({ callId: req.params.id, user: req.user }) });
  })
);

module.exports = router;
