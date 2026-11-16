// The one SQL helper for campaign scoping (docs/CRM_PLAN.md section 3).
// Collection queries take campaignId explicitly and build their condition
// here instead of by hand, so "ALL" behaves the same everywhere.
//
//   const s = scope('l', campaignId, 2); // → { sql: 'l.campaign_id = $2', params: [5] }
//   db.query(`SELECT … WHERE l.deleted_at IS NULL AND ${s.sql}`, [x, ...s.params]);
//
// For ALL the condition is TRUE and there are no params (so the caller's
// parameter numbering doesn't change).
const ALL = 'ALL';

function scope(alias, campaignId, paramIndex) {
  if (campaignId === ALL) return { sql: 'TRUE', params: [] };
  const id = Number(campaignId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`campaignScope: invalid campaignId ${campaignId}`);
  const column = alias ? `${alias}.campaign_id` : 'campaign_id';
  return { sql: `${column} = $${paramIndex}`, params: [id] };
}

module.exports = { ALL, scope };
