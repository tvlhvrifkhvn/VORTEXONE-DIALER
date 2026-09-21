const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const smsAdapter = require('../telephony/smsIndex');

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

/** SMS opt-out is legally distinct from the DNC (Do Not Call) list — this
 * must never also touch dnc_flag or dnc_list. Do not "simplify" these two
 * into one flag. */
async function optOut(leadId) {
  const { rows } = await db.query(
    `UPDATE leads SET sms_opt_out = true, updated_at = now() WHERE id = $1 RETURNING *`,
    [leadId]
  );
  if (!rows[0]) throw new ApiError(404, 'Lead not found');
  return rows[0];
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
  const combined = [
    ...calls.map((c) => ({ type: 'call', ...c })),
    ...messages.map((m) => ({ type: 'sms', ...m })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { calls, messages, timeline: combined };
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
  getTimeline,
};
