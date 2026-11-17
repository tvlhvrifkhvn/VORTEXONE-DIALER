// C6B: duplicate leads and merging them (docs/CRM_PLAN.md).
//   findCandidates(campaignId | ALL, { limit })  pairs with their reasons:
//     same email; same name and company; same name, state and office.
//     A pair counts for a file when either lead is in it; each side says its file.
//   preview({ primaryId, secondaryId })  both leads and how many rows of each
//     kind would move (the confirm dialog lists them: there is no undo).
//   merge({ primaryId, secondaryId, userId, fieldChoices })  one transaction:
//     refused while either lead is in_progress; every child row moves to the
//     primary; tags joined; fields: the primary's unless fieldChoices says
//     'secondary' (an empty primary value takes the secondary's); attempts =
//     the higher; DNC wins (both numbers go on the list, the primary becomes
//     dnc and lost); the secondary is soft-deleted with merged_into set; a
//     note on the primary records the merge and the secondary's phone.
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const campaignScope = require('./campaignScope');
const customFields = require('./customFields');
const pipeline = require('./pipeline');
const dncCheck = require('./dncCheck');
const callingHours = require('./callingHours');
const { buildOfficeKey } = require('../utils/officeKey');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_GROUP = 10; // a bigger group (e.g. 40 leads with one email) shows its first 10
const FIELDS = ['name', 'email', 'address', 'brokerage', 'state'];

// Every table with a lead_id that points at leads (CODEMAP TABLES). call_history
// keeps its campaign_id (calls stay in the file they were made from, like a
// file move); tasks follow the primary's file.
const CHILD_TABLES = [
  { table: 'call_history', label: 'calls' },
  { table: 'callbacks', label: 'callbacks' },
  { table: 'dnc_list', label: 'DNC entries' },
  { table: 'sms_messages', label: 'texts' },
  { table: 'sms_opt_events', label: 'text opt-in/out events' },
  { table: 'email_messages', label: 'emails' },
  { table: 'call_objections', label: 'objections' },
  { table: 'lead_notes', label: 'notes' },
  { table: 'lead_stage_history', label: 'stage changes' },
  { table: 'tasks', label: 'tasks', extraSet: 'campaign_id = $3' },
];

