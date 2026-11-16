// Per-campaign custom fields (docs/CRM_PLAN.md, phase C2C): the definitions
// (list, create, update, delete, reorder) and the values stored in
// leads.custom, checked by type. validateValues is strict (edits answer 400);
// coerceForImport is lenient (an import keeps what it can read and drops the
// rest, so the row's outcome never depends on a custom column).
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');

const TYPES = ['text', 'number', 'date', 'select', 'boolean'];
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_LABEL = 60;
const MAX_TEXT = 1000;
const MAX_OPTIONS = 50;
const MAX_OPTION_LENGTH = 60;
const COLUMNS = 'id, campaign_id, key, label, type, options, position, show_in_list';

function cleanLabel(raw) {
  const label = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!label) throw new ApiError(400, 'A field needs a label');
  if (label.length > MAX_LABEL) throw new ApiError(400, `A field label is ${MAX_LABEL} characters at most`);
  return label;
}

/** "Roof Type" → "roof_type" (when no key is given). */
function keyFromLabel(label) {
  const key = String(label).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(key) ? key.slice(0, 40) : `f_${key}`.slice(0, 40);
}

function cleanOptions(type, raw) {
  if (type !== 'select') return [];
  if (!Array.isArray(raw)) throw new ApiError(400, 'A select field needs a list of options');
  const seen = new Set();
  const options = [];
  for (const o of raw) {
    const value = String(o ?? '').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length > MAX_OPTION_LENGTH) throw new ApiError(400, `An option is ${MAX_OPTION_LENGTH} characters at most`);
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    options.push(value);
  }
  if (options.length === 0) throw new ApiError(400, 'A select field needs at least one option');
  if (options.length > MAX_OPTIONS) throw new ApiError(400, `A select field has ${MAX_OPTIONS} options at most`);
  return options;
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} must be a positive whole number`);
  return n;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

async function list(campaignId, executor = db) {
  const { rows } = await executor.query(
    `SELECT ${COLUMNS} FROM campaign_fields WHERE campaign_id = $1 ORDER BY position, id`,
    [campaignId]
  );
  return rows;
}

async function getField(campaignId, fieldId) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM campaign_fields WHERE id = $1 AND campaign_id = $2`, [
    positiveInt(fieldId, 'The field id'),
    campaignId,
  ]);
  if (!rows[0]) throw new ApiError(404, 'Field not found in this file');
  return rows[0];
}

async function create(campaignId, input = {}) {
  const label = cleanLabel(input.label);
  const key = input.key === undefined || input.key === null || input.key === '' ? keyFromLabel(label) : String(input.key);
  if (!KEY_PATTERN.test(key)) {
    throw new ApiError(400, 'A field key is lower-case letters, digits and _, starting with a letter (40 at most)');
  }
  const type = String(input.type || 'text');
  if (!TYPES.includes(type)) throw new ApiError(400, `A field type is one of: ${TYPES.join(', ')}`);
  const options = cleanOptions(type, input.options);
  try {
    const { rows } = await db.query(
      `INSERT INTO campaign_fields (campaign_id, key, label, type, options, position, show_in_list)
       VALUES ($1, $2, $3, $4, $5::jsonb,
               (SELECT COALESCE(max(position), 0) + 1 FROM campaign_fields WHERE campaign_id = $1), $6)
       RETURNING ${COLUMNS}`,
      [campaignId, key, label, type, JSON.stringify(options), input.showInList === true || input.show_in_list === true]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, `This file already has a field with the key "${key}"`);
    throw err;
  }
}

/** Label, options and show_in_list can change; key and type can't (stored values depend on them). */
async function update(campaignId, fieldId, input = {}) {
  const field = await getField(campaignId, fieldId);
  if (input.key !== undefined && input.key !== field.key) throw new ApiError(400, "A field's key can't change");
  if (input.type !== undefined && input.type !== field.type) throw new ApiError(400, "A field's type can't change; add a new field instead");
  const label = input.label === undefined ? field.label : cleanLabel(input.label);
  const options = input.options === undefined ? field.options : cleanOptions(field.type, input.options);
  const showRaw = input.showInList ?? input.show_in_list;
  const show = showRaw === undefined ? field.show_in_list : showRaw === true;
  const { rows } = await db.query(
    `UPDATE campaign_fields SET label = $2, options = $3::jsonb, show_in_list = $4 WHERE id = $1 RETURNING ${COLUMNS}`,
    [field.id, label, JSON.stringify(options), show]
  );
  return rows[0];
}

