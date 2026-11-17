// C6C: the stage funnel (docs/CRM_PLAN.md), per file and period, from
// lead_stage_history. "Reached" counts the leads that got at least that far
// in the period: a lead that moved to stage N (open or won, by position) in
// the period counts for every stage up to N. Lost is counted on its own and
// never as progress. Conversion = reached(next) / reached(this). Wins = leads
// that entered the won stage. Cost per win = the period's costed call spend
// for the file / wins, once call rates are set.
const db = require('../db');
const campaigns = require('./campaigns');
const campaignScope = require('./campaignScope');
const pipeline = require('./pipeline');
const costEngine = require('./costEngine');
const reportingPeriod = require('./reportingPeriod');

async function forCampaign(campaignId, period) {
  const stages = (await pipeline.listStages(campaignId)).sort((a, b) => a.position - b.position || a.id - b.id);
  const progress = stages.filter((s) => s.kind !== 'lost');
  const lost = stages.find((s) => s.kind === 'lost');
  const won = stages.find((s) => s.kind === 'won');

  // Each lead's furthest open/won stage reached in the period (by position).
  const { rows: furthest } = await db.query(
    `SELECT h.lead_id, max(s.position) AS position
     FROM lead_stage_history h
     JOIN pipeline_stages s ON s.id = h.to_stage_id AND s.campaign_id = $1 AND s.kind <> 'lost'
     WHERE h.created_at >= $2 AND h.created_at < $3
     GROUP BY h.lead_id`,
    [campaignId, period.start, period.end]
  );
  const { rows: counts } = await db.query(
    `SELECT count(DISTINCT h.lead_id) FILTER (WHERE h.to_stage_id = $4)::int AS wins,
            count(DISTINCT h.lead_id) FILTER (WHERE h.to_stage_id = $5)::int AS lost
     FROM lead_stage_history h
     WHERE h.created_at >= $2 AND h.created_at < $3 AND h.to_stage_id IN (SELECT id FROM pipeline_stages WHERE campaign_id = $1)`,
    [campaignId, period.start, period.end, won ? won.id : null, lost ? lost.id : null]
  );

  const rows = progress.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    reached: furthest.filter((f) => Number(f.position) >= s.position).length,
  }));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.conversionPct = i === 0 || !prev.reached ? null : Math.round((r.reached / prev.reached) * 1000) / 10;
  });

  const r = await costEngine.rates();
  const { rows: spendRows } = await db.query(
    `SELECT COALESCE(sum(cost_est_cents), 0) AS cents FROM call_history
     WHERE campaign_id = $1 AND started_at >= $2 AND started_at < $3 AND cost_est_cents IS NOT NULL`,
    [campaignId, period.start, period.end]
  );
  const spentCents = Number(Number(spendRows[0].cents).toFixed(4));
  const wins = counts[0].wins;
  return {
    stages: rows,
    wins,
    lost: counts[0].lost,
    ratesSet: r.ratesSet,
    spentCents: r.ratesSet ? spentCents : null,
    costPerWinCents: r.ratesSet && wins > 0 ? Math.round((spentCents / wins) * 100) / 100 : null,
  };
}

/** GET /api/reports/funnel: one file, or every non-archived file for ALL. */
async function funnel(campaignId, query = {}, now = new Date()) {
  const period = await reportingPeriod.resolvePeriod(query, now);
  await costEngine.settle(); // closed calls get their cost first (as /api/spend does)
  const list = campaignId === campaignScope.ALL
    ? (await campaigns.list()).filter((c) => c.status !== 'archived')
    : [await campaigns.getById(campaignId)];
  const files = [];
  for (const c of list) {
    files.push({ campaignId: c.id, fileNumber: c.file_number, name: c.name, ...(await forCampaign(c.id, period)) });
  }
  return { period: reportingPeriod.describe(period), files };
}

module.exports = { funnel, forCampaign };