const REASONS = {
  email: 'Same email',
  name_company: 'Same name and company',
  name_office: 'Same name, state and office',
};

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} must be a positive whole number`);
  return n;
}

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// ---- finding ----------------------------------------------------------------------

async function findCandidates(campaignId, { limit = DEFAULT_LIMIT } = {}) {
  const max = Math.min(MAX_LIMIT, Math.max(1, Number.isInteger(Number(limit)) ? Number(limit) : DEFAULT_LIMIT));
  const all = campaignId === campaignScope.ALL;
  const inScope = all ? 'TRUE' : 'bool_or(campaign_id = $1)';
  const params = all ? [] : [Number(campaignId)];
  const group = (reason, keySql, where) => `
    SELECT '${reason}' AS reason, (array_agg(id ORDER BY id))[1:${MAX_GROUP}] AS ids
    FROM leads
    WHERE deleted_at IS NULL AND ${where}
    GROUP BY ${keySql}
    HAVING count(*) > 1 AND ${inScope}`;
  const { rows } = await db.query(
    `${group('email', 'lower(btrim(email))', "email IS NOT NULL AND btrim(email) <> ''")}
     UNION ALL
     ${group('name_company', "lower(btrim(name)), lower(btrim(brokerage))", "btrim(name) <> '' AND brokerage IS NOT NULL AND btrim(brokerage) <> ''")}
     UNION ALL
     ${group('name_office', "lower(btrim(name)), state, office_key", "btrim(name) <> '' AND state IS NOT NULL AND office_key IS NOT NULL")}`,
    params
  );

  // Pairs: the oldest lead of a group with each of the others.
  const pairs = new Map();
  for (const g of rows) {
    const [first, ...rest] = g.ids;
    for (const other of rest) {
      const key = `${first}-${other}`;
      if (!pairs.has(key)) pairs.set(key, { a: first, b: other, reasons: [] });
      pairs.get(key).reasons.push(g.reason);
    }
  }
  const sorted = [...pairs.values()].sort((x, y) => y.reasons.length - x.reasons.length || x.a - y.a || x.b - y.b);
  const total = sorted.length;
  const shown = sorted.slice(0, max);
  const ids = [...new Set(shown.flatMap((p) => [p.a, p.b]))];
  const leads = await leadsById(ids);
  return {
    total,
    pairs: shown
      .filter((p) => leads.has(p.a) && leads.has(p.b))
      .map((p) => {
        const a = leads.get(p.a);
        const b = leads.get(p.b);
        return {
          key: `${p.a}-${p.b}`,
          reasons: p.reasons.map((r) => REASONS[r]),
          crossFile: a.campaign_id !== b.campaign_id,
          leads: [a, b],
        };
      }),
  };
}

async function leadsById(ids, executor = db) {
  if (ids.length === 0) return new Map();
  const { rows } = await executor.query(
    `SELECT l.id, l.name, l.phone, l.email, l.address, l.brokerage, l.state, l.status, l.attempts, l.max_attempts,
            l.tags, l.custom, l.campaign_id, l.dnc_flag, l.sms_opt_out, l.next_action_at, l.created_at, l.updated_at,
            c.file_number, c.name AS file_name, c.company_label, st.name AS stage_name
     FROM leads l JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN pipeline_stages st ON st.id = l.pipeline_stage_id
     WHERE l.id = ANY($1)`,
    [ids]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

// ---- preview ----------------------------------------------------------------------

async function counts(leadId, executor = db) {
  const parts = CHILD_TABLES.map((t, i) => `(SELECT count(*)::int FROM ${t.table} WHERE lead_id = $1) AS c${i}`);
  const { rows } = await executor.query(`SELECT ${parts.join(', ')}`, [leadId]);
  return CHILD_TABLES.map((t, i) => ({ table: t.table, label: t.label, count: rows[0][`c${i}`] }));
}

async function preview({ primaryId, secondaryId }) {
  const p = positiveInt(primaryId, 'primaryId');
  const s = positiveInt(secondaryId, 'secondaryId');
  if (p === s) throw new ApiError(400, 'Pick two different leads');
  const leads = await leadsById([p, s]);
  for (const id of [p, s]) {
    const l = leads.get(id);
    if (!l) throw new ApiError(404, `Lead ${id} not found`);
  }
  const fields = await customFields.list(leads.get(p).campaign_id);
  return {
    primary: leads.get(p),
    secondary: leads.get(s),
    customFields: fields.map((f) => ({ key: f.key, label: f.label })),
    moves: (await counts(s)).filter((c) => c.count > 0),
    dncWins: Boolean(leads.get(p).dnc_flag || leads.get(s).dnc_flag || leads.get(p).status === 'dnc' || leads.get(s).status === 'dnc'),
  };
}

// ---- merge -------------------------------------------------------------------------

function checkChoices(raw, customKeys) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'fieldChoices must be an object');
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const isCustom = key.startsWith('custom.') && customKeys.includes(key.slice(7));
    if (!FIELDS.includes(key) && !isCustom) throw new ApiError(400, `fieldChoices: unknown field "${String(key).slice(0, 60)}"`);
    if (value !== 'primary' && value !== 'secondary') throw new ApiError(400, `fieldChoices.${key} must be "primary" or "secondary"`);
    out[key] = value;
  }
  return out;
}

function joinTags(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const t of [...a, ...b]) {
    const k = String(t).toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

async function merge({ primaryId, secondaryId, userId = null, fieldChoices } = {}) {
  const pid = positiveInt(primaryId, 'primaryId');
  const sid = positiveInt(secondaryId, 'secondaryId');
  if (pid === sid) throw new ApiError(400, 'Pick two different leads');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Both rows locked, lowest id first (no deadlock with another merge).
    const { rows } = await client.query('SELECT * FROM leads WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[pid, sid]]);
    const p = rows.find((r) => r.id === pid);
    const s = rows.find((r) => r.id === sid);
    if (!p || p.deleted_at) throw new ApiError(404, `Lead ${pid} not found`);
    if (!s || s.deleted_at) throw new ApiError(404, `Lead ${sid} not found`);
    if (p.status === 'in_progress' || s.status === 'in_progress') {
      throw new ApiError(409, 'One of these leads is being dialed right now. Merge after the call.');
    }

    const defs = await customFields.list(p.campaign_id, client);
    const choices = checkChoices(fieldChoices, defs.map((f) => f.key));

    // Fields: the primary's, the secondary's where chosen, or where the primary's is empty.
    const next = {};
    for (const f of FIELDS) next[f] = choices[f] === 'secondary' || blank(p[f]) ? (blank(s[f]) ? p[f] : s[f]) : p[f];
    const custom = { ...(p.custom || {}) };
    for (const def of defs) {
      const pv = p.custom ? p.custom[def.key] : undefined;
      const sv = s.custom ? s.custom[def.key] : undefined;
      if (blank(sv)) continue; // only a real value moves
      if (choices[`custom.${def.key}`] === 'secondary' || blank(pv)) custom[def.key] = sv;
    }
    const tags = joinTags(p.tags, s.tags);
    const attempts = Math.max(p.attempts || 0, s.attempts || 0);
    const maxAttempts = Math.max(p.max_attempts || 0, s.max_attempts || 0, attempts);
    const dnc = Boolean(p.dnc_flag || s.dnc_flag || p.status === 'dnc' || s.status === 'dnc');

    // A callback scheduled on the secondary is kept (no lead silently loses one).
    let status = p.status;
    let nextActionAt = p.next_action_at;
    if (!dnc && s.status === 'callback_scheduled' && s.next_action_at
        && (p.status !== 'callback_scheduled' || !p.next_action_at || s.next_action_at < p.next_action_at)) {
      status = 'callback_scheduled';
      nextActionAt = s.next_action_at;
    }

    // 1. The children move.
    const moved = [];
    for (const t of CHILD_TABLES) {
      const res = await client.query(
        `UPDATE ${t.table} SET lead_id = $1${t.extraSet ? `, ${t.extraSet}` : ''} WHERE lead_id = $2`,
        t.extraSet ? [pid, sid, p.campaign_id] : [pid, sid]
      );
      moved.push({ table: t.table, label: t.label, count: res.rowCount });
    }

    // 2. The secondary leaves: soft-deleted, pointing at the primary. A DNC
    // merge marks it dnc too, so its number on the list stays consistent (I8).
    await client.query(
      `UPDATE leads SET deleted_at = now(), merged_into = $2, locked_by = NULL, locked_at = NULL, updated_at = now()
              ${dnc ? ", status = 'dnc', dnc_flag = true, next_action_at = NULL" : ''}
       WHERE id = $1`,
      [sid, pid]
    );

    // 3. The primary takes the merged values.
    const zones = callingHours.zonesForLead({ phone: p.phone, state: next.state, address: next.address });
    const officeKey = buildOfficeKey({ brokerage: next.brokerage, address: next.address, state: next.state });
    await client.query(
      `UPDATE leads SET name = $2, email = $3, address = $4, brokerage = $5, state = $6, custom = $7::jsonb, tags = $8,
              attempts = $9, max_attempts = $10, sms_opt_out = $11, deal_value_cents = $12, status = $13, next_action_at = $14,
              tz_zones = $15, office_key = $16, updated_at = now()
       WHERE id = $1`,
      [
        pid, next.name, next.email, next.address, next.brokerage, next.state, JSON.stringify(custom), tags,
        attempts, maxAttempts, Boolean(p.sms_opt_out || s.sms_opt_out), p.deal_value_cents ?? s.deal_value_cents,
        status, nextActionAt, zones, officeKey,
      ]
    );

    // 4. Safety wins: either DNC → both numbers on the list, the primary dnc and lost.
    if (dnc) {
      for (const phone of [p.phone, s.phone]) {
        if (phone) await dncCheck.addToDncList(phone, { source: 'manual', leadId: pid, client });
      }
      await client.query(
        "UPDATE leads SET status = 'dnc', dnc_flag = true, next_action_at = NULL, locked_by = NULL, locked_at = NULL WHERE id = $1",
        [pid]
      );
      await pipeline.markLost(client, pid, { source: 'merge', userId });
    }

    // 5. A note on the primary (the only place the secondary's phone survives on it).
    const summary = moved.filter((m) => m.count > 0).map((m) => `${m.count} ${m.label}`).join(', ') || 'no history';
    await client.query('INSERT INTO lead_notes (lead_id, user_id, body) VALUES ($1, $2, $3)', [
      pid,
      userId,
      `Merged lead #${sid} (${s.name}${s.phone ? `, ${s.phone}` : ''}${s.email ? `, ${s.email}` : ''}) into this lead. Moved: ${summary}.${dnc ? ' DNC applies to both numbers.' : ''}`,
    ]);

    await client.query('COMMIT');
    const { rows: out } = await db.query('SELECT * FROM leads WHERE id = $1', [pid]);
    return { lead: out[0], mergedId: sid, moved, dnc };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { CHILD_TABLES, REASONS, findCandidates, preview, merge, counts };
