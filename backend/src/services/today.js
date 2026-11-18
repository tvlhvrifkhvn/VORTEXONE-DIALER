// GET /api/today (docs/CRM_PLAN.md, phase C3A): what needs doing now, for one
// campaign or ALL. Four lists, each capped at 50 with its total:
//   callbacks    — callback_scheduled leads due before the end of today (overdue flagged)
//   tasks        — open tasks due before the end of today (overdue flagged)
//   unreadTexts  — leads with unread inbound texts
//   stale        — leads in an open stage past the auto (Contacted) stage, no
//                  activity for 7 days and no open task
// "Now" comes from Node so tests can move the clock.
const db = require('../db');
const campaignScope = require('./campaignScope');
const tasks = require('./tasks');

const CAP = 50;
const STALE_DAYS = 7;

function capped(rows) {
  const total = rows[0]?.total ?? 0;
  return { total, items: rows.map(({ total: _t, ...r }) => r) };
}

async function callbacks(campaignId, now, end) {
  const s = campaignScope.scope('l', campaignId, 3);
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.brokerage AS company, l.phone, l.state, l.campaign_id, l.next_action_at AS due_at,
            (l.next_action_at < $1) AS overdue, count(*) OVER ()::int AS total
     FROM leads l
     WHERE l.status = 'callback_scheduled' AND l.deleted_at IS NULL AND l.next_action_at < $2 AND ${s.sql}
     ORDER BY l.next_action_at ASC, l.id ASC
     LIMIT ${CAP}`,
    [now, end, ...s.params]
  );
  return { ...capped(rows), overdue: rows.filter((r) => r.overdue).length };
}

async function unreadTexts(campaignId) {
  const s = campaignScope.scope('l', campaignId, 1);
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.brokerage AS company, l.campaign_id, u.unread, u.last_at, count(*) OVER ()::int AS total
     FROM leads l
     JOIN (
       SELECT lead_id, count(*)::int AS unread, max(sent_at) AS last_at
       FROM sms_messages WHERE direction = 'inbound' AND is_read = false AND lead_id IS NOT NULL
       GROUP BY lead_id
     ) u ON u.lead_id = l.id
     WHERE l.deleted_at IS NULL AND ${s.sql}
     ORDER BY u.last_at DESC, l.id DESC
     LIMIT ${CAP}`,
    s.params
  );
  return capped(rows);
}

async function stale(campaignId, now) {
  const s = campaignScope.scope('l', campaignId, 2);
  const since = new Date(now.getTime() - STALE_DAYS * 24 * 3600 * 1000);
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.brokerage AS company, l.campaign_id, st.name AS stage_name,
            GREATEST(l.updated_at, h.moved_at) AS activity_at, count(*) OVER ()::int AS total
     FROM leads l
     JOIN pipeline_stages st ON st.id = l.pipeline_stage_id AND st.kind = 'open'
     JOIN pipeline_stages auto ON auto.campaign_id = l.campaign_id AND auto.auto_on = 'contacted'
     LEFT JOIN LATERAL (SELECT max(created_at) AS moved_at FROM lead_stage_history WHERE lead_id = l.id) h ON true
     WHERE l.deleted_at IS NULL AND l.status <> 'dnc'
       AND st.position > auto.position
       AND GREATEST(l.updated_at, h.moved_at) < $1
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.done_at IS NULL)
       AND ${s.sql}
     ORDER BY activity_at ASC, l.id ASC
     LIMIT ${CAP}`,
    [since, ...s.params]
  );
  return capped(rows);
}

async function getToday(campaignId, now = new Date()) {
  const end = await tasks.endOfToday(now);
  const [cb, tk, tx, st] = await Promise.all([
    callbacks(campaignId, now, end),
    tasks.listDue({ campaignId, now, limit: CAP }),
    unreadTexts(campaignId),
    stale(campaignId, now),
  ]);
  return { now, endOfDay: end, callbacks: cb, tasks: tk, unreadTexts: tx, stale: st };
}

module.exports = { CAP, STALE_DAYS, getToday };
