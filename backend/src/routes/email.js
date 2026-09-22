const express = require('express');
const emailService = require('../services/emailService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/send',
  asyncHandler(async (req, res) => {
    const { leadId, subject, body } = req.body;
    const message = await emailService.sendSingleEmail(leadId, { subject, body });
    res.status(201).json({ message });
  })
);

module.exports = router;
