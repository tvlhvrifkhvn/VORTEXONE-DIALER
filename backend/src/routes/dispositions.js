const express = require('express');
const leadLifecycle = require('../services/leadLifecycle');
const tasks = require('../services/tasks');
const db = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { callId, disposition, note, scheduledAt, stageId, task } = req.body;
    if (!callId || !disposition) {
      return res.status(400).json({ error: 'callId and disposition are required' });
    }
    // C3A: an optional follow-up task, checked before the outcome is saved.
    const taskInput = task ? { title: task.title, type: task.type, dueAt: task.due_at ?? task.dueAt } : null;
    if (taskInput) tasks.checkInput(taskInput);
    const result = await leadLifecycle.applyDisposition({
      callHistoryId: callId, disposition, note, scheduledAt, user: req.user, stageId, // C2A: optional stage
    });
    if (taskInput) {
      result.task = await tasks.create({ ...taskInput, leadId: result.lead.id, userId: req.user.sub, source: 'disposition' });
    }
    res.json(result);
  })
);

router.post(
  '/:callId/undo',
  asyncHandler(async (req, res) => {
    // C3A: a follow-up task made with the outcome is kept; the response says so.
    const { rows: before } = await db.query('SELECT lead_id, disposition_at FROM call_history WHERE id = $1', [req.params.callId]);
    const lead = await leadLifecycle.undoDisposition({ callHistoryId: req.params.callId, user: req.user });
    let keptTasks = [];
    if (before[0]?.disposition_at) {
      ({ rows: keptTasks } = await db.query(
        `SELECT id, title, due_at, type FROM tasks
         WHERE lead_id = $1 AND source = 'disposition' AND created_at >= $2 AND done_at IS NULL ORDER BY id`,
        [before[0].lead_id, before[0].disposition_at]
      ));
    }
    res.json({
      lead,
      keptTasks,
      ...(keptTasks.length ? { message: `The follow-up task${keptTasks.length === 1 ? '' : 's'} made with this outcome stay${keptTasks.length === 1 ? 's' : ''}; delete it from the lead page if it isn't needed.` } : {}),
    });
  })
);

module.exports = router;
