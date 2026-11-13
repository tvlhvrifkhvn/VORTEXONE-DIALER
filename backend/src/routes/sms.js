const express = require('express');
const multer = require('multer');
const smsService = require('../services/smsService');
const smsAdapter = require('../telephony/smsIndex');
const mediaUpload = require('../services/mediaUpload');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

// Kept in memory (5 MB max) so mediaUpload can check the real content before
// anything is written to disk (F-40).
const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MEDIA_BYTES, files: 1 } });

// Provider webhook (F-37): called by the SMS provider, not a logged-in user,
// so it sits before requireAuth and is protected by the shared secret
// (smsIndex.verifyInbound, fail closed). The adapter turns the provider's
// body into { from, to, body, providerMessageId }.
router.post(
  '/inbound',
  asyncHandler(async (req, res) => {
    if (!smsAdapter.verifyInbound(req.headers)) throw new ApiError(401, 'Not authorised');
    const result = await smsService.receiveInbound(smsAdapter.parseInbound(req.body || {}));
    res.status(result.duplicate ? 200 : 201).json(result);
  })
);

router.use(requireAuth);

// MMS-style attachment plumbing (Part C) — real delivery needs Twilio
// (phase 2); this saves the file and hands back a URL the compose box and
// timeline can already use with the mock adapter today.
router.post(
  '/upload-media',
  (req, res, next) => {
    uploadMedia.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(400, 'File is too large — the limit is 5MB'));
      }
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const { url } = await mediaUpload.saveImage(req.file);
    res.status(201).json({ url });
  })
);

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
    const { leadId, templateId, rawBody, mediaUrl } = req.body;
    const message = await smsService.sendSingleSms(leadId, { templateId, rawBody, mediaUrl });
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
    const unmatched = await smsService.getUnmatchedInbound();
    const unmatchedUnread = await smsService.countUnmatchedUnread();
    res.json({ leads, unmatched, unmatchedUnread });
  })
);

router.post(
  '/mark-read/:leadId',
  asyncHandler(async (req, res) => {
    await smsService.markRead(req.params.leadId);
    res.json({ ok: true });
  })
);

// A text from a number that matches no lead (kept in the inbox): mark it read.
router.post(
  '/mark-read-unmatched/:messageId',
  asyncHandler(async (req, res) => {
    await smsService.markUnmatchedRead(req.params.messageId);
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
