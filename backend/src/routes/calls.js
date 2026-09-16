const express = require('express');
const db = require('../db');
const leadQueue = require('../services/leadQueue');
const callSession = require('../services/callSession');
const leadLifecycle = require('../services/leadLifecycle');
const dialingSession = require('../services/dialingSession');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Starts a call: locks a specific lead (leadId) or whichever lead is next in
// queue, then places the call via the configured telephony adapter
// (TELEPHONY_PROVIDER=mock|twilio — see telephony/index.js). If leadId is
// already locked to this same user (in_progress) — the Redial case, before
// any disposition has been submitted on the previous attempt — re-dial it
// directly instead of going through lockNext, which would otherwise reject
// an in_progress lead as undialable.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { leadId, sessionId } = req.body;

    let lead;
    if (leadId) {
      const { rows } = await db.query(
        'SELECT * FROM leads WHERE id = $1 AND status = $2 AND locked_by = $3',
        [leadId, 'in_progress', req.user.sub]
      );
      lead = rows[0];
    }
    if (!lead) {
      lead = await leadQueue.lockNext({ userId: req.user.sub, leadId: leadId || null });
    }

    const call = await callSession.start({ lead, userId: req.user.sub, sessionId: sessionId || null });
    if (sessionId) await dialingSession.incrementStat(sessionId, 'total_dials');
    res.status(201).json({ call, lead: { ...lead, attempts: call.attempts } });
  })
);

// Polled by the call screen for live progress (telephony_state) until ended.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const call = await callSession.get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json({ call });
  })
);

router.post(
  '/:id/hangup',
  asyncHandler(async (req, res) => {
    const result = await leadLifecycle.hangup({ callHistoryId: req.params.id });
    res.json(result);
  })
);

module.exports = router;
