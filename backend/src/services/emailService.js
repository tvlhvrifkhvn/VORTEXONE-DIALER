const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const emailAdapter = require('../telephony/emailIndex');
const { mergeFields } = require('./smsService');

async function getLeadForEmail(leadId) {
  const { rows } = await db.query('SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
  const lead = rows[0];
  if (!lead) throw new ApiError(404, 'Lead not found');
  return lead;
}

/**
 * Sends a single email to a lead — mirrors smsService.sendSingleSms's shape
 * (load lead, validate, merge fields, call the adapter, record the message),
 * minus templates/segments/DNC, none of which apply to this channel.
 * mergeFields only collapses runs of 2+ spaces, so a multi-line body's
 * newlines pass through untouched.
 */
async function sendSingleEmail(leadId, { subject, body }) {
  const lead = await getLeadForEmail(leadId);
  // leads.email is nullable (not every scraped row has one) — unlike phone,
  // there's no dedicated flag for this yet, just a plain presence check.
  if (!lead.email) throw new ApiError(400, 'This lead has no email address on file');
  if (!body || !body.trim()) throw new ApiError(400, 'Email body is required');

  const mergedSubject = mergeFields(subject || '', lead);
  const mergedBody = mergeFields(body, lead);

  await emailAdapter.sendEmail(lead.email, mergedSubject, mergedBody);

  const { rows } = await db.query(
    `INSERT INTO email_messages (lead_id, direction, subject, body, status)
     VALUES ($1, 'outbound', $2, $3, 'sent')
     RETURNING *`,
    [leadId, mergedSubject, mergedBody]
  );
  return rows[0];
}

module.exports = { sendSingleEmail };
