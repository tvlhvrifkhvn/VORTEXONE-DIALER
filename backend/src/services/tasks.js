// Tasks (docs/CRM_PLAN.md, phase C3A): create, update, complete, reopen,
// delete, list by lead, and list due/overdue for a campaign (or ALL).
// "Now" comes from Node (new Date()), never from Postgres now(), so the
// tests can move the clock. Due = open and due before the end of the
// current reporting day; overdue = open and due before now.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const campaignScope = require('./campaignScope');
const reportingPeriod = require('./reportingPeriod');

const TYPES = ['call', 'email', 'text', 'other'];
const SOURCES = ['manual', 'disposition'];
const MAX_TITLE = 200;
const LIST_CAP = 50;
const COLUMNS = 't.id, t.campaign_id, t.lead_id, t.user_id, t.type, t.title, t.due_at, t.done_at, t.source, t.created_at';

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} must be a positive whole number`);
  return n;
}

function cleanTitle(raw) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new ApiError(400, 'A task needs a title');
  if (title.length > MAX_TITLE) throw new ApiError(400, `A task title is ${MAX_TITLE} characters at most`);
  return title;
}

function cleanType(raw) {
  const type = raw === undefined || raw === null || raw === '' ? 'call' : String(raw);
  if (!TYPES.includes(type)) throw new ApiError(400, `A task type is one of: ${TYPES.join(', ')}`);
  return type;
}

function cleanDue(raw) {
  const due = new Date(raw);
  if (raw === undefined || raw === null || raw === '' || Number.isNaN(due.getTime())) {
    throw new ApiError(400, 'A task needs a due date and time');
  }
  return due;
}

/** Checks a task's fields without saving (the disposition route checks before its outcome). */
function checkInput({ title, type, dueAt } = {}) {
  return { title: cleanTitle(title), type: cleanType(type), due: cleanDue(dueAt) };
}

async function getById(id, executor = db) {
  const { rows } = await executor.query(
    `SELECT ${COLUMNS}, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id WHERE t.id = $1`,
    [positiveInt(id, 'The task id')]
  );
  if (!rows[0]) throw new ApiError(404, 'Task not found');
  return rows[0];
}

/**
 * Creates a task. With a lead, the task takes the lead's campaign (D5);
 * without one, `campaignId` is required. `executor` lets the disposition
 * route create it right after its own transaction.
 */
async function create({ leadId = null, campaignId = null, userId = null, title, type, dueAt, source = 'manual' } = {}, executor = db) {
  if (!SOURCES.includes(source)) throw new Error(`tasks: unknown source ${source}`);
  const clean = { title: cleanTitle(title), type: cleanType(type), due: cleanDue(dueAt) };
  let campaign = campaignId;
  let lead = null;
  if (leadId !== null && leadId !== undefined && leadId !== '') {
    lead = positiveInt(leadId, 'leadId');
    const { rows } = await executor.query('SELECT campaign_id FROM leads WHERE id = $1 AND deleted_at IS NULL', [lead]);
    if (!rows[0]) throw new ApiError(404, 'Lead not found');
    campaign = rows[0].campaign_id;
  }
  if (!campaign) throw new ApiError(400, 'A task without a lead needs a file (campaign)');
  const { rows } = await executor.query(
    `INSERT INTO tasks (campaign_id, lead_id, user_id, type, title, due_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [campaign, lead, userId, clean.type, clean.title, clean.due, source]
  );
  return getById(rows[0].id, executor);
}

async function update(id, input = {}) {
  const task = await getById(id);
  const title = input.title === undefined ? task.title : cleanTitle(input.title);
  const type = input.type === undefined ? task.type : cleanType(input.type);
  const due = input.dueAt === undefined && input.due_at === undefined ? task.due_at : cleanDue(input.dueAt ?? input.due_at);
  await db.query('UPDATE tasks SET title = $2, type = $3, due_at = $4 WHERE id = $1', [task.id, title, type, due]);
  return getById(task.id);
}

async function complete(id) {
  const task = await getById(id);
  await db.query('UPDATE tasks SET done_at = COALESCE(done_at, $2) WHERE id = $1', [task.id, new Date()]);
  return getById(task.id);
}

async function reopen(id) {
  const task = await getById(id);
  await db.query('UPDATE tasks SET done_at = NULL WHERE id = $1', [task.id]);
  return getById(task.id);
}

async function remove(id) {
  const task = await getById(id);
  await db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
  return { deleted: true, id: task.id };
}

/** A lead's tasks: open first (soonest due), then done (latest first). */
async function listByLead(leadId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM tasks t WHERE t.lead_id = $1
     ORDER BY (t.done_at IS NOT NULL), CASE WHEN t.done_at IS NULL THEN t.due_at END ASC, t.done_at DESC, t.id DESC`,
    [positiveInt(leadId, 'The lead id')]
  );
  return rows;
}

/** The end of the reporting day that contains `now` (the owner's timezone and day start). */
async function endOfToday(now) {
  return reportingPeriod.dayContaining(now, await reportingPeriod.getSettings()).end;
}

/**
 * Open tasks due before the end of today, overdue first (each item says
 * `overdue`). Capped at `limit` with the full total. campaignId or ALL.
 */
async function listDue({ campaignId, now = new Date(), limit = LIST_CAP } = {}) {
  const s = campaignScope.scope('t', campaignId, 3);
  const end = await endOfToday(now);
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, l.name AS lead_name, (t.due_at < $1) AS overdue, count(*) OVER ()::int AS total
     FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
     WHERE t.done_at IS NULL AND t.due_at < $2 AND (t.lead_id IS NULL OR l.deleted_at IS NULL) AND ${s.sql}
     ORDER BY t.due_at ASC, t.id ASC
     LIMIT ${Number(limit)}`,
    [now, end, ...s.params]
  );
  const total = rows[0]?.total ?? 0;
  return { total, overdue: rows.filter((r) => r.overdue).length, items: rows.map(({ total: _t, ...r }) => r) };
}

module.exports = { TYPES, LIST_CAP, checkInput, create, update, complete, reopen, remove, getById, listByLead, listDue, endOfToday };
