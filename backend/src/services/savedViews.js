// Saved views (docs/CRM_PLAN.md, phase C2E): one user's named filter sets per
// campaign. `filters` is the query object GET /api/leads accepts; it is
// checked with leadQueue.parseListQuery when saved, so a view can never hold
// a filter the list would refuse. Paging keys are not part of a view.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const leadQueue = require('./leadQueue');

const FILTER_KEYS = ['search', 'status', 'dateFrom', 'dateTo', 'state', 'stageId', 'tag', 'minAttempts', 'noActivityDays', 'callbackOverdue'];
const MAX_NAME = 40;
const MAX_VIEWS = 30;
const COLUMNS = 'id, user_id, campaign_id, name, filters, position';

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new ApiError(400, 'A view needs a name');
  if (name.length > MAX_NAME) throw new ApiError(400, `A view name is ${MAX_NAME} characters at most`);
  return name;
}

/** Keeps the known filter keys with a value, as strings (the list's query form); 400 when the list would refuse them. */
function cleanFilters(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'filters must be an object');
  const filters = {};
  for (const key of FILTER_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null || v === '' || v === false) continue;
    filters[key] = String(v);
  }
  leadQueue.parseListQuery(filters); // throws 400 on a bad value
  return filters;
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} must be a positive whole number`);
  return n;
}

async function own(userId, campaignId, viewId) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM saved_views WHERE id = $1 AND user_id = $2 AND campaign_id = $3`, [
    positiveInt(viewId, 'The view id'),
    userId,
    campaignId,
  ]);
  if (!rows[0]) throw new ApiError(404, 'View not found');
  return rows[0];
}

/** The user's views in this campaign; with `counts`, each carries how many leads it matches now. */
async function list(userId, campaignId, { counts = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM saved_views WHERE user_id = $1 AND campaign_id = $2 ORDER BY position, id`,
    [userId, campaignId]
  );
  if (!counts) return rows;
  return Promise.all(
    rows.map(async (v) => {
      const { total } = await leadQueue.list({ ...leadQueue.parseListQuery({ ...v.filters, limit: 1 }), campaignId });
      return { ...v, count: total };
    })
  );
}

async function create(userId, campaignId, { name, filters } = {}) {
  const clean = { name: cleanName(name), filters: cleanFilters(filters || {}) };
  const { rows: n } = await db.query('SELECT count(*)::int AS n FROM saved_views WHERE user_id = $1 AND campaign_id = $2', [userId, campaignId]);
  if (n[0].n >= MAX_VIEWS) throw new ApiError(409, `A file holds ${MAX_VIEWS} saved views at most`);
  try {
    const { rows } = await db.query(
      `INSERT INTO saved_views (user_id, campaign_id, name, filters, position)
       VALUES ($1, $2, $3, $4::jsonb, (SELECT COALESCE(max(position), 0) + 1 FROM saved_views WHERE user_id = $1 AND campaign_id = $2))
       RETURNING ${COLUMNS}`,
      [userId, campaignId, clean.name, JSON.stringify(clean.filters)]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, `You already have a view named "${clean.name}"`);
    throw err;
  }
}

async function rename(userId, campaignId, viewId, { name } = {}) {
  const view = await own(userId, campaignId, viewId);
  const clean = cleanName(name);
  try {
    const { rows } = await db.query(`UPDATE saved_views SET name = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [view.id, clean]);
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, `You already have a view named "${clean}"`);
    throw err;
  }
}

async function remove(userId, campaignId, viewId) {
  const view = await own(userId, campaignId, viewId);
  await db.query('DELETE FROM saved_views WHERE id = $1', [view.id]);
  return { deleted: true };
}

async function reorder(userId, campaignId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'ids must be the list of every view in its new order');
  const wanted = ids.map((id) => positiveInt(id, 'A view id'));
  const views = await list(userId, campaignId);
  const known = new Set(views.map((v) => v.id));
  if (wanted.length !== views.length || new Set(wanted).size !== wanted.length || !wanted.every((id) => known.has(id))) {
    throw new ApiError(400, 'ids must list every one of your views in this file exactly once');
  }
  await db.query(
    `UPDATE saved_views v SET position = x.position FROM unnest($1::int[], $2::int[]) AS x(id, position) WHERE v.id = x.id`,
    [wanted, wanted.map((_, i) => i + 1)]
  );
  return list(userId, campaignId);
}

module.exports = { FILTER_KEYS, list, create, rename, remove, reorder };
