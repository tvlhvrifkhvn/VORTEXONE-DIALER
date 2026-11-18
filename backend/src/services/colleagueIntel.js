const db = require('../db');
const { officeLabelFromKey } = require('../utils/officeKey');

/**
 * "What's already happened with other agents at this office" — the social
 * proof a rep opens a cold call with ("I'm already speaking with a few
 * agents at your office").
 */

// Dispositions that mean a human actually picked up. voicemail / no_answer /
// no_contact_number did not reach anyone, so they are not "contacted".
// A callback or a DNC request both required someone on the line.
const LIVE_ANSWER_DISPOSITIONS = ['contacted', 'callback_scheduled', 'dnc'];

// The existing positive outcome. The six disposition buttons label
// `contacted` as "Spoke / Interested", so it is the interested signal —
// with an `interested` tag accepted as an explicit override.
const POSITIVE_DISPOSITION = 'contacted';
const INTERESTED_TAG = 'interested';
const CLIENT_TAG = 'client';

const MAX_RECENT_POSITIVE = 3;

function hasTag(lead, tag) {
  return Array.isArray(lead.tags) && lead.tags.some((t) => String(t).trim().toLowerCase() === tag);
}

function isDnc(lead) {
  return !!lead.dnc_flag || lead.status === 'dnc';
}

async function getColleagueSummary(leadId) {
  const { rows: selfRows } = await db.query(
    'SELECT id, office_key FROM leads WHERE id = $1 AND deleted_at IS NULL',
    [leadId]
  );
  const self = selfRows[0];
  if (!self || !self.office_key) return { totalColleagues: 0 };

  const { rows: colleagues } = await db.query(
    `SELECT l.id, l.name, l.brokerage, l.status, l.dnc_flag, l.tags, l.updated_at,
            ch.last_live_answer_at,
            COALESCE(ch.has_live_answer, false)  AS has_live_answer,
            COALESCE(ch.has_positive, false)     AS has_positive
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT max(started_at) FILTER (WHERE disposition = ANY($3)) AS last_live_answer_at,
              bool_or(disposition = ANY($3))                       AS has_live_answer,
              bool_or(disposition = $4)                            AS has_positive
       FROM call_history
       WHERE lead_id = l.id
     ) ch ON true
     WHERE l.office_key = $1
       AND l.id <> $2
       AND l.deleted_at IS NULL`,
    [self.office_key, leadId, LIVE_ANSWER_DISPOSITIONS, POSITIVE_DISPOSITION]
  );

  if (colleagues.length === 0) return { totalColleagues: 0 };

  let contacted = 0;
  let interested = 0;
  let clients = 0;
  let dnc = 0;
  const positives = [];

  for (const c of colleagues) {
    const colleagueIsDnc = isDnc(c);
    if (colleagueIsDnc) dnc += 1;
    if (c.has_live_answer) contacted += 1;

    const isClient = hasTag(c, CLIENT_TAG);
    const isInterested = isClient || c.has_positive || hasTag(c, INTERESTED_TAG);

    if (isClient) clients += 1;
    if (isInterested) interested += 1;

    // A lead who asked not to be called is never named back to another
    // agent, however they were dispositioned before that.
    if (isInterested && !colleagueIsDnc) {
      positives.push({
        // leadId is beyond the documented shape, but the UI chips have to
        // link somewhere to open the colleague's page.
        leadId: c.id,
        name: c.name,
        outcome: isClient ? 'client' : 'interested',
        // Tags carry no timestamp of their own, so a tag-only positive
        // falls back to when the lead row last changed.
        date: c.last_live_answer_at || c.updated_at,
      });
    }
  }

  positives.sort((a, b) => new Date(b.date) - new Date(a.date));

  const displayBrokerage = colleagues.find((c) => c.brokerage)?.brokerage || null;

  return {
    officeLabel: officeLabelFromKey(self.office_key, displayBrokerage),
    totalColleagues: colleagues.length,
    contacted,
    interested,
    clients,
    dnc,
    recentPositive: positives.slice(0, MAX_RECENT_POSITIVE),
  };
}

module.exports = { getColleagueSummary, LIVE_ANSWER_DISPOSITIONS, CLIENT_TAG, INTERESTED_TAG };
