// C7C: lists (tags starting with "list:"). GET /api/leads/lists [campaign or
// ALL] → { lists: [{ name, tag, count }] }; POST /api/leads/lists/add
// { leadIds, name } adds the list's tag (the bulk tag action). Logic in
// services/leadLists.js. Mounted at /api/leads before routes/leads.js.
const express = require('express');
const leadLists = require('../services/leadLists');
const campaignScope = require('../services/campaignScope');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { campaignOrAll } = require('../middleware/campaign');

const router = express.Router();

router.get(
  '/lists',
  requireAuth,
  campaignOrAll,
  asyncHandler(async (req, res) => {
    res.json({ lists: await leadLists.listsFor(req.campaign ? req.campaign.id : campaignScope.ALL) });
  })
);

router.post(
  '/lists/add',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await leadLists.addToList({ leadIds: req.body?.leadIds, name: req.body?.name }));
  })
);

module.exports = router;
