// Campaign header middleware (docs/CRM_PLAN.md section 3).
// The frontend sends `X-Campaign-Id: <id>` on every request (lib/api.js).
//   requireCampaign       the id exists and isn't archived; sets req.campaign
//   requireActiveCampaign as above, and the campaign is active (dialing, imports)
//   campaignOrAll         as requireCampaign, or ALL (then req.campaign is null)
// A bad or missing header answers 400 with code `campaign_invalid` (the
// frontend then falls back to File 01 and retries once).
const campaigns = require('../services/campaigns');
const { ALL } = require('../services/campaignScope');

const HEADER = 'x-campaign-id';

function invalid(res, message) {
  return res.status(400).json({ error: message, code: 'campaign_invalid' });
}

async function load(req, res) {
  const raw = req.headers[HEADER];
  if (raw === undefined || raw === '') {
    invalid(res, 'Choose a file (campaign) first: the X-Campaign-Id header is missing');
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    invalid(res, `Unknown file (campaign): ${String(raw).slice(0, 20)}`);
    return null;
  }
  const campaign = await campaigns.getById(id);
  if (!campaign || campaign.status === 'archived') {
    invalid(res, campaign ? `${campaigns.fileLabel(campaign)} is archived` : `Unknown file (campaign): ${id}`);
    return null;
  }
  return campaign;
}

function requireCampaign(req, res, next) {
  load(req, res)
    .then((campaign) => {
      if (!campaign) return;
      req.campaign = campaign;
      next();
    })
    .catch(next);
}

function requireActiveCampaign(req, res, next) {
  load(req, res)
    .then((campaign) => {
      if (!campaign) return;
      if (campaign.status !== 'active') {
        res.status(409).json({
          error: `${campaigns.fileLabel(campaign)} is paused: resume it to dial or import`,
          code: 'campaign_paused',
        });
        return;
      }
      req.campaign = campaign;
      next();
    })
    .catch(next);
}

function campaignOrAll(req, res, next) {
  if (req.headers[HEADER] === ALL) {
    req.campaign = null;
    req.campaignId = ALL;
    next();
    return;
  }
  requireCampaign(req, res, (err) => {
    if (err) return next(err);
    req.campaignId = req.campaign.id;
    next();
  });
}

module.exports = { HEADER, requireCampaign, requireActiveCampaign, campaignOrAll };
