const express = require('express');
const pdfExport = require('../services/pdfExport');
const reportingPeriod = require('../services/reportingPeriod');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/daily-pdf',
  asyncHandler(async (req, res) => {
    // ?date=YYYY-MM-DD or ?from=…&to=… (reporting zone); default: today. Bad input → 400.
    const period = await reportingPeriod.resolvePeriod(req.query);
    const buffer = await pdfExport.buildDailyReportBuffer(period);
    const dateLabel = period.date || `${req.query.from}_to_${req.query.to}`.replace(/[^0-9T_-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vortex-dialer-${dateLabel}.pdf"`);
    res.send(buffer);
  })
);

module.exports = router;
