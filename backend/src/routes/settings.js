const express = require('express');
const settingsStore = require('../services/settings');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const value = await settingsStore.getSetting(req.params.key);
    res.json({ key: req.params.key, value });
  })
);

router.put(
  '/:key',
  asyncHandler(async (req, res) => {
    const setting = await settingsStore.setSetting(req.params.key, req.body.value ?? null);
    res.json({ setting });
  })
);

module.exports = router;
