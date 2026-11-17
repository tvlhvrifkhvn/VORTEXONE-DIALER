// The CRM pipeline (docs/CRM_PLAN.md, phase C2A): stages per campaign, moving
// leads between them, the board, and the stage rules a disposition applies.
// leads.status stays the dialer's; this file only touches pipeline_stage_id,
// won_at and lost_reason (D2). A stage move never changes leads.updated_at,
// so the dialer's ordering is untouched; the board reads the latest stage
// move from lead_stage_history instead.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

// The same lists as migration 035. [name, kind, auto_on]
const TEMPLATES = {
  real_estate: [
    ['New', 'open', null],
    ['Contacted', 'open', 'contacted'],
    ['Interested', 'open', null],
    ['Intro call booked', 'open', null],
    ['Proposal sent', 'open', null],
    ['Client', 'won', null],
    ['Lost', 'lost', null],
  ],
  roofing_supplement: [
    ['New', 'open', null],
    ['Contacted', 'open', 'contacted'],
    ['Interested', 'open', null],
    ['Sample claim received', 'open', null],
    ['First claim in progress', 'open', null],
    ['Client', 'won', null],
    ['Lost', 'lost', null],
  ],
  custom: [
    ['New', 'open', null],
    ['Contacted', 'open', 'contacted'],
    ['Interested', 'open', null],
    ['Client', 'won', null],
    ['Lost', 'lost', null],
  ],
};

const SOURCES = ['create', 'import', 'disposition', 'manual', 'undo', 'move', 'bulk', 'merge']; // C6B: merge (migration 042)
const DNC_LOST_REASON = 'Do not call';
const MAX_NAME_LENGTH = 40;
const MAX_LOST_REASON_LENGTH = 200;
const DEFAULT_PER_STAGE = 20;
const MAX_PER_STAGE = 100;

const STAGE_COLUMNS = 'id, campaign_id, name, position, kind, auto_on';

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new ApiError(400, 'A stage needs a name');
  if (name.length > MAX_NAME_LENGTH) throw new ApiError(400, `A stage name is ${MAX_NAME_LENGTH} characters at most`);
  return name;
}

