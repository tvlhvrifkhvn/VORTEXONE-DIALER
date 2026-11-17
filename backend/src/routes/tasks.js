// C3A: /api/tasks (a task by id needs no header; lists by campaign take
// X-Campaign-Id or ALL) and GET /api/today.
const express = require('express');
const tasks = require('../services/tasks');
const today = require('../services/today');
const taskViews = require('../services/taskViews');
const campaignScope = require('../services/campaignScope');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');

const scopeOf = (req) => (req.campaign ? req.campaign.id : campaignScope.ALL);

// Mounted at /api/tasks.
const router = express.Router();
router.use(requireAuth);

// ?leadId=N → that lead's tasks; otherwise the due/overdue list (campaign or ALL).
router.get(
  '/',
  (req, res, next) => (req.query.leadId ? next() : campaignOrAll(req, res, next)),
  asyncHandler(async (req, res) => {
    if (req.query.leadId) return res.json({ tasks: await tasks.listByLead(req.query.leadId) });
    // C6A: ?view=overdue|today|upcoming (&from=&to= for upcoming).
    if (req.query.view) {
      return res.json(await taskViews.list({ view: req.query.view, campaignId: scopeOf(req), from: req.query.from || undefined, to: req.query.to || undefined }));
    }
    return res.json(await tasks.listDue({ campaignId: scopeOf(req) }));
  })
);

// C6A: reminders. Every file; only what this user hasn't been reminded of today.
router.get(
  '/due-soon',
  asyncHandler(async (req, res) => {
    res.json(await taskViews.dueSoon({ userId: req.user.sub }));
  })
);

router.post(
  '/due-soon/ack',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    res.json(await taskViews.markReminded({ userId: req.user.sub, kind: b.kind, id: b.id, dueAt: b.dueAt }));
  })
);

// A task for a lead takes the lead's file; one without a lead needs the header.
router.post(
  '/',
  (req, res, next) => (req.body?.leadId ? next() : campaignOrAll(req, res, next)),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const task = await tasks.create({
      leadId: b.leadId || null,
      campaignId: req.campaign ? req.campaign.id : null,
      userId: req.user.sub,
      title: b.title,
      type: b.type,
      dueAt: b.dueAt ?? b.due_at,
    });
    res.status(201).json({ task });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ task: await tasks.update(req.params.id, req.body || {}) });
  })
);

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    res.json({ task: await tasks.complete(req.params.id) });
  })
);

router.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    res.json({ task: await tasks.reopen(req.params.id) });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await tasks.remove(req.params.id));
  })
);

// Mounted at /api/today.
const todayRouter = express.Router();
todayRouter.use(requireAuth);
todayRouter.get(
  '/',
  campaignOrAll,
  asyncHandler(async (req, res) => {
    res.json(await today.getToday(scopeOf(req)));
  })
);

module.exports = router;
module.exports.todayRouter = todayRouter;
