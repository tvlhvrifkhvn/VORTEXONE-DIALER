const express = require('express');
const pdfExport = require('../services/pdfExport');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/daily-pdf',
  asyncHandler(async (req, res) => {
    const buffer = await pdfExport.buildDailyReportBuffer(req.query.date);
    const dateLabel = new Date(req.query.date || Date.now()).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vortex-dialer-${dateLabel}.pdf"`);
    res.send(buffer);
  })
);

module.exports = router;
