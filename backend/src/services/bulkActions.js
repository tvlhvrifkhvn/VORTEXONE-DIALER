// Bulk actions on selected leads (docs/CRM_PLAN.md, phase C2E): move to a
// stage, add or remove a tag, move to another file. At most 500 ids per
// request. Each runs in ONE transaction and reuses the single-lead function
// (pipeline.moveWith, leadQueue.addTag/removeTag, campaigns.moveLeadWith).
// A lead that is in_progress (being dialed) is skipped and reported, as is a
// lead that doesn't exist or doesn't fit (a stage of another file).
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const pipeline = require('./pipeline');
const leadQueue = require('./leadQueue');
const campaigns = require('./campaigns');

const MAX_IDS = 500;

function cleanIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(400, 'leadIds must be a non-empty list');
  if (raw.length > MAX_IDS) throw new ApiError(400, `At most ${MAX_IDS} leads per bulk action (got ${raw.length})`);
  const ids = [...new Set(raw.map(Number))];
  if (!ids.every((n) => Number.isInteger(n) && n > 0)) throw new ApiError(400, 'leadIds must be positive whole numbers');
  return ids;
}

/**
 * Locks the leads in id order (no deadlock between two bulk requests), skips
 * missing and in_progress ones, then calls `apply(client, lead)` for the
 * rest. `apply` returns a skip reason string, or nothing when done.
 */
async function run(rawIds, apply) {
  const ids = cleanIds(rawIds);
  const client = await db.getClient();
  const updated = [];
  const skipped = [];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM leads WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
      [ids]
    );
    const found = new Map(rows.map((l) => [l.id, l]));
    for (const id of ids) {
      const lead = found.get(id);
      if (!lead) {
        skipped.push({ id, reason: 'not found' });
        continue;
      }
      if (lead.status === 'in_progress') {
        skipped.push({ id, reason: 'being dialed right now' });
        continue;
      }
      const reason = await apply(client, lead);
      if (reason) skipped.push({ id, reason });
      else updated.push(id);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { updated, skipped };
}

/** Moves the leads to a stage; leads of another file are skipped (I12). History source bulk. */
async function moveToStage({ leadIds, stageId, userId = null }) {
  const id = Number(stageId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'stageId must be a positive whole number');
  const stage = await pipeline.getStage(db, id);
  if (!stage) throw new ApiError(404, 'Stage not found');
  return run(leadIds, async (client, lead) => {
    if (lead.campaign_id !== stage.campaign_id) return 'in another file';
    await pipeline.moveWith(client, lead.id, stage, { source: 'bulk', userId });
    return null;
  });
}

async function tag({ leadIds, tag: rawTag, action }) {
  if (!['add', 'remove'].includes(action)) throw new ApiError(400, "action must be 'add' or 'remove'");
  const text = String(rawTag ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new ApiError(400, 'Tag cannot be empty');
  return run(leadIds, async (client, lead) => {
    if (action === 'add') await leadQueue.addTag(lead.id, text, client);
    else await leadQueue.removeTag(lead.id, text, client);
    return null;
  });
}

/** Moves the leads to another file (its first stage). Supervisor only, like the single move. */
async function moveToCampaign({ leadIds, campaignId, userId = null }) {
  const target = await campaigns.getById(Number(campaignId));
  if (!target) throw new ApiError(404, 'File not found');
  if (target.status === 'archived') throw new ApiError(409, `${campaigns.fileLabel(target)} is archived`);
  return run(leadIds, async (client, lead) => {
    if (lead.campaign_id === target.id) return 'already in that file';
    await campaigns.moveLeadWith(client, lead.id, target, { userId });
    return null;
  });
}

module.exports = { MAX_IDS, moveToStage, tag, moveToCampaign };