/** Deletes the definition and the values the file's leads hold for it. */
async function remove(campaignId, fieldId) {
  const field = await getField(campaignId, fieldId);
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM campaign_fields WHERE id = $1', [field.id]);
    await client.query('UPDATE leads SET custom = custom - $2::text WHERE campaign_id = $1 AND custom ? $2::text', [campaignId, field.key]);
    const rest = await list(campaignId, client);
    await client.query(
      `UPDATE campaign_fields f SET position = v.position FROM unnest($1::int[], $2::int[]) AS v(id, position) WHERE f.id = v.id`,
      [rest.map((f) => f.id), rest.map((_, i) => i + 1)]
    );
    await client.query('COMMIT');
    return { deleted: true, fields: await list(campaignId) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function reorder(campaignId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'ids must be the list of every field in its new order');
  const wanted = ids.map((id) => positiveInt(id, 'A field id'));
  const fields = await list(campaignId);
  const known = new Set(fields.map((f) => f.id));
  if (wanted.length !== fields.length || new Set(wanted).size !== wanted.length || !wanted.every((id) => known.has(id))) {
    throw new ApiError(400, "ids must list every one of this file's fields exactly once");
  }
  await db.query(
    `UPDATE campaign_fields f SET position = v.position FROM unnest($1::int[], $2::int[]) AS v(id, position) WHERE f.id = v.id`,
    [wanted, wanted.map((_, i) => i + 1)]
  );
  return list(campaignId);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function realDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** One value by type: the stored form, or undefined when it isn't valid. */
function strictValue(field, value) {
  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string' && typeof value !== 'number') return undefined;
      const text = String(value).trim();
      return text.length <= MAX_TEXT ? text : undefined;
    }
    case 'number': {
      if (typeof value === 'boolean' || value === '' || value === null) return undefined;
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date': {
      const m = typeof value === 'string' ? value.trim().match(DATE_ONLY) : null;
      return m && realDate(Number(m[1]), Number(m[2]), Number(m[3])) ? value.trim() : undefined;
    }
    case 'select':
      return typeof value === 'string' && field.options.includes(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    default:
      return undefined;
  }
}

const TYPE_HINT = {
  text: `text (${MAX_TEXT} characters at most)`,
  number: 'a number',
  date: 'a date like 2026-11-16',
  select: 'one of its options',
  boolean: 'true or false',
};

/**
 * Checks a { key: value } patch against the campaign's fields. Unknown keys
 * and wrong types answer 400 naming the field. null or '' means "clear".
 * Returns { set: { key: value }, clear: [key] }.
 */
async function validateValues(campaignId, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ApiError(400, 'custom must be an object of { fieldKey: value }');
  }
  const fields = new Map((await list(campaignId)).map((f) => [f.key, f]));
  const set = {};
  const clear = [];
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field) throw new ApiError(400, `This file has no field "${key}"`);
    if (value === null || value === '') {
      clear.push(key);
      continue;
    }
    const stored = strictValue(field, value);
    if (stored === undefined) throw new ApiError(400, `"${field.label}" must be ${TYPE_HINT[field.type]}${field.type === 'select' ? ` (${field.options.join(', ')})` : ''}`);
    set[key] = stored;
  }
  return { set, clear };
}

const TRUE_WORDS = ['true', 'yes', 'y', '1', 'x', '✓'];
const FALSE_WORDS = ['false', 'no', 'n', '0'];

/** One cell from a spreadsheet: the stored form, or undefined (dropped). */
function lenientValue(field, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  switch (field.type) {
    case 'number':
      return strictValue(field, text.replace(/[$,\s]/g, ''));
    case 'date': {
      if (DATE_ONLY.test(text)) return strictValue(field, text);
      const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (us && realDate(Number(us[3]), Number(us[1]), Number(us[2]))) {
        return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
      }
      return undefined;
    }
    case 'select':
      return field.options.find((o) => o.toLowerCase() === text.toLowerCase());
    case 'boolean':
      if (TRUE_WORDS.includes(text.toLowerCase())) return true;
      if (FALSE_WORDS.includes(text.toLowerCase())) return false;
      return undefined;
    default:
      return strictValue(field, text.slice(0, MAX_TEXT));
  }
}

/** Import: { key: rawCell } → the values that could be read (others dropped). */
function coerceForImport(fields, raw) {
  const out = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, cell] of Object.entries(raw || {})) {
    const field = byKey.get(key);
    if (!field) continue;
    const value = lenientValue(field, cell);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

module.exports = {
  TYPES,
  list,
  create,
  update,
  remove,
  reorder,
  validateValues,
  coerceForImport,
};
