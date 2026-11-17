// C6A: GET /api/leads/export.csv (X-Campaign-Id or ALL). Takes the lead
// list's query filters, or ?viewId= for a saved view. Logic in
// services/leadExport.js. Mounted at /api/leads before routes/leads.js.
const express = require('express');
const leadExport = require('../services/leadExport');
const campaignScope = require('../services/campaignScope');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');

const router = express.Router();

router.get(
  '/export.csv',
  requireAuth,
  campaignOrAll,
  asyncHandler(async (req, res) => {
    const campaignId = req.campaign ? req.campaign.id : campaignScope.ALL;
    const { viewId, ...query } = req.query;
    // Filters are checked first: a bad one is a 400 before any CSV is sent.
    const plan = await leadExport.prepare({ query, viewId, userId: req.user.sub, campaignId });
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = req.campaign ? `file-${String(req.campaign.file_number).padStart(2, '0')}` : 'all-files';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${scope}-${stamp}.csv"`);
    try {
      await leadExport.write(res, plan);
    } catch (err) {
      // Headers are sent: the file can only be cut short. The log says why.
      console.error('[export] CSV stopped:', err.message);
    }
    res.end();
  })
);

module.exports = router;
