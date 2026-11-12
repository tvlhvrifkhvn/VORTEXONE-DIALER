const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const smsAdapter = require('../telephony/smsIndex');
const { normalizePhone } = require('../utils/phoneNormalize');

const SEGMENT_SIZE = 160;
const BULK_DELAY_MS = 1500;
const BULK_MAX_LEADS = 50;

function mergeFields(body, lead) {
  return body
    .replace(/\{\{name\}\}/g, lead.name || '')
    .replace(/\{\{brokerage\}\}/g, lead.brokerage || '')
    .replace(/\{\{state\}\}/g, lead.state || '')
    // Never leave double spaces from an empty substitution — accept the
    // occasional dangling connector word/punctuation otherwise.
    .replace(/  +/g, ' ')
    .trim();
}

function segmentCount(body) {
  return Math.max(1, Math.ceil(body.length / SEGMENT_SIZE));
}

async function listTemplates() {
  const { rows } = await db.query('SELECT * FROM sms_templates ORDER BY created_at DESC');
  return rows;
}

async function createTemplate({ userId, name, body }) {
  if (!name || !name.trim() || !body || !body.trim()) {
    throw new ApiError(400, 'Name and message body are required');
  }
  const { rows } = await db.query(
    `INSERT INTO sms_templates (user_id, name, body) VALUES ($1, $2, $3) RETURNING *`,
    [userId, name.trim(), body]
  );
  return rows[0];
}

