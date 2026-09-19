const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const leadQueue = require('../services/leadQueue');
const callSession = require('../services/callSession');
const leadLifecycle = require('../services/leadLifecycle');
const dialingSession = require('../services/dialingSession');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Multi-line live status feed. Registered before requireAuth because the
// browser's EventSource API cannot set an Authorization header, so the token
// arrives as a query param and is verified here instead — requireAuth itself
// is untouched and still guards every other route in this file.
router.get('/stream', (req, res) => {
  let user;
  try {
    user = jwt.verify(req.query.token || '', config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Opening comment so the browser fires onopen even before the first call.
  res.write(': connected\n\n');

  const onCall = (payload) => {
    if (String(payload.userId) !== String(user.sub)) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  callSession.callEvents.on('call', onCall);

  // Proxies between here and the browser will cut an idle stream; a comment
  // line every 25s keeps it open without showing up as an event.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    callSession.callEvents.off('call', onCall);
    res.end();
  });
});

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

// A manual (dial-pad) call has no lead to release or disposition — branch
// before delegating to leadLifecycle, which assumes a lead.
router.post(
  '/:id/hangup',
  asyncHandler(async (req, res) => {
    const call = await callSession.get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    const result = call.lead_id
      ? await leadLifecycle.hangup({ callHistoryId: req.params.id })
      : await callSession.endManualCall(req.params.id);
    res.json(result);
  })
);

// Manual dial pad — places a call to a typed-in number, not tied to any lead.
router.post(
  '/manual/start',
  asyncHandler(async (req, res) => {
    const call = await callSession.startManual({ userId: req.user.sub, toNumberRaw: req.body.toNumber });
    res.status(201).json({ call });
  })
);

// Multi-line dialing — opens three lines at once. Live progress for all of
// them arrives over GET /api/calls/stream, not in these responses.
router.post(
  '/multiline/start',
  asyncHandler(async (req, res) => {
    const result = await callSession.startMultilineSession(
      req.user.sub,
      req.body.sessionId || null,
      req.body.lineCount,
      req.body.leadIds
    );
    res.status(201).json(result);
  })
);

router.post(
  '/multiline/drop',
  asyncHandler(async (req, res) => {
    const result = await callSession.dropMultilineSlot(req.user.sub, req.body.slotNumber);
    res.json(result);
  })
);

router.post(
  '/multiline/take',
  asyncHandler(async (req, res) => {
    const result = await callSession.takeMultilineCall(req.user.sub, req.body.slotNumber);
    if (!result) return res.status(404).json({ error: 'That line is no longer active' });
    res.json(result);
  })
);

// The rep submitted a disposition for the line they were on: free that slot,
// promote any held live call to be handled next, then refill.
router.post(
  '/multiline/release',
  asyncHandler(async (req, res) => {
    const result = await callSession.releaseActiveSlot(req.user.sub, req.body.slotNumber);
    res.json(result);
  })
);

router.post(
  '/multiline/stop',
  asyncHandler(async (req, res) => {
    const result = await callSession.stopMultilineSession(req.user.sub);
    res.json(result);
  })
);

module.exports = router;
