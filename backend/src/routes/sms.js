const express = require('express');
const smsService = require('../services/smsService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/templates',
  asyncHandler(async (req, res) => {
    const templates = await smsService.listTemplates();
    res.json({ templates });
  })
);

router.post(
  '/templates',
  asyncHandler(async (req, res) => {
    const { name, body } = req.body;
    const template = await smsService.createTemplate({ userId: req.user.sub, name, body });
    res.status(201).json({ template });
  })
);

router.put(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    const { name, body } = req.body;
    const template = await smsService.updateTemplate(req.params.id, { name, body });
    res.json({ template });
  })
);

router.delete(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    await smsService.deleteTemplate(req.params.id);
    res.status(204).end();
  })
);

router.post(
  '/send',
  asyncHandler(async (req, res) => {
    const { leadId, templateId, rawBody } = req.body;
    const message = await smsService.sendSingleSms(leadId, { templateId, rawBody });
    res.status(201).json({ message });
  })
);

router.post(
  '/bulk-send',
  asyncHandler(async (req, res) => {
    const { leadIds, templateId } = req.body;
    const summary = await smsService.sendBulkSms(leadIds, templateId);
    res.json(summary);
  })
);

router.get(
  '/inbox',
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const leads = await smsService.getInbox({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ leads });
  })
);

router.post(
  '/mark-read/:leadId',
  asyncHandler(async (req, res) => {
    await smsService.markRead(req.params.leadId);
    res.json({ ok: true });
  })
);

// SMS opt-out is legally distinct from the DNC list — only sms_opt_out is
// touched here, never dnc_flag/dnc_list.
router.post(
  '/opt-out/:leadId',
  asyncHandler(async (req, res) => {
    const lead = await smsService.optOut(req.params.leadId);
    res.json({ lead });
  })
);

module.exports = router;