async function updateTemplate(id, { name, body }) {
  if (!name || !name.trim() || !body || !body.trim()) {
    throw new ApiError(400, 'Name and message body are required');
  }
  const { rows } = await db.query(
    `UPDATE sms_templates SET name = $2, body = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, name.trim(), body]
  );
  if (!rows[0]) throw new ApiError(404, 'Template not found');
  return rows[0];
}

async function deleteTemplate(id) {
  await db.query('DELETE FROM sms_templates WHERE id = $1', [id]);
}

async function getLeadForSms(leadId) {
  const { rows } = await db.query('SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
  const lead = rows[0];
  if (!lead) throw new ApiError(404, 'Lead not found');
  return lead;
}

function assertEligible(lead) {
  if (lead.dnc_flag) throw new ApiError(400, 'This lead is on the Do Not Call list');
  if (lead.sms_opt_out) throw new ApiError(400, 'This lead has opted out of SMS');
  // leads.phone became nullable for partial-scrape imports (migration 017).
  if (!lead.phone) throw new ApiError(400, 'This lead has no phone number yet — add one before texting.');
}

async function resolveBody({ templateId, rawBody }, lead) {
  let body = rawBody;
  let resolvedTemplateId = null;
  if (templateId) {
    const { rows } = await db.query('SELECT * FROM sms_templates WHERE id = $1', [templateId]);
    if (!rows[0]) throw new ApiError(404, 'Template not found');
    body = rows[0].body;
    resolvedTemplateId = rows[0].id;
  }
  if (!body || !body.trim()) throw new ApiError(400, 'Message body is required');
  return { merged: mergeFields(body, lead), templateId: resolvedTemplateId };
}

/** Sends one SMS to a lead — opt-out/DNC checked before anything else.
 * mediaUrl is optional MMS-style plumbing (Part C) — the mock adapter logs
 * and ignores it; real delivery is Twilio's job in phase 2. */
async function sendSingleSms(leadId, { templateId, rawBody, mediaUrl } = {}) {
  const lead = await getLeadForSms(leadId);
  assertEligible(lead);

  const { merged, templateId: resolvedTemplateId } = await resolveBody({ templateId, rawBody }, lead);
  await smsAdapter.sendSms(lead.phone, merged, mediaUrl);

  const { rows } = await db.query(
    `INSERT INTO sms_messages (lead_id, direction, body, template_id, status, segment_count, media_url)
     VALUES ($1, 'outbound', $2, $3, 'sent', $4, $5)
     RETURNING *`,
    [leadId, merged, resolvedTemplateId, segmentCount(merged), mediaUrl || null]
  );
  return rows[0];
}

/** Sends a template to many leads, sequentially with a delay between each —
 * filters opt-out/DNC leads out before sending anything. */
async function sendBulkSms(leadIds, templateId) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) throw new ApiError(400, 'No leads selected');
  if (leadIds.length > BULK_MAX_LEADS) {
    throw new ApiError(400, `Too many leads selected — split into batches of ${BULK_MAX_LEADS} or fewer for now`);
  }

  const { rows: templateRows } = await db.query('SELECT * FROM sms_templates WHERE id = $1', [templateId]);
  const template = templateRows[0];
  if (!template) throw new ApiError(404, 'Template not found');

  const { rows: leads } = await db.query('SELECT * FROM leads WHERE id = ANY($1) AND deleted_at IS NULL', [leadIds]);

  const summary = { sent: 0, skipped_opt_out: 0, skipped_dnc: 0, failed: 0 };
  const eligible = [];
  for (const lead of leads) {
    if (lead.dnc_flag) summary.skipped_dnc += 1;
    else if (lead.sms_opt_out) summary.skipped_opt_out += 1;
    else eligible.push(lead);
  }

  for (let i = 0; i < eligible.length; i += 1) {
    const lead = eligible[i];
    try {
      const merged = mergeFields(template.body, lead);
      await smsAdapter.sendSms(lead.phone, merged);
      await db.query(
        `INSERT INTO sms_messages (lead_id, direction, body, template_id, status, segment_count)
         VALUES ($1, 'outbound', $2, $3, 'sent', $4)`,
        [lead.id, merged, template.id, segmentCount(merged)]
      );
      summary.sent += 1;
    } catch {
      summary.failed += 1;
    }
    if (i < eligible.length - 1) {
      await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
    }
  }

  return summary;
}

async function getInbox({ page = 1, limit = 20 } = {}) {
  const offset = (Math.max(1, page) - 1) * limit;
  const { rows } = await db.query(
    `SELECT l.id AS "leadId", l.name AS "leadName", l.brokerage,
            last_msg.body AS "lastMessageBody", last_msg.sent_at AS "lastMessageAt",
            unread.count AS "unreadCount"
     FROM leads l
     JOIN (
       SELECT lead_id, count(*)::int AS count
       FROM sms_messages
       WHERE direction = 'inbound' AND is_read = false
       GROUP BY lead_id
     ) unread ON unread.lead_id = l.id
     JOIN LATERAL (
       SELECT body, sent_at FROM sms_messages WHERE lead_id = l.id ORDER BY sent_at DESC LIMIT 1
     ) last_msg ON true
     ORDER BY last_msg.sent_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function markRead(leadId) {
  await db.query(
    `UPDATE sms_messages SET is_read = true WHERE lead_id = $1 AND direction = 'inbound'`,
    [leadId]
  );
}

/**
 * The one path that changes leads.sms_opt_out (the rep's Opt-out button and
 * inbound STOP / START texts). Records an sms_opt_events row per lead whose
 * value actually changed, so the timeline shows it.
 * SMS opt-out is legally distinct from the DNC (Do Not Call) list — this
 * must never also touch dnc_flag or dnc_list. Do not "simplify" these two
 * into one flag.
 */
async function setSmsOptOut(leadIds, optedOut, { source, smsMessageId = null } = {}) {
  const { rows } = await db.query(
    `WITH changed AS (
       UPDATE leads SET sms_opt_out = $2, updated_at = now()
       WHERE id = ANY($1) AND sms_opt_out IS DISTINCT FROM $2
       RETURNING id
     ), events AS (
       INSERT INTO sms_opt_events (lead_id, action, source, sms_message_id)
       SELECT id, CASE WHEN $2 THEN 'opt_out' ELSE 'opt_in' END, $3, $4 FROM changed
     )
     SELECT id FROM changed`,
    [leadIds, optedOut, source, smsMessageId]
  );
  return rows.map((r) => r.id);
}

async function optOut(leadId) {
  const { rows: found } = await db.query('SELECT id FROM leads WHERE id = $1', [leadId]);
  if (!found[0]) throw new ApiError(404, 'Lead not found');
  await setSmsOptOut([found[0].id], true, { source: 'rep' });
  const { rows } = await db.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  return rows[0];
}

// ---- inbound texts (F-37) ----------------------------------------------------

// Whole-message keywords, compared after upper-casing and dropping every
// character that isn't a letter ("Stop." / " stop " / "S.T.O.P" -> STOP).
// A sentence that merely contains "stop" is a normal message.
const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP']);
const OPT_OUT_REPLY = "Vortexone Agency: You're unsubscribed and won't get more texts from us. Reply START to resubscribe.";
const OPT_IN_REPLY = 'Vortexone Agency: You are resubscribed to texts from us. Reply STOP to unsubscribe.';

function keywordAction(body) {
  const word = String(body || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (OPT_OUT_KEYWORDS.has(word)) return 'opt_out';
  if (OPT_IN_KEYWORDS.has(word)) return 'opt_in';
  return null;
}

/**
 * Stores an inbound text and applies STOP / START.
 * - Matched by normalised phone to every lead with that number (deleted
 *   leads included, so an opt-out still holds if the lead is restored). One
 *   inbound row per matched lead; no match -> one row with no lead.
 * - A repeat of the same providerMessageId is ignored (stored and applied once).
 * - STOP sets sms_opt_out only (never DNC); START clears it (DNC unchanged).
 * - One confirmation reply per keyword message, sent through the adapter at
 *   any hour and despite the opt-out it just set.
 */
async function receiveInbound({ from, to, body, providerMessageId } = {}) {
  const fromNumber = normalizePhone(from);
  if (!fromNumber) throw new ApiError(400, 'Inbound message has no valid "from" number');
  if (typeof body !== 'string') throw new ApiError(400, 'Inbound message has no body');
  const toNumber = normalizePhone(to) || (to ? String(to) : null);

  if (providerMessageId) {
    const { rows: fresh } = await db.query(
      'INSERT INTO sms_inbound_receipts (provider_message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING provider_message_id',
      [String(providerMessageId)]
    );
    if (!fresh[0]) return { duplicate: true, stored: 0, matchedLeadIds: [], action: null, confirmationSent: false };
  }

  const { rows: leads } = await db.query('SELECT id FROM leads WHERE phone = $1 ORDER BY id', [fromNumber]);
  const leadIds = leads.map((l) => l.id);
  const action = keywordAction(body);

  const { rows: stored } = await db.query(
    `INSERT INTO sms_messages (lead_id, direction, body, status, segment_count, from_number, to_number, provider_message_id, keyword_action)
     SELECT lead_id, 'inbound', $2, 'received', $3, $4, $5, $6, $7
     FROM unnest(CASE WHEN cardinality($1::int[]) = 0 THEN ARRAY[NULL]::int[] ELSE $1::int[] END) AS lead_id
     RETURNING id, lead_id`,
    [leadIds, body, segmentCount(body), fromNumber, toNumber, providerMessageId ? String(providerMessageId) : null, action]
  );

  let changedLeadIds = [];
  let confirmationSent = false;
  if (action) {
    if (leadIds.length) {
      changedLeadIds = await setSmsOptOut(leadIds, action === 'opt_out', { source: 'inbound_keyword', smsMessageId: stored[0].id });
    }
    const reply = action === 'opt_out' ? OPT_OUT_REPLY : OPT_IN_REPLY;
    await smsAdapter.sendSms(fromNumber, reply);
    await db.query(
      `INSERT INTO sms_messages (lead_id, direction, body, status, segment_count, to_number)
       VALUES ($1, 'outbound', $2, 'sent', $3, $4)`,
      [leadIds[0] || null, reply, segmentCount(reply), fromNumber]
    );
    confirmationSent = true;
  }
  return { duplicate: false, stored: stored.length, matchedLeadIds: leadIds, action, changedLeadIds, confirmationSent };
}

/** Inbound texts from numbers that match no lead (newest first). */
async function getUnmatchedInbound({ limit = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT id, from_number AS "fromNumber", body, sent_at AS "receivedAt", keyword_action AS "keywordAction"
     FROM sms_messages
     WHERE lead_id IS NULL AND direction = 'inbound'
     ORDER BY sent_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getTimeline(leadId) {
  const { rows: calls } = await db.query(
    `SELECT id, started_at AS timestamp, disposition, duration_seconds, note, was_recorded
     FROM call_history WHERE lead_id = $1 ORDER BY started_at DESC`,
    [leadId]
  );
  const { rows: messages } = await db.query(
    `SELECT id, sent_at AS timestamp, direction, body, media_url FROM sms_messages WHERE lead_id = $1 ORDER BY sent_at DESC`,
    [leadId]
  );
  // Notes taken mid-call live in their own table (migration 018) so a later
  // disposition can't overwrite them — they join the timeline as a third source.
  const { rows: notes } = await db.query(
    `SELECT id, created_at AS timestamp, body FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC`,
    [leadId]
  );
  const { rows: optEvents } = await db.query(
    `SELECT id, created_at AS timestamp, action, source FROM sms_opt_events WHERE lead_id = $1 ORDER BY created_at DESC`,
    [leadId]
  );
  const { rows: emails } = await db.query(
    `SELECT id, sent_at AS timestamp, direction, subject, body FROM email_messages WHERE lead_id = $1 ORDER BY sent_at DESC`,
    [leadId]
  );
  const combined = [
    ...calls.map((c) => ({ type: 'call', ...c })),
    ...messages.map((m) => ({ type: 'sms', ...m })),
    ...notes.map((n) => ({ type: 'note', ...n })),
    ...emails.map((e) => ({ type: 'email', ...e })),
    ...optEvents.map((o) => ({ type: 'sms_opt', ...o })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { calls, messages, notes, emails, timeline: combined };
}

module.exports = {
  mergeFields,
  segmentCount,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  sendSingleSms,
  sendBulkSms,
  getInbox,
  markRead,
  optOut,
  setSmsOptOut,
  keywordAction,
  receiveInbound,
  getUnmatchedInbound,
  getTimeline,
};
