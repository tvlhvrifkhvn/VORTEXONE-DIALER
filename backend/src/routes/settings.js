const express = require('express');
const settingsStore = require('../services/settings');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// The signed-in user's own preferences (F-48): daily goal, default lines,
// pitch script, the Reports reminder. Before '/:key' so "me" isn't a key.
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ settings: await settingsStore.getUserSettings(req.user.sub) });
  })
);

router.put(
  '/me/:key',
  asyncHandler(async (req, res) => {
    const settings = await settingsStore.setUserSetting(req.user.sub, req.params.key, req.body.value ?? null);
    res.json({ settings });
  })
);

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    // Whitelisted keys only (400 otherwise); a secret comes back as { configured, last4 }.
    res.json(await settingsStore.readForApi(req.params.key));
  })
);

router.put(
  '/:key',
  asyncHandler(async (req, res) => {
    // Supervisors only (403), whitelisted keys only, lengths checked (400).
    const setting = await settingsStore.writeFromApi(req.params.key, req.body.value ?? null, req.user);
    res.json({ setting });
  })
);

module.exports = router;
