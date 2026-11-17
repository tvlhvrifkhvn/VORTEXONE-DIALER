// C6A: GET /api/leads/export.csv (docs/CRM_PLAN.md). The same filters as the
// lead list (leadQueue.buildListFilters + state), or a saved view's, for one
// file or ALL. Written in pages of 1,000 rows (by id) straight to the
// response, at most 100,000 rows. Every cell that starts with = + - @ gets a
// leading ' (CSV injection guard).
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const leadQueue = require('./leadQueue');
const campaignScope = require('./campaignScope');

const MAX_ROWS = 100000;
const PAGE = 1000;
const FILTER_KEYS = ['search', 'status', 'dateFrom', 'dateTo', 'state', 'stageId', 'tag', 'minAttempts', 'noActivityDays', 'callbackOverdue'];

/** One CSV cell: the injection guard, then quoting when needed. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (values) => `${values.map(cell).join(',')}\r\n`;

/** The list query's filters: from a saved view of this user and file, or from the request query. */
async function filtersFor({ query, viewId, userId, campaignId }) {
  if (viewId === undefined || viewId === null || viewId === '') return leadQueue.parseListQuery(query);
  const id = Number(viewId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'viewId must be a positive whole number');
  const s = campaignScope.scope(null, campaignId, 3);
  const { rows } = await db.query(`SELECT filters FROM saved_views WHERE id = $1 AND user_id = $2 AND ${s.sql}`, [id, userId, ...s.params]);
  if (!rows[0]) throw new ApiError(404, 'View not found');
  const raw = {};
  for (const k of FILTER_KEYS) if (rows[0].filters[k] !== undefined) raw[k] = rows[0].filters[k];
  return leadQueue.parseListQuery(raw);
}

/** Custom field columns for the scope: every field of the files in it, by key (first label wins). */
async function customColumns(campaignId) {
  const s = campaignScope.scope(null, campaignId, 1);
  const { rows } = await db.query(`SELECT key, label FROM campaign_fields WHERE ${s.sql} ORDER BY campaign_id, position, id`, s.params);
  const byKey = new Map();
  for (const r of rows) if (!byKey.has(r.key)) byKey.set(r.key, r.label);
  return [...byKey].map(([key, label]) => ({ key, label }));
}

/**
 * Writes the CSV to `out` (a writable with write()/end()). Returns the row count.
 * Resolves the filters first, so a bad filter is a 400 before anything is written.
 */
async function prepare({ query = {}, viewId, userId, campaignId }) {
  const f = await filtersFor({ query, viewId, userId, campaignId });
  const built = leadQueue.buildListFilters(f);
  const s = campaignScope.scope('leads', campaignId, built.params.length + 1);
  let where = `${built.where} AND ${s.sql}`;
  const params = [...built.params, ...s.params];
  if (f.state) {
    params.push(f.state);
    where += ` AND leads.state = $${params.length}`;
  }
  const custom = await customColumns(campaignId);
  return { where, params, custom };
}

async function write(out, { where, params, custom }) {
  out.write('﻿'); // Excel reads UTF-8 with the BOM
  out.write(
    row([
      'id', 'name', 'phone', 'email', 'address', 'company', 'state', 'file', 'stage', 'status', 'tags',
      ...custom.map((c) => c.label), 'attempts', 'max_attempts', 'next_action_at', 'last_activity', 'created_at',
    ])
  );
  let lastId = 0;
  let written = 0;
  while (written < MAX_ROWS) {
    const limit = Math.min(PAGE, MAX_ROWS - written);
    const { rows } = await db.query(
      `SELECT leads.*, c.file_number, c.name AS file_name, st.name AS stage_name,
              GREATEST(leads.updated_at, (SELECT max(started_at) FROM call_history ch WHERE ch.lead_id = leads.id)) AS last_activity
       FROM (SELECT * FROM leads ${where} AND leads.id > $${params.length + 1} ORDER BY leads.id ASC LIMIT ${limit}) leads
       JOIN campaigns c ON c.id = leads.campaign_id
       LEFT JOIN pipeline_stages st ON st.id = leads.pipeline_stage_id
       ORDER BY leads.id ASC`,
      [...params, lastId]
    );
    if (rows.length === 0) break;
    for (const l of rows) {
      out.write(
        row([
          l.id, l.name, l.phone, l.email, l.address, l.brokerage, l.state,
          `FILE ${String(l.file_number).padStart(2, '0')} · ${l.file_name}`, l.stage_name, l.status, l.tags || [],
          ...custom.map((c) => (l.custom ? l.custom[c.key] : null)),
          l.attempts, l.max_attempts, l.next_action_at, l.last_activity, l.created_at,
        ])
      );
    }
    written += rows.length;
    lastId = rows[rows.length - 1].id;
    if (rows.length < limit) break;
  }
  return written;
}

module.exports = { MAX_ROWS, cell, prepare, write };