function cleanLostReason(raw) {
  if (raw === undefined || raw === null) return null;
  const reason = String(raw).replace(/\s+/g, ' ').trim();
  if (!reason) return null;
  if (reason.length > MAX_LOST_REASON_LENGTH) throw new ApiError(400, `A lost reason is ${MAX_LOST_REASON_LENGTH} characters at most`);
  return reason;
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} must be a positive whole number`);
  return n;
}

function uniqueViolation(err, name) {
  if (err.code === '23505') return new ApiError(409, `This file already has a stage named "${name}"`);
  return err;
}

/** Runs fn(client) in one transaction. */
async function inTransaction(fn) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** Creates a new campaign's stages from its kind's template (campaigns.create). */
async function createTemplateStages(executor, campaignId, kind) {
  const template = TEMPLATES[kind] || TEMPLATES.custom;
  const { rows } = await executor.query(
    `INSERT INTO pipeline_stages (campaign_id, name, position, kind, auto_on)
     SELECT $1, t.name, t.position, t.kind, t.auto_on
     FROM unnest($2::text[], $3::int[], $4::text[], $5::text[]) AS t(name, position, kind, auto_on)
     RETURNING ${STAGE_COLUMNS}`,
    [
      campaignId,
      template.map((s) => s[0]),
      template.map((_, i) => i + 1),
      template.map((s) => s[1]),
      template.map((s) => s[2]),
    ]
  );
  return rows.sort((a, b) => a.position - b.position);
}

async function stagesOf(executor, campaignId) {
  const { rows } = await executor.query(
    `SELECT ${STAGE_COLUMNS} FROM pipeline_stages WHERE campaign_id = $1 ORDER BY position, id`,
    [campaignId]
  );
  return rows;
}

/** The first stage of a campaign (I13: every new lead starts here). */
async function firstStageId(executor, campaignId) {
  const stages = await stagesOf(executor, campaignId);
  if (!stages[0]) throw new ApiError(409, 'This file has no pipeline stages');
  return stages[0].id;
}

async function getStage(executor, stageId) {
  const { rows } = await executor.query(`SELECT ${STAGE_COLUMNS} FROM pipeline_stages WHERE id = $1`, [stageId]);
  return rows[0] || null;
}

/** The campaign's stages in order, each with its lead count. */
async function listStages(campaignId) {
  const { rows } = await db.query(
    `SELECT s.id, s.campaign_id, s.name, s.position, s.kind, s.auto_on,
            (SELECT count(*)::int FROM leads l WHERE l.pipeline_stage_id = s.id AND l.deleted_at IS NULL) AS lead_count
     FROM pipeline_stages s
     WHERE s.campaign_id = $1
     ORDER BY s.position, s.id`,
    [campaignId]
  );
  return rows;
}

/** Adds an open stage just before the won/lost stages. */
async function createStage(campaignId, { name: rawName } = {}) {
  const name = cleanName(rawName);
  return inTransaction(async (client) => {
    await client.query('SELECT id FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    const stages = await stagesOf(client, campaignId);
    const firstClosed = stages.find((s) => s.kind !== 'open');
    const position = firstClosed ? firstClosed.position : stages.length + 1;
    await client.query('UPDATE pipeline_stages SET position = position + 1 WHERE campaign_id = $1 AND position >= $2', [campaignId, position]);
    try {
      const { rows } = await client.query(
        `INSERT INTO pipeline_stages (campaign_id, name, position, kind) VALUES ($1, $2, $3, 'open') RETURNING ${STAGE_COLUMNS}`,
        [campaignId, name, position]
      );
      return rows[0];
    } catch (err) {
      throw uniqueViolation(err, name);
    }
  });
}

async function renameStage(stageId, { name: rawName } = {}) {
  const name = cleanName(rawName);
  try {
    const { rows } = await db.query(
      `UPDATE pipeline_stages SET name = $2 WHERE id = $1 RETURNING ${STAGE_COLUMNS}`,
      [positiveInt(stageId, 'The stage id'), name]
    );
    if (!rows[0]) throw new ApiError(404, 'Stage not found');
    return rows[0];
  } catch (err) {
    throw uniqueViolation(err, name);
  }
}

/** Takes every stage id of the campaign in the new order. The first stage
 * must stay an open one (new leads start there). */
async function reorderStages(campaignId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'ids must be the list of every stage in its new order');
  const wanted = ids.map((id) => positiveInt(id, 'A stage id'));
  return inTransaction(async (client) => {
    await client.query('SELECT id FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    const stages = await stagesOf(client, campaignId);
    const known = new Set(stages.map((s) => s.id));
    if (wanted.length !== stages.length || new Set(wanted).size !== wanted.length || !wanted.every((id) => known.has(id))) {
      throw new ApiError(400, "ids must list every one of this file's stages exactly once");
    }
    const first = stages.find((s) => s.id === wanted[0]);
    if (first.kind !== 'open') throw new ApiError(409, 'The first stage must be an open stage: new leads start there');
    await client.query(
      `UPDATE pipeline_stages s SET position = v.position
       FROM unnest($1::int[], $2::int[]) AS v(id, position)
       WHERE s.id = v.id`,
      [wanted, wanted.map((_, i) => i + 1)]
    );
    return stagesOf(client, campaignId);
  });
}

/** Deletes an empty open stage. A campaign keeps one won, one lost and an
 * open first stage. */
async function deleteStage(stageId) {
  const id = positiveInt(stageId, 'The stage id');
  return inTransaction(async (client) => {
    const stage = await getStage(client, id);
    if (!stage) throw new ApiError(404, 'Stage not found');
    await client.query('SELECT id FROM campaigns WHERE id = $1 FOR UPDATE', [stage.campaign_id]);
    if (stage.kind !== 'open') throw new ApiError(409, `A file always keeps its ${stage.kind} stage`);
    const { rows: used } = await client.query('SELECT count(*)::int AS n FROM leads WHERE pipeline_stage_id = $1', [id]);
    if (used[0].n > 0) {
      throw new ApiError(409, `"${stage.name}" still holds ${used[0].n} lead${used[0].n === 1 ? '' : 's'}; move them first`);
    }
    const rest = (await stagesOf(client, stage.campaign_id)).filter((s) => s.id !== id);
    if (!rest[0] || rest[0].kind !== 'open') {
      throw new ApiError(409, 'The first stage must stay an open stage: new leads start there');
    }
    await client.query('DELETE FROM pipeline_stages WHERE id = $1', [id]);
    await client.query(
      `UPDATE pipeline_stages s SET position = v.position
       FROM unnest($1::int[], $2::int[]) AS v(id, position)
       WHERE s.id = v.id`,
      [rest.map((s) => s.id), rest.map((_, i) => i + 1)]
    );
    return { deleted: true, stages: await stagesOf(client, stage.campaign_id) };
  });
}

// ---------------------------------------------------------------------------
// Moving leads
// ---------------------------------------------------------------------------

/**
 * Puts one lead in `stage` (already checked to be in the lead's campaign) and
 * writes the history row, in one statement. won_at is set on a won stage and
 * cleared otherwise; lost_reason is kept only on a lost stage. Returns the
 * updated lead, or null when the lead already sits in that stage.
 */
async function moveWith(executor, leadId, stage, { source, userId = null, lostReason = null }) {
  if (!SOURCES.includes(source)) throw new Error(`pipeline: unknown history source ${source}`);
  const { rows } = await executor.query(
    `WITH prev AS (
       SELECT id, pipeline_stage_id AS from_stage FROM leads WHERE id = $1 FOR UPDATE
     ), upd AS (
       UPDATE leads l
       SET pipeline_stage_id = $2::int,
           won_at = CASE WHEN $3::text = 'won' THEN now() ELSE NULL END,
           lost_reason = CASE WHEN $3::text = 'lost' THEN $4::text ELSE NULL END
       FROM prev
       WHERE l.id = prev.id AND l.campaign_id = $7::int AND l.pipeline_stage_id IS DISTINCT FROM $2::int
       RETURNING l.*, prev.from_stage
     ), hist AS (
       INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id, source, user_id)
       SELECT id, from_stage, $2::int, $5::text, $6::int FROM upd
     )
     SELECT * FROM upd`,
    [leadId, stage.id, stage.kind, stage.kind === 'lost' ? lostReason : null, source, userId, stage.campaign_id]
  );
  if (!rows[0]) return null;
  const { from_stage: _fromStage, ...lead } = rows[0];
  return lead;
}

/**
 * Moves a lead to a stage of its own campaign (I12) and writes history.
 * Returns { lead, moved }.
 */
async function moveLead({ leadId, stageId, source = 'manual', userId = null, lostReason } = {}) {
  const id = positiveInt(leadId, 'The lead id');
  const targetId = positiveInt(stageId, 'stageId');
  const reason = cleanLostReason(lostReason);
  return inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    const lead = rows[0];
    if (!lead) throw new ApiError(404, 'Lead not found');
    const stage = await getStage(client, targetId);
    if (!stage) throw new ApiError(404, 'Stage not found');
    if (stage.campaign_id !== lead.campaign_id) throw new ApiError(400, "That stage belongs to another file; pick one of this lead's file");
    const moved = await moveWith(client, id, stage, { source, userId, lostReason: reason });
    if (moved) return { lead: moved, moved: true };
    // Same stage: only the lost reason can change.
    if (stage.kind === 'lost' && reason !== null && reason !== lead.lost_reason) {
      const { rows: upd } = await client.query('UPDATE leads SET lost_reason = $2 WHERE id = $1 RETURNING *', [id, reason]);
      return { lead: upd[0], moved: false };
    }
    return { lead, moved: false };
  });
}

/** Moves a lead to its campaign's lost stage (DNC from the queue or a slot). */
async function markLost(executor, leadId, { reason = DNC_LOST_REASON, source = 'disposition', userId = null } = {}) {
  const { rows } = await executor.query(
    `SELECT s.id, s.campaign_id, s.name, s.position, s.kind, s.auto_on
     FROM leads l JOIN pipeline_stages s ON s.campaign_id = l.campaign_id AND s.kind = 'lost'
     WHERE l.id = $1`,
    [leadId]
  );
  if (!rows[0]) return null;
  return moveWith(executor, leadId, rows[0], { source, userId, lostReason: reason });
}

/**
 * The stage rules of a disposition, run inside its transaction (client):
 * an explicit stageId wins; otherwise `contacted` moves the lead to the auto
 * stage when it sits in an earlier open stage, and `dnc` moves it to the
 * lost stage ("Do not call"). Returns the updated lead, or null (no move).
 */
async function onDisposition(client, lead, disposition, stageId, userId = null) {
  if (stageId !== undefined && stageId !== null && stageId !== '') {
    const stage = await getStage(client, positiveInt(stageId, 'stageId'));
    if (!stage || stage.campaign_id !== lead.campaign_id) {
      throw new ApiError(400, "That stage isn't one of this lead's file");
    }
    const lostReason = stage.kind === 'lost' && disposition === 'dnc' ? DNC_LOST_REASON : null;
    return moveWith(client, lead.id, stage, { source: 'disposition', userId, lostReason });
  }
  if (disposition === 'dnc') return markLost(client, lead.id, { reason: DNC_LOST_REASON, source: 'disposition', userId });
  if (disposition !== 'contacted') return null;

  const stages = await stagesOf(client, lead.campaign_id);
  const auto = stages.find((s) => s.auto_on === 'contacted');
  const current = stages.find((s) => s.id === lead.pipeline_stage_id);
  if (!auto || !current) return null;
  if (current.kind !== 'open' || current.position >= auto.position) return null;
  return moveWith(client, lead.id, auto, { source: 'disposition', userId });
}

/** Undo: puts back the stage fields a disposition snapshot recorded, with a
 * history row (source undo) when the stage itself changes back. Snapshots
 * taken before C2A carry no stage and are left alone. */
async function restoreSnapshot(client, leadId, snapshot, userId = null) {
  if (!snapshot || snapshot.pipeline_stage_id === undefined || snapshot.pipeline_stage_id === null) return;
  await client.query(
    `WITH prev AS (
       SELECT id, pipeline_stage_id AS from_stage FROM leads WHERE id = $1 FOR UPDATE
     ), upd AS (
       UPDATE leads l SET pipeline_stage_id = $2::int, won_at = $3::timestamptz, lost_reason = $4::text
       FROM prev WHERE l.id = prev.id
       RETURNING l.id, prev.from_stage
     )
     INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id, source, user_id)
     SELECT id, from_stage, $2::int, 'undo', $5::int FROM upd WHERE from_stage IS DISTINCT FROM $2::int`,
    [leadId, snapshot.pipeline_stage_id, snapshot.won_at ?? null, snapshot.lost_reason ?? null, userId]
  );
}

/** History rows for leads that just got their first stage (create, import). */
async function recordInitial(executor, leads, source, userId = null) {
  const list = (leads || []).filter((l) => l && l.id && l.pipeline_stage_id);
  if (list.length === 0) return;
  await executor.query(
    `INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id, source, user_id)
     SELECT v.lead_id, NULL, v.stage_id, $3::text, $4::int
     FROM unnest($1::int[], $2::int[]) AS v(lead_id, stage_id)`,
    [list.map((l) => l.id), list.map((l) => l.pipeline_stage_id), source, userId]
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/**
 * Each stage of the campaign with its lead count and up to `perStage` of its
 * most recently active leads (the later of the lead's last update and its
 * last stage move). With `stageId` (C2B, a column's LOAD MORE) only that
 * stage's leads come back, starting after `offset`.
 */
async function board(campaignId, { perStage = DEFAULT_PER_STAGE, stageId = null, offset = 0 } = {}) {
  const limit = Math.min(MAX_PER_STAGE, Math.max(1, Number.isInteger(Number(perStage)) ? Number(perStage) : DEFAULT_PER_STAGE));
  const only = stageId === null || stageId === undefined || stageId === '' ? null : positiveInt(stageId, 'stageId');
  const skip = Number.isInteger(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0;
  const stages = await listStages(campaignId);
  if (only !== null && !stages.some((s) => s.id === only)) throw new ApiError(400, "That stage isn't one of this file's");
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT l.id, l.name, l.phone, l.state, l.brokerage, l.status, l.pipeline_stage_id,
              l.deal_value_cents, l.won_at, l.lost_reason, l.updated_at,
              GREATEST(l.updated_at, h.moved_at) AS activity_at,
              row_number() OVER (
                PARTITION BY l.pipeline_stage_id
                ORDER BY GREATEST(l.updated_at, h.moved_at) DESC, l.id DESC
              ) AS rn
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT max(created_at) AS moved_at FROM lead_stage_history WHERE lead_id = l.id
       ) h ON true
       WHERE l.campaign_id = $1 AND l.deleted_at IS NULL AND ($3::int IS NULL OR l.pipeline_stage_id = $3::int)
     ) ranked
     WHERE rn > $4 AND rn <= $4 + $2
     ORDER BY pipeline_stage_id, rn`,
    [campaignId, limit, only, skip]
  );
  const byStage = new Map(stages.map((s) => [s.id, []]));
  for (const { rn: _rn, ...lead } of rows) {
    if (byStage.has(lead.pipeline_stage_id)) byStage.get(lead.pipeline_stage_id).push(lead);
  }
  const shown = only === null ? stages : stages.filter((s) => s.id === only);
  return {
    perStage: limit,
    offset: skip,
    stages: shown.map((s) => ({ ...s, count: s.lead_count, leads: byStage.get(s.id) || [] })),
  };
}

/** C2B: the lead's deal value in cents (null clears it). */
async function setDealValue(leadId, cents) {
  const id = positiveInt(leadId, 'The lead id');
  let value = null;
  if (cents !== null && cents !== undefined && cents !== '') {
    value = Number(cents);
    if (!Number.isInteger(value) || value < 0 || value > 100000000000) {
      throw new ApiError(400, 'The deal value must be a whole number of cents, 0 or more');
    }
  }
  // A CRM field: leads.updated_at stays as it is (the dialer orders by it).
  const { rows } = await db.query(
    'UPDATE leads SET deal_value_cents = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING *',
    [id, value]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
}

module.exports = {
  TEMPLATES,
  SOURCES,
  DNC_LOST_REASON,
  createTemplateStages,
  firstStageId,
  getStage,
  listStages,
  createStage,
  renameStage,
  reorderStages,
  deleteStage,
  moveLead,
  markLost,
  onDisposition,
  restoreSnapshot,
  recordInitial,
  board,
  setDealValue,
  moveWith, // C2E: a move inside the caller's transaction (bulk)
};
