const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const smsService = require('../services/smsService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const uploadMedia = multer({ storage: mediaStorage, limits: { fileSize: MAX_MEDIA_BYTES } });

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
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
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
