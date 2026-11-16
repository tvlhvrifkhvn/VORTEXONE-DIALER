// Campaigns ("files"): list, create, edit, pause/resume/archive, and moving
// a lead between them (docs/CRM_PLAN.md sections 1 and 2, phase C1A).
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

const KINDS = ['real_estate', 'roofing_supplement', 'custom'];
const STATUSES = ['active', 'paused', 'archived'];
const DEFAULT_COMPANY_LABEL = { real_estate: 'Brokerage', roofing_supplement: 'Company', custom: 'Company' };

const COLUMNS = `id, file_number, name, slug, kind, status, company_label, ai_context, pitch_script,
  daily_goal, default_max_attempts, monthly_budget_cents, created_at, archived_at`;

/** "FILE 02 · ROOFING" — how a campaign is named in messages. */
function fileLabel(campaign) {
  return `FILE ${String(campaign.file_number).padStart(2, '0')} · ${String(campaign.name).toUpperCase()}`;
}

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file'
  );
}

async function list() {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM campaigns ORDER BY file_number`);
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM campaigns WHERE id = $1`, [id]);
  return rows[0] || null;
}

function cleanName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'A file needs a name');
  if (name.length > 60) throw new ApiError(400, 'That name is too long (60 characters max)');
  return name;
}

function optionalText(value, max, label) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const text = String(value);
  if (text.length > max) throw new ApiError(400, `${label} is too long (${max} characters max)`);
  return text;
}

function optionalInt(value, { min, max, label }) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw new ApiError(400, `${label} must be a whole number${max !== undefined ? ` from ${min} to ${max}` : ` of at least ${min}`}`);
  }
  return n;
}

/** The editable fields, validated; undefined = not sent. */
function editableFields(input) {
  return {
    company_label: optionalText(input.companyLabel ?? input.company_label, 40, 'The company label'),
    ai_context: optionalText(input.aiContext ?? input.ai_context, 2000, 'The AI context'),
    pitch_script: optionalText(input.pitchScript ?? input.pitch_script, 5000, 'The pitch script'),
    daily_goal: optionalInt(input.dailyGoal ?? input.daily_goal, { min: 1, max: 100000, label: 'The daily goal' }),
    default_max_attempts: optionalInt(input.defaultMaxAttempts ?? input.default_max_attempts, { min: 1, max: 10, label: 'Max attempts' }),
    monthly_budget_cents: optionalInt(input.monthlyBudgetCents ?? input.monthly_budget_cents, { min: 0, label: 'The monthly budget' }),
  };
}

function uniqueViolation(err, name) {
  if (err.code === '23505') return new ApiError(409, `A file named "${name}" already exists`);
  return err;
}

async function create(input = {}) {
  const name = cleanName(input.name);
  const kind = input.kind ?? 'custom';
  if (!KINDS.includes(kind)) throw new ApiError(400, `Unknown file kind: ${kind}`);
  const fields = editableFields(input);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // One creator at a time picks the next file number and slug.
    await client.query('LOCK TABLE campaigns IN SHARE ROW EXCLUSIVE MODE');
    const { rows: num } = await client.query('SELECT COALESCE(max(file_number), 0) + 1 AS n FROM campaigns');
    const base = slugify(name);
    const { rows: taken } = await client.query('SELECT slug FROM campaigns WHERE slug = $1 OR slug LIKE $2', [base, `${base}-%`]);
    const used = new Set(taken.map((r) => r.slug));
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    const { rows } = await client.query(
      `INSERT INTO campaigns (file_number, name, slug, kind, company_label, ai_context, pitch_script,
                              daily_goal, default_max_attempts, monthly_budget_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLUMNS}`,
      [
        num[0].n, name, slug, kind,
        fields.company_label ?? DEFAULT_COMPANY_LABEL[kind],
        fields.ai_context ?? null, fields.pitch_script ?? null, fields.daily_goal ?? null,
        fields.default_max_attempts ?? null, fields.monthly_budget_cents ?? null,
      ]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw uniqueViolation(err, name);
  } finally {
    client.release();
  }
}

async function update(id, input = {}) {
  const current = await getById(id);
  if (!current) throw new ApiError(404, 'File not found');
  const fields = editableFields(input);
  if (input.name !== undefined) fields.name = cleanName(input.name);
  if (fields.company_label === null) throw new ApiError(400, 'The company label can’t be empty');
  const sets = [];
  const params = [id];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) throw new ApiError(400, 'Nothing to change');
  try {
    const { rows } = await db.query(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`, params);
    return rows[0];
  } catch (err) {
    throw uniqueViolation(err, fields.name);
  }
}

/** Pause, resume (active) or archive. Refuses to archive the last active
 * file, and refuses any change while one of its leads is being dialed. */
async function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new ApiError(400, `Unknown status: ${status}`);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT ${COLUMNS} FROM campaigns WHERE id = $1 FOR UPDATE`, [id]);
    const campaign = rows[0];
    if (!campaign) throw new ApiError(404, 'File not found');
    if (campaign.status === status) {
      await client.query('COMMIT');
      return campaign;
    }
    const { rows: busy } = await client.query(
      "SELECT 1 FROM leads WHERE campaign_id = $1 AND status = 'in_progress' LIMIT 1",
      [id]
    );
    if (busy.length > 0) throw new ApiError(409, `A lead in ${fileLabel(campaign)} is being dialed right now; try again when the call ends`);
    if (status === 'archived' && campaign.status === 'active') {
      const { rows: others } = await client.query(
        "SELECT count(*)::int AS n FROM campaigns WHERE status = 'active' AND id <> $1",
        [id]
      );
      if (others[0].n === 0) throw new ApiError(409, 'This is the last active file; it can’t be archived');
    }
    const { rows: updated } = await client.query(
      `UPDATE campaigns
       SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE NULL END
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, status]
    );
    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Moves a lead to another campaign. Refused while the lead is being
 * dialed. Its old call rows keep the campaign they were made in. */
async function moveLead(leadId, toCampaignId) {
  const target = await getById(toCampaignId);
  if (!target) throw new ApiError(404, 'File not found');
  if (target.status === 'archived') throw new ApiError(409, `${fileLabel(target)} is archived`);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, status, campaign_id FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [leadId]);
    const lead = rows[0];
    if (!lead) throw new ApiError(404, 'Lead not found');
    if (lead.status === 'in_progress') throw new ApiError(409, 'This lead is being dialed right now; move it after the call');
    const { rows: moved } = await client.query(
      'UPDATE leads SET campaign_id = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [leadId, target.id]
    );
    await client.query('COMMIT');
    return moved[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { KINDS, STATUSES, fileLabel, slugify, list, getById, create, update, setStatus, moveLead };
