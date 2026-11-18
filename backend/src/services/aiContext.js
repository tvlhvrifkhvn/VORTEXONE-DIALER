// The campaign wording the AI prompts use (docs/CRM_PLAN.md, phase C1D).
// Callers pass the context in explicitly; the prompts never hardcode a
// business. With File 01 (ai_context about VA services for US real estate
// agents, company_label "Brokerage", kind real_estate) the prompts say what
// they said before C1D.
const campaigns = require('./campaigns');

/** { aiContext, companyLabel, companyKey, leadNoun, leadNounPlural, kind } from a campaigns row. */
function fromCampaign(campaign) {
  if (!campaign) throw new Error('aiContext: a campaign is required');
  const companyLabel = String(campaign.company_label || 'Company').trim() || 'Company';
  const realEstate = campaign.kind === 'real_estate';
  return {
    campaignId: campaign.id,
    kind: campaign.kind,
    aiContext: String(campaign.ai_context || '').trim() || `${campaign.name}: business-to-business outreach.`,
    companyLabel,
    // The JSON key / field word for the company ("brokerage" for File 01).
    companyKey: companyLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'company',
    // Who picks up the phone: "agent" for real estate, "prospect" otherwise.
    leadNoun: realEstate ? 'agent' : 'prospect',
    leadNounPlural: realEstate ? 'agents' : 'prospects',
  };
}

async function forCampaignId(campaignId) {
  const campaign = await campaigns.getById(campaignId);
  if (!campaign) throw new Error(`aiContext: unknown campaign ${campaignId}`);
  return fromCampaign(campaign);
}

/** For a lead by id: the lead carries its own campaign (D5). */
async function forLead(db, leadId) {
  const { rows } = await db.query(
    'SELECT c.* FROM leads l JOIN campaigns c ON c.id = l.campaign_id WHERE l.id = $1',
    [leadId]
  );
  return rows[0] ? fromCampaign(rows[0]) : null;
}

module.exports = { fromCampaign, forCampaignId, forLead };
