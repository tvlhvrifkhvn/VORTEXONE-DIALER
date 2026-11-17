// One lead's timeline (docs/CRM_PLAN.md, phase C2C): calls, notes, texts,
// emails, SMS opt-in/out, stage changes and the import event, newest first.
// The response keeps the shape smsService.getTimeline had (calls, messages,
// notes, emails, timeline) and adds stageChanges and imports, so the lead
// page keeps working while C2D draws the new kinds.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const activityLog = require('./activityLog');

async function getTimeline(leadId) {
  const id = Number(leadId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'The lead id must be a positive whole number');
  const [calls, messages, notes, optEvents, emails, history, taskRows, activity] = await Promise.all([
    db.query(
      `SELECT id, started_at AS timestamp, disposition, duration_seconds, note, was_recorded
       FROM call_history WHERE lead_id = $1 ORDER BY started_at DESC`,
      [id]
    ),
    db.query(
      'SELECT id, sent_at AS timestamp, direction, body, media_url FROM sms_messages WHERE lead_id = $1 ORDER BY sent_at DESC',
      [id]
    ),
    db.query('SELECT id, created_at AS timestamp, body FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC', [id]),
    db.query(
      'SELECT id, created_at AS timestamp, action, source FROM sms_opt_events WHERE lead_id = $1 ORDER BY created_at DESC',
      [id]
    ),
    db.query(
      'SELECT id, sent_at AS timestamp, direction, subject, body FROM email_messages WHERE lead_id = $1 ORDER BY sent_at DESC',
      [id]
    ),
    // Stage history with the stage names (a deleted stage reads null) and who moved it.
    db.query(
      `SELECT h.id, h.created_at AS timestamp, h.source, h.from_stage_id, h.to_stage_id,
              fs.name AS from_stage, ts.name AS to_stage, ts.kind AS to_kind, u.name AS user_name
       FROM lead_stage_history h
       LEFT JOIN pipeline_stages fs ON fs.id = h.from_stage_id
       LEFT JOIN pipeline_stages ts ON ts.id = h.to_stage_id
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.lead_id = $1
       ORDER BY h.created_at DESC, h.id DESC`,
      [id]
    ),
    // C3A: tasks, at the time they were created.
    db.query(
      `SELECT id, created_at AS timestamp, title, type, due_at, done_at, source FROM tasks WHERE lead_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
    // C6C: who changed this lead (activity_log, route patterns only).
    activityLog.forLead(id),
  ]);

  // The import is the lead's first history row with source "import"; every
  // other row is a stage change (creation by hand included, from = null).
  const imports = history.rows.filter((h) => h.source === 'import');
  const stageChanges = history.rows.filter((h) => h.source !== 'import');

  const timeline = [
    ...calls.rows.map((c) => ({ type: 'call', ...c })),
    ...messages.rows.map((m) => ({ type: 'sms', ...m })),
    ...notes.rows.map((n) => ({ type: 'note', ...n })),
    ...emails.rows.map((e) => ({ type: 'email', ...e })),
    ...optEvents.rows.map((o) => ({ type: 'sms_opt', ...o })),
    ...stageChanges.map((s) => ({ type: 'stage', ...s })),
    ...imports.map((i) => ({ type: 'import', ...i })),
    ...taskRows.rows.map(({ type: taskType, ...t }) => ({ type: 'task', task_type: taskType, ...t })),
    ...activity.map((a) => ({ type: 'activity', ...a })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp) || (b.type === 'import') - (a.type === 'import'));

  return {
    calls: calls.rows,
    messages: messages.rows,
    notes: notes.rows,
    emails: emails.rows,
    stageChanges,
    imports,
    tasks: taskRows.rows,
    activity,
    timeline,
  };
}

module.exports = { getTimeline };
